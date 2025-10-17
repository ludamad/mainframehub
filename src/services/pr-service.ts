/**
 * PR Service - Orchestrates the full PR workflow
 */

import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import type { TmuxService, TmuxSession } from './tmux.js';
import type { GitService } from './git.js';
import type { GitHubService, PullRequest } from './github.js';
import type { ClaudeService } from './claude.js';
import type { ClaudeHandoverService } from './handover.js';

export interface Config {
  repo: string;          // Full git URL
  repoName: string;      // 'owner/repo' format
  clonesDir: string;
  baseBranch: string;
  sessionPrefix: string;
  guidelines?: {
    branchFormat?: string;
    commitFormat?: string;
  };
}

export class PRService {
  constructor(
    private tmux: TmuxService,
    private git: GitService,
    private github: GitHubService,
    private claude: ClaudeService,
    private handover: ClaudeHandoverService,
    private config: Config
  ) {}

  /**
   * Create a new PR from scratch
   *
   * Flow:
   * 1. Generate metadata with Claude Haiku (fast title generation)
   * 2. Clone repository
   * 3. Create and checkout branch
   * 4. Create empty commit
   * 5. Push branch to remote (branch now exists with commits)
   * 6. Create PR on GitHub (now branch has commits)
   * 7. Create tmux session
   * 8. Initialize Claude session with context
   */
  async createNew(params: {
    prompt: string;
    baseBranch?: string;
  }): Promise<{
    pr: PullRequest;
    session: TmuxSession;
    clonePath: string;
  }> {
    const baseBranch = params.baseBranch || this.config.baseBranch;

    console.log('[1/8] Generating metadata with Claude Haiku...');
    const metadata = await this.claude.generateMetadata(params.prompt, {
      guidelines: this.config.guidelines?.branchFormat,
      model: 'haiku',
    });

    console.log(`[2/8] Cloning repository...`);
    // Use timestamp for clone path since we don't have PR number yet
    const timestamp = Date.now();
    const tempClonePath = join(this.config.clonesDir, `temp-${timestamp}`);
    if (!existsSync(this.config.clonesDir)) {
      mkdirSync(this.config.clonesDir, { recursive: true });
    }
    this.git.clone(this.config.repo, tempClonePath, { depth: 1, branch: baseBranch });

    console.log('[3/8] Creating and checking out branch...');
    this.git.createBranch(tempClonePath, metadata.branchName);
    this.git.checkout(tempClonePath, metadata.branchName);

    console.log('[4/8] Creating empty commit...');
    const commitMsg = this.config.guidelines?.commitFormat || 'chore: initial commit';
    this.git.commit(tempClonePath, commitMsg, { allowEmpty: true });

    console.log('[5/8] Pushing branch to remote...');
    this.git.push(tempClonePath, {
      setUpstream: true,
      force: true,
      branch: metadata.branchName,
    });

    console.log(`[6/8] Creating PR on GitHub: ${metadata.title}...`);
    const pr = await this.github.createPR({
      repo: this.config.repoName,
      branch: metadata.branchName,
      baseBranch,
      title: metadata.title,
      body: metadata.body,
      draft: true,
    });

    console.log(`[7/8] Renaming clone to pr-${pr.number}...`);
    const clonePath = join(this.config.clonesDir, `pr-${pr.number}`);
    if (existsSync(clonePath)) {
      rmSync(clonePath, { recursive: true, force: true });
    }
    // Rename directory
    const { renameSync } = await import('fs');
    renameSync(tempClonePath, clonePath);

    console.log('[8/8] Creating tmux session...');
    const sessionId = `${this.config.sessionPrefix}${pr.number}`;
    const session = await this.tmux.create({
      id: sessionId,
      workingDir: clonePath,
    });

    await this.handover.initialize(sessionId, {
      prNumber: pr.number,
      branch: metadata.branchName,
      baseBranch,
      userPrompt: params.prompt,
      guidelines: this.formatGuidelines(),
    });

    console.log(`✓ PR #${pr.number} created and session started!`);
    return { pr, session, clonePath };
  }

  /**
   * Create a PR from an existing branch
   *
   * Flow:
   * 1. Create PR on GitHub for existing branch
   * 2. Clone repository at that branch
   * 3. Create tmux session
   */
  async createFromBranch(params: {
    branchName: string;
    title: string;
    baseBranch?: string;
  }): Promise<{
    pr: PullRequest;
    session: TmuxSession;
    clonePath: string;
  }> {
    const baseBranch = params.baseBranch || this.config.baseBranch;

    console.log(`[1/4] Creating PR for branch ${params.branchName}...`);
    const pr = await this.github.createPR({
      repo: this.config.repoName,
      branch: params.branchName,
      baseBranch,
      title: params.title,
      body: `PR created from existing branch: ${params.branchName}`,
      draft: false,
    });

    console.log(`[2/4] Cloning repository (PR #${pr.number})...`);
    const clonePath = join(this.config.clonesDir, `pr-${pr.number}`);
    if (!existsSync(this.config.clonesDir)) {
      mkdirSync(this.config.clonesDir, { recursive: true });
    }

    if (existsSync(clonePath)) {
      throw new Error(`Clone already exists at ${clonePath}`);
    }

    this.git.clone(this.config.repo, clonePath, {
      depth: 1,
      branch: params.branchName,
    });

    console.log('[3/4] Creating tmux session...');
    const sessionId = `${this.config.sessionPrefix}${pr.number}`;
    const session = await this.tmux.create({
      id: sessionId,
      workingDir: clonePath,
    });

    console.log('[4/4] Initializing Claude session...');
    await this.handover.initialize(sessionId, {
      prNumber: pr.number,
      branch: params.branchName,
      baseBranch,
      userPrompt: `Working on PR from existing branch: ${params.branchName}`,
      guidelines: this.formatGuidelines(),
    });

    console.log(`✓ PR #${pr.number} created from branch and session started!`);
    return { pr, session, clonePath };
  }

  /**
   * Setup an existing PR
   *
   * Flow:
   * 1. Get PR details from GitHub
   * 2. Clone the PR's branch
   * 3. Create tmux session
   * 4. Initialize Claude with PR context
   */
  async setupExisting(prNumber: number): Promise<{
    pr: PullRequest;
    session: TmuxSession;
    clonePath: string;
  }> {
    console.log(`[1/4] Getting PR #${prNumber} details...`);
    const pr = await this.github.getPR(this.config.repoName, prNumber);
    if (!pr) {
      throw new Error(`PR #${prNumber} not found`);
    }

    console.log('[2/4] Cloning repository...');
    const clonePath = join(this.config.clonesDir, `pr-${pr.number}`);

    if (existsSync(clonePath)) {
      throw new Error(`Clone already exists at ${clonePath}`);
    }

    if (!existsSync(this.config.clonesDir)) {
      mkdirSync(this.config.clonesDir, { recursive: true });
    }

    this.git.clone(this.config.repo, clonePath, {
      depth: 1,
      branch: pr.branch,
    });

    console.log('[3/4] Creating tmux session...');
    const sessionId = `${this.config.sessionPrefix}${pr.number}`;
    const session = await this.tmux.create({
      id: sessionId,
      workingDir: clonePath,
    });

    console.log('[4/4] Initializing Claude session...');
    await this.handover.initialize(sessionId, {
      prNumber: pr.number,
      branch: pr.branch,
      baseBranch: pr.baseBranch,
      userPrompt: `Continue working on: ${pr.title}`,
      guidelines: this.formatGuidelines(),
    });

    console.log(`✓ PR #${pr.number} set up and session started!`);
    return { pr, session, clonePath };
  }

  /**
   * Close a PR and cleanup
   *
   * Flow:
   * 1. Close PR on GitHub (mocked if mockWrites=true)
   * 2. Kill tmux session if exists
   * 3. Remove clone directory
   */
  async close(prNumber: number): Promise<void> {
    console.log(`[1/3] Closing PR #${prNumber} on GitHub...`);
    await this.github.closePR(this.config.repoName, prNumber);

    const sessionId = `${this.config.sessionPrefix}${prNumber}`;

    console.log('[2/3] Killing tmux session...');
    if (await this.tmux.exists(sessionId)) {
      await this.tmux.kill(sessionId);
    }

    console.log('[3/3] Removing clone directory...');
    const clonePath = join(this.config.clonesDir, `pr-${prNumber}`);
    if (existsSync(clonePath)) {
      rmSync(clonePath, { recursive: true, force: true });
    }

    console.log(`✓ PR #${prNumber} closed and cleaned up!`);
  }

  private formatGuidelines(): string {
    if (!this.config.guidelines) return '';

    const parts = [];
    if (this.config.guidelines.branchFormat) {
      parts.push(`Branch format: ${this.config.guidelines.branchFormat}`);
    }
    if (this.config.guidelines.commitFormat) {
      parts.push(`Commit format: ${this.config.guidelines.commitFormat}`);
    }
    return parts.join('\n');
  }
}
