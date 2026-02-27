/**
 * DiscoveryService — the tmux-centric heart of session discovery.
 *
 * Lists all tmux sessions, reads their git working-directory info, and
 * matches each session to an open GitHub PR via a bulk-fetched branch map.
 *
 * Performance: PRs are fetched once per unique repo (not per session),
 * and branch-to-PR lookup is O(1) via a `Map`.
 */

import type { TmuxService } from './tmux';
import type { GitService } from './git';
import type { GitHubService } from './github';
import type { SessionState, TmuxSession, GitInfo, PullRequest } from '../interfaces';

interface Logger {
  appendLine(value: string): void;
}

export class DiscoveryService {
  constructor(
    private tmux: TmuxService,
    private git: GitService,
    private github: GitHubService,
    private sessionPrefix: string,
    private logger: Logger,
  ) {}

  /**
   * Discover all tmux sessions and match them to open PRs.
   *
   * 1. List every tmux session (no prefix filter — we want full visibility).
   * 2. Collect unique repos from git info.
   * 3. Bulk-fetch open PRs for each repo.
   * 4. Match sessions to PRs via branch name.
   */
  async discover(): Promise<SessionState[]> {
    const sessions = await this.tmux.list('');

    // Collect git info per session (non-git sessions get null).
    const sessionGitPairs: Array<{
      session: TmuxSession;
      gitInfo: GitInfo | null;
    }> = [];

    const repos = new Set<string>();

    for (const session of sessions) {
      try {
        const gitInfo = await this.git.getInfo(session.workingDir);
        sessionGitPairs.push({ session, gitInfo });
        repos.add(gitInfo.repo);
      } catch {
        sessionGitPairs.push({ session, gitInfo: null });
      }
    }

    // Bulk-fetch open PRs for every unique repo.
    const prMap = new Map<string, Map<string, PullRequest>>();

    await Promise.all(
      Array.from(repos).map(async (repo) => {
        try {
          const prs = await this.github.listPRs(repo, { state: 'open' });
          const branchMap = new Map<string, PullRequest>();
          for (const pr of prs) {
            if (!branchMap.has(pr.branch)) {
              branchMap.set(pr.branch, pr);
            }
          }
          prMap.set(repo, branchMap);
        } catch (err) {
          this.logger.appendLine(
            `[discovery] Failed to fetch PRs for ${repo}: ${String(err)}`,
          );
        }
      }),
    );

    // Match each session to a PR.
    return sessionGitPairs.map(({ session, gitInfo }) => {
      let pr: PullRequest | null = null;

      if (gitInfo) {
        const branchMap = prMap.get(gitInfo.repo);
        if (branchMap) {
          pr = branchMap.get(gitInfo.branch) ?? null;
        }
      }

      return {
        session,
        gitInfo,
        pr,
        hasGit: gitInfo !== null,
        hasPR: pr !== null,
        isActive: session.attached,
      };
    });
  }

  /**
   * Discover a single session (one-off lookup — hits GitHub API directly).
   */
  async discoverOne(session: TmuxSession): Promise<SessionState> {
    let gitInfo: GitInfo | null = null;

    try {
      gitInfo = await this.git.getInfo(session.workingDir);
    } catch {
      // Not a git repo or git failed.
    }

    let pr: PullRequest | null = null;

    if (gitInfo) {
      try {
        pr = await this.github.findPR({
          repo: gitInfo.repo,
          branch: gitInfo.branch,
        });
      } catch {
        // GitHub lookup failed — treat as no PR.
      }
    }

    return {
      session,
      gitInfo,
      pr,
      hasGit: gitInfo !== null,
      hasPR: pr !== null,
      isActive: session.attached,
    };
  }

  /**
   * Look up a session by PR number.  Checks both the modern `pr-X` and
   * legacy `{prefix}X` naming conventions.
   */
  async getByPRNumber(prNumber: number): Promise<SessionState | null> {
    const newId = `pr-${prNumber}`;
    const oldId = `${this.sessionPrefix}${prNumber}`;

    let session = await this.tmux.get(newId);
    if (!session) {
      session = await this.tmux.get(oldId);
    }
    if (!session) {
      return null;
    }

    return this.discoverOne(session);
  }
}
