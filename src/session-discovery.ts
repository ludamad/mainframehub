/**
 * Session Discovery Service - The heart of the tmux-centric architecture
 *
 * This service discovers all tmux sessions, then derives PR information
 * from the git repository in each session's working directory.
 *
 * Flow:
 * 1. List tmux sessions with our prefix
 * 2. For each session, get its working directory
 * 3. If working directory is a git repo:
 *    a. Get remote URL and parse owner/repo
 *    b. Get current branch
 *    c. Query GitHub for PR matching repo+branch
 * 4. Return complete session states
 */

import type {
  ISessionDiscoveryService,
  ITmuxService,
  IGitService,
  IGitHubService,
  SessionState,
  Config,
  parseRepo,
} from './interfaces.js';

export class SessionDiscoveryService implements ISessionDiscoveryService {
  constructor(
    private tmux: ITmuxService,
    private git: IGitService,
    private github: IGitHubService,
    private config: Config
  ) {}

  /**
   * Discover all sessions and their states
   * Now discovers ALL sessions (not just prefixed) and matches them to PRs
   * based on their git repository and branch
   */
  async discover(): Promise<SessionState[]> {
    // Get ALL sessions for better PR detection
    const sessions = await this.tmux.list('');

    const states = await Promise.all(
      sessions.map(session => this.discoverSession(session))
    );

    return states.filter((s): s is SessionState => s !== null);
  }

  /**
   * Discover a specific session by ID
   */
  async discoverOne(sessionId: string): Promise<SessionState | null> {
    const session = await this.tmux.get(sessionId);
    if (!session) return null;

    return this.discoverSession(session);
  }

  /**
   * Discover the state of a single session
   */
  private async discoverSession(session: {
    id: string;
    workingDir: string;
    created: Date;
    attached: boolean;
  }): Promise<SessionState | null> {
    try {
      // Try to get git info from working directory
      let gitInfo = null;
      let hasValidGit = false;

      try {
        gitInfo = await this.git.getInfo(session.workingDir);
        hasValidGit = true;
      } catch (error) {
        // Working directory is not a git repo or git commands failed
        console.warn(`Session ${session.id} has invalid git: ${error}`);
      }

      // Try to find matching PR if we have git info
      let pr = null;
      let hasPR = false;

      if (gitInfo) {
        try {
          pr = await this.github.findPR({
            repo: gitInfo.repo,
            branch: gitInfo.branch,
          });
          hasPR = pr !== null;
        } catch (error) {
          console.warn(`Failed to find PR for session ${session.id}: ${error}`);
        }
      }

      return {
        session: {
          id: session.id,
          workingDir: session.workingDir,
          created: session.created,
          attached: session.attached,
        },
        workingDir: session.workingDir,
        gitInfo,
        pr,
        hasValidGit,
        hasPR,
        isActive: session.attached,
      };
    } catch (error) {
      console.error(`Failed to discover session ${session.id}:`, error);
      return null;
    }
  }

  /**
   * Filter states by various criteria
   */
  static filterByPR(states: SessionState[]): SessionState[] {
    return states.filter(s => s.hasPR);
  }

  static filterByRepo(states: SessionState[], repo: string): SessionState[] {
    return states.filter(s => s.gitInfo?.repo === repo);
  }

  static filterActive(states: SessionState[]): SessionState[] {
    return states.filter(s => s.isActive);
  }

  static groupByPR(states: SessionState[]): Map<number, SessionState> {
    const map = new Map<number, SessionState>();
    states.forEach(state => {
      if (state.pr) {
        map.set(state.pr.number, state);
      }
    });
    return map;
  }
}
