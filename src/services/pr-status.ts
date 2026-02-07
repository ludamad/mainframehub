/**
 * PRStatusService — groups the user's PRs by their local setup state.
 *
 * Produces four buckets for the tree view:
 *   - activeSession  — open PR + clone exists + tmux session running
 *   - hasClone       — open PR + clone exists, no session
 *   - notSetUp       — open PR, no local clone
 *   - closedWithClone — closed/merged PR that still has a local clone
 *
 * Clone detection scans `clonesDir` for `pr-{number}` directories.
 * Session detection checks both `pr-X` and `{prefix}X` naming conventions.
 * Orphaned clones (not matching any open PR) trigger individual PR fetches
 * to determine if they belong to closed/merged PRs.
 */

import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { TmuxService } from './tmux';
import type { GitHubService } from './github';
import type { PRCacheService } from './pr-cache';
import type { PullRequest, PRWithStatus, GroupedPRs } from '../interfaces';

interface Logger {
  appendLine(value: string): void;
}

export class PRStatusService {
  constructor(
    private tmux: TmuxService,
    private github: GitHubService,
    private prCache: PRCacheService,
    private clonesDir: string,
    private repoName: string,
    private sessionPrefix: string,
    private logger: Logger,
  ) {}

  /**
   * Build the grouped PR structure for the sidebar tree view.
   */
  async getGroupedPRs(username: string): Promise<GroupedPRs> {
    // 1. Fetch open PRs from cache.
    const openPRs = await this.prCache.get(username);

    // 2. Scan clone directories for pr-{number} folders.
    const cloneNumbers = await this.scanClones();

    // 3. Get all tmux session names.
    const sessionNames = await this.getSessionNames();

    // 4. Match open PRs to clones and sessions.
    const matchedClones = new Set<number>();

    const activeSession: PRWithStatus[] = [];
    const hasClone: PRWithStatus[] = [];
    const notSetUp: PRWithStatus[] = [];

    for (const pr of openPRs) {
      const cloneName = `pr-${pr.number}`;
      const clonePath = join(this.clonesDir, cloneName);
      const cloneExists = cloneNumbers.has(pr.number);

      const newSessionId = `pr-${pr.number}`;
      const oldSessionId = `${this.sessionPrefix}${pr.number}`;
      const hasNewSession = sessionNames.has(newSessionId);
      const hasOldSession = sessionNames.has(oldSessionId);
      const hasSession = cloneExists && (hasNewSession || hasOldSession);
      const sessionId = hasNewSession
        ? newSessionId
        : hasOldSession
          ? oldSessionId
          : newSessionId;

      const item: PRWithStatus = {
        pr,
        sessionId,
        cloneName,
        hasClone: cloneExists,
        hasSession,
        clonePath: cloneExists ? clonePath : null,
      };

      if (hasSession) {
        activeSession.push(item);
      } else if (cloneExists) {
        hasClone.push(item);
      } else {
        notSetUp.push(item);
      }

      if (cloneExists) {
        matchedClones.add(pr.number);
      }
    }

    // 5. Find orphaned clones (clone exists but no matching open PR).
    const closedWithClone: PRWithStatus[] = [];
    const orphanedNumbers = Array.from(cloneNumbers).filter(
      (n) => !matchedClones.has(n),
    );

    await Promise.all(
      orphanedNumbers.map(async (prNumber) => {
        try {
          const pr = await this.github.getPR(this.repoName, prNumber);
          if (!pr) {
            return;
          }

          if (pr.state === 'CLOSED' || pr.state === 'MERGED') {
            const cloneName = `pr-${prNumber}`;
            const clonePath = join(this.clonesDir, cloneName);
            const newSessionId = `pr-${prNumber}`;
            const oldSessionId = `${this.sessionPrefix}${prNumber}`;
            const hasNewSession = sessionNames.has(newSessionId);
            const hasOldSession = sessionNames.has(oldSessionId);
            const sessionId = hasNewSession
              ? newSessionId
              : hasOldSession
                ? oldSessionId
                : newSessionId;

            closedWithClone.push({
              pr,
              sessionId,
              cloneName,
              hasClone: true,
              hasSession: hasNewSession || hasOldSession,
              clonePath,
            });
          }
        } catch (err) {
          this.logger.appendLine(
            `[pr-status] Failed to fetch PR #${prNumber}: ${String(err)}`,
          );
        }
      }),
    );

    return { activeSession, hasClone, notSetUp, closedWithClone };
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  /**
   * Scan `clonesDir` for directories matching `pr-{number}` and return
   * the set of PR numbers found.
   */
  private async scanClones(): Promise<Set<number>> {
    const numbers = new Set<number>();

    try {
      const entries = await readdir(this.clonesDir);

      await Promise.all(
        entries.map(async (entry) => {
          const match = entry.match(/^pr-(\d+)$/);
          if (!match) {
            return;
          }

          const fullPath = join(this.clonesDir, entry);
          try {
            const info = await stat(fullPath);
            if (info.isDirectory()) {
              numbers.add(parseInt(match[1], 10));
            }
          } catch {
            // Entry disappeared between readdir and stat — ignore.
          }
        }),
      );
    } catch {
      // clonesDir does not exist yet — no clones.
    }

    return numbers;
  }

  /**
   * Get the set of all current tmux session names.
   */
  private async getSessionNames(): Promise<Set<string>> {
    const sessions = await this.tmux.list('');
    return new Set(sessions.map((s) => s.id));
  }
}
