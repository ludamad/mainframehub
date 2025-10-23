/**
 * Session Discovery - The tmux-centric heart
 *
 * Discovers all sessions, then derives PR info from git working directory
 */

import type { TmuxService, TmuxSession } from './tmux.js';
import type { GitService, GitInfo } from './git.js';
import type { GitHubService, PullRequest } from './github.js';

export interface SessionState {
  session: TmuxSession;
  gitInfo: GitInfo | null;
  pr: PullRequest | null;
  // Derived
  hasGit: boolean;
  hasPR: boolean;
  isActive: boolean;
}

export class DiscoveryService {
  constructor(
    private tmux: TmuxService,
    private git: GitService,
    private github: GitHubService,
    private sessionPrefix: string
  ) {}

  /**
   * Discover all sessions and match them to PRs based on git info
   * This is the core tmux-centric operation that works with any session,
   * not just those with our prefix
   *
   * OPTIMIZED: Fetches all PRs once in bulk, then matches locally
   */
  async discover(): Promise<SessionState[]> {
    // Get ALL sessions (not just prefixed ones) for better PR detection
    const sessions = await this.tmux.list('');

    // Build repo -> branch -> PR map by fetching all PRs once
    const prMap = new Map<string, Map<string, PullRequest>>();

    // Collect all unique repos from sessions
    const repos = new Set<string>();
    for (const session of sessions) {
      try {
        const gitInfo = this.git.getInfo(session.workingDir);
        repos.add(gitInfo.repo);
      } catch {
        // Skip non-git sessions
      }
    }

    // Bulk fetch PRs for all repos
    await Promise.all(
      Array.from(repos).map(async (repo) => {
        try {
          const prs = await this.github.listPRs(repo, { state: 'open' });
          const branchMap = new Map<string, PullRequest>();
          for (const pr of prs) {
            // Store first PR for each branch (in case of duplicates)
            if (!branchMap.has(pr.branch)) {
              branchMap.set(pr.branch, pr);
            }
          }
          prMap.set(repo, branchMap);
        } catch (error) {
          // If fetching PRs for a repo fails, just skip it
          console.error(`Failed to fetch PRs for ${repo}:`, error);
        }
      })
    );

    // Discover all sessions with cached PR data
    const states = await Promise.all(
      sessions.map(s => this.discoverOneWithCache(s, prMap))
    );
    return states.filter((s): s is SessionState => s !== null);
  }

  /**
   * Discover a single session with cached PR data
   */
  private async discoverOneWithCache(
    session: TmuxSession,
    prMap: Map<string, Map<string, PullRequest>>
  ): Promise<SessionState | null> {
    try {
      // Try to get git info
      let gitInfo: GitInfo | null = null;
      let hasGit = false;

      try {
        gitInfo = this.git.getInfo(session.workingDir);
        hasGit = true;
      } catch {
        // Not a git repo or git failed
      }

      // Try to find PR if we have git info
      let pr: PullRequest | null = null;
      let hasPR = false;

      if (gitInfo) {
        // Look up PR from cached map (no API call)
        const branchMap = prMap.get(gitInfo.repo);
        if (branchMap) {
          pr = branchMap.get(gitInfo.branch) || null;
          hasPR = pr !== null;
        }
      }

      return {
        session,
        gitInfo,
        pr,
        hasGit,
        hasPR,
        isActive: session.attached,
      };
    } catch (error) {
      console.error(`Failed to discover session ${session.id}:`, error);
      return null;
    }
  }

  /**
   * Discover a single session (for backward compatibility and one-off lookups)
   */
  async discoverOne(session: TmuxSession): Promise<SessionState | null> {
    try {
      // Try to get git info
      let gitInfo: GitInfo | null = null;
      let hasGit = false;

      try {
        gitInfo = this.git.getInfo(session.workingDir);
        hasGit = true;
      } catch {
        // Not a git repo or git failed
      }

      // Try to find PR if we have git info
      let pr: PullRequest | null = null;
      let hasPR = false;

      if (gitInfo) {
        try {
          pr = await this.github.findPR({
            repo: gitInfo.repo,
            branch: gitInfo.branch,
          });
          hasPR = pr !== null;
        } catch {
          // PR not found or GitHub failed
        }
      }

      return {
        session,
        gitInfo,
        pr,
        hasGit,
        hasPR,
        isActive: session.attached,
      };
    } catch (error) {
      console.error(`Failed to discover session ${session.id}:`, error);
      return null;
    }
  }

  /**
   * Get session by PR number
   */
  async getByPRNumber(prNumber: number): Promise<SessionState | null> {
    const sessionId = `${this.sessionPrefix}${prNumber}`;
    const session = await this.tmux.get(sessionId);
    if (!session) return null;
    return this.discoverOne(session);
  }
}
