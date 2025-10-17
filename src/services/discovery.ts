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
   * Discover all sessions with our prefix
   */
  async discover(): Promise<SessionState[]> {
    const sessions = await this.tmux.list(this.sessionPrefix);
    const states = await Promise.all(
      sessions.map(s => this.discoverOne(s))
    );
    return states.filter((s): s is SessionState => s !== null);
  }

  /**
   * Discover a single session
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
