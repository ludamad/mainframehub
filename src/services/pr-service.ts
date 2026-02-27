/**
 * PRService — orchestrates the full PR lifecycle.
 *
 * Coordinates TmuxService, GitService, GitHubService, ClaudeService, and
 * ClaudeHandoverService to implement the create / setup / close workflows.
 *
 * Every multi-step method accepts an optional `ProgressCallback` so the
 * VS Code `withProgress` UI can show step-by-step updates.
 */

import { join } from 'path';
import { stat, mkdir, rm, rename } from 'fs/promises';
import type { TmuxService } from './tmux';
import type { GitService } from './git';
import type { GitHubService } from './github';
import type { ClaudeService } from './claude';
import type { ClaudeHandoverService } from './handover';
import type {
  PullRequest,
  TmuxSession,
  ExtensionConfig,
  ProgressCallback,
} from '../interfaces';
import { MfhError } from '../errors';

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export class PRService {
  constructor(
    private tmux: TmuxService,
    private git: GitService,
    private github: GitHubService,
    private claude: ClaudeService,
    private handover: ClaudeHandoverService,
    private config: ExtensionConfig,
  ) {}

  /**
   * Create a brand-new PR from a free-form prompt.
   *
   * 1. Generate metadata with Claude (branch name, title, body)
   * 2. Clone repository
   * 3. Create and checkout branch
   * 4. Create empty commit
   * 5. Push branch to remote
   * 6. Create PR on GitHub
   * 7. Rename temp clone to pr-{number}
   * 8. Create tmux session + initialize Claude
   */
  async createNew(
    params: { prompt: string; baseBranch?: string; skipPermissions?: boolean },
    onProgress?: ProgressCallback,
  ): Promise<{ pr: PullRequest; session: TmuxSession; clonePath: string }> {
    const baseBranch = params.baseBranch ?? this.config.baseBranch;

    onProgress?.('Asking Claude to generate branch name and title...', 1, 8);
    const metadata = await this.claude.generateMetadata(params.prompt, {
      guidelines: this.config.guidelines?.branchFormat,
      model: 'haiku',
    });

    onProgress?.(`Cloning ${this.config.repoName} at ${baseBranch}...`, 2, 8);
    const timestamp = Date.now();
    const tempClonePath = join(this.config.clonesDir, `temp-${timestamp}`);
    await mkdir(this.config.clonesDir, { recursive: true });
    await this.git.clone(this.config.repo, tempClonePath, {
      depth: 1,
      branch: baseBranch,
    });

    onProgress?.(`Creating branch ${metadata.branchName}...`, 3, 8);
    await this.git.createBranch(tempClonePath, metadata.branchName);
    await this.git.checkout(tempClonePath, metadata.branchName);

    onProgress?.(`Committing on ${metadata.branchName}...`, 4, 8);
    await this.git.commit(tempClonePath, 'chore: initial commit', { allowEmpty: true });

    onProgress?.(`Pushing ${metadata.branchName} to origin...`, 5, 8);
    await this.git.push(tempClonePath, {
      setUpstream: true,
      force: true,
      branch: metadata.branchName,
    });

    onProgress?.(`Opening draft PR: ${metadata.title}`, 6, 8);
    const pr = await this.github.createPR({
      repo: this.config.repoName,
      branch: metadata.branchName,
      baseBranch,
      title: metadata.title,
      body: metadata.body,
      draft: true,
    });

    onProgress?.(`Moving clone to pr-${pr.number}/...`, 7, 8);
    const clonePath = join(this.config.clonesDir, `pr-${pr.number}`);
    if (await pathExists(clonePath)) {
      await rm(clonePath, { recursive: true, force: true });
    }
    await rename(tempClonePath, clonePath);

    onProgress?.(`Starting session pr-${pr.number} and initializing Claude...`, 8, 8);
    const session = await this.resolveOrCreateSession(pr.number, clonePath);

    await this.handover.initialize(session.id, {
      prNumber: pr.number,
      branch: metadata.branchName,
      baseBranch,
      userPrompt: params.prompt,
      guidelines: this.formatGuidelines(),
      skipPermissions: params.skipPermissions,
    });

    return { pr, session, clonePath };
  }

  /**
   * Create a PR from an already-existing remote branch.
   *
   * 1. Create PR on GitHub
   * 2. Clone repository at that branch
   * 3. Create tmux session
   * 4. Initialize Claude
   */
  async createFromBranch(
    params: { branch: string; title: string; baseBranch?: string; skipPermissions?: boolean },
    onProgress?: ProgressCallback,
  ): Promise<{ pr: PullRequest; session: TmuxSession; clonePath: string }> {
    const baseBranch = params.baseBranch ?? this.config.baseBranch;

    onProgress?.(`Opening PR: ${params.branch} → ${baseBranch}...`, 1, 4);
    const pr = await this.github.createPR({
      repo: this.config.repoName,
      branch: params.branch,
      baseBranch,
      title: params.title,
      body: `PR created from existing branch: ${params.branch}`,
      draft: false,
    });

    const clonePath = join(this.config.clonesDir, `pr-${pr.number}`);
    const cloneExists = await pathExists(clonePath);

    if (!cloneExists) {
      onProgress?.(`Cloning ${this.config.repoName} at ${params.branch} (PR #${pr.number})...`, 2, 4);
      await mkdir(this.config.clonesDir, { recursive: true });
      await this.git.clone(this.config.repo, clonePath, {
        depth: 1,
        branch: params.branch,
      });
    } else {
      onProgress?.(`Using existing clone for PR #${pr.number}...`, 2, 4);
    }

    onProgress?.(`Starting session pr-${pr.number}...`, 3, 4);
    const session = await this.resolveOrCreateSession(pr.number, clonePath);

    onProgress?.(`Initializing Claude in pr-${pr.number}...`, 4, 4);
    const userPrompt = cloneExists
      ? `Resuming work on PR #${pr.number} from branch ${params.branch}\n\nThe repository is already cloned and ready. Waiting for your instructions.`
      : `Working on PR from existing branch: ${params.branch}`;

    await this.handover.initialize(session.id, {
      prNumber: pr.number,
      branch: params.branch,
      baseBranch,
      userPrompt,
      guidelines: this.formatGuidelines(),
      skipPermissions: params.skipPermissions,
    });

    return { pr, session, clonePath };
  }

  /**
   * Set up a local clone and tmux session for an existing GitHub PR.
   *
   * 1. Fetch PR details
   * 2. Clone (or reuse existing clone)
   * 3. Create tmux session
   * 4. Initialize Claude
   */
  async setupExisting(
    prNumber: number,
    onProgress?: ProgressCallback,
  ): Promise<{ pr: PullRequest; session: TmuxSession; clonePath: string }> {
    onProgress?.(`Fetching PR #${prNumber} from ${this.config.repoName}...`, 1, 4);
    const pr = await this.github.getPR(this.config.repoName, prNumber);
    if (!pr) {
      throw new MfhError(`PR #${prNumber} not found`);
    }

    const clonePath = join(this.config.clonesDir, `pr-${pr.number}`);
    const cloneExists = await pathExists(clonePath);

    if (!cloneExists) {
      onProgress?.(`Cloning ${this.config.repoName} at ${pr.branch}...`, 2, 4);
      await mkdir(this.config.clonesDir, { recursive: true });
      await this.git.clone(this.config.repo, clonePath, {
        depth: 1,
        branch: pr.branch,
      });
    } else {
      onProgress?.(`Clone exists for PR #${pr.number}, reusing...`, 2, 4);
    }

    onProgress?.(`Starting session pr-${pr.number}...`, 3, 4);
    const session = await this.resolveOrCreateSession(pr.number, clonePath);

    onProgress?.(`Initializing Claude in pr-${pr.number}...`, 4, 4);
    const userPrompt = cloneExists
      ? `Resuming work on PR #${pr.number}: ${pr.title}\n\nThe repository is already cloned and ready. Waiting for your instructions.`
      : `Continue working on: ${pr.title}`;

    await this.handover.initialize(session.id, {
      prNumber: pr.number,
      branch: pr.branch,
      baseBranch: pr.baseBranch,
      userPrompt,
      guidelines: this.formatGuidelines(),
    });

    return { pr, session, clonePath };
  }

  /**
   * Close a PR, kill its tmux session, and remove the local clone.
   */
  async close(
    prNumber: number,
    onProgress?: ProgressCallback,
  ): Promise<void> {
    onProgress?.(`Closing PR #${prNumber} on ${this.config.repoName}...`, 1, 3);
    await this.github.closePR(this.config.repoName, prNumber);

    onProgress?.(`Stopping session for PR #${prNumber}...`, 2, 3);
    const newId = `pr-${prNumber}`;
    const oldId = `${this.config.sessionPrefix}${prNumber}`;

    if (await this.tmux.exists(newId)) {
      await this.tmux.kill(newId);
    } else if (await this.tmux.exists(oldId)) {
      await this.tmux.kill(oldId);
    }

    onProgress?.(`Removing clone pr-${prNumber}/...`, 3, 3);
    const clonePath = join(this.config.clonesDir, `pr-${prNumber}`);
    if (await pathExists(clonePath)) {
      await rm(clonePath, { recursive: true, force: true });
    }
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  /**
   * Look for an existing tmux session under either naming convention.
   * Creates a new session with the modern `pr-X` name if none exists.
   */
  private async resolveOrCreateSession(
    prNumber: number,
    clonePath: string,
  ): Promise<TmuxSession> {
    const newId = `pr-${prNumber}`;
    const oldId = `${this.config.sessionPrefix}${prNumber}`;

    let session = await this.tmux.get(newId);
    if (!session) {
      session = await this.tmux.get(oldId);
    }
    if (!session) {
      session = await this.tmux.create({ id: newId, workingDir: clonePath });
    }

    return session;
  }

  private formatGuidelines(): string {
    if (!this.config.guidelines) {
      return '';
    }

    const parts: string[] = [];
    if (this.config.guidelines.branchFormat) {
      parts.push(`Branch format: ${this.config.guidelines.branchFormat}`);
    }
    if (this.config.guidelines.commitFormat) {
      parts.push(`Commit format: ${this.config.guidelines.commitFormat}`);
    }
    return parts.join('\n');
  }
}
