/**
 * PRCacheService — per-user cache of open pull requests with
 * stale-while-revalidate semantics.
 *
 * Behaviour:
 *   - First call for a user blocks until data arrives (no stale data).
 *   - Subsequent calls return cached data immediately.
 *   - When the TTL expires the cached data is still returned, but a
 *     background refresh is kicked off.
 *   - `invalidate()` clears the cache and forces a blocking refresh.
 *   - `lastInteraction` is updated on every `get()` so the cache stays
 *     warm while the user is active.
 */

import type { GitHubService } from './github';
import type { PullRequest } from '../interfaces';

interface CacheEntry {
  data: PullRequest[];
  timestamp: number;
  lastInteraction: number;
}

interface Logger {
  appendLine(value: string): void;
}

export class PRCacheService {
  private cache = new Map<string, CacheEntry>();
  private updateInProgress = new Map<string, Promise<PullRequest[]>>();
  private readonly ttlMs: number;

  constructor(
    private github: GitHubService,
    private repoName: string,
    ttlMinutes: number,
    private logger: Logger,
  ) {
    this.ttlMs = ttlMinutes * 60 * 1_000;
  }

  /**
   * Return cached PRs for `username`.  When the cache is stale a background
   * refresh is started; when no cache exists the call blocks.
   */
  async get(username: string): Promise<PullRequest[]> {
    const now = Date.now();
    const entry = this.cache.get(username);

    if (entry && now - entry.lastInteraction < this.ttlMs) {
      entry.lastInteraction = now;
      return entry.data;
    }

    if (this.updateInProgress.has(username)) {
      return this.updateInProgress.get(username)!;
    }

    if (entry) {
      this.triggerBackgroundUpdate(username);
      entry.lastInteraction = now;
      return entry.data;
    }

    return this.refresh(username);
  }

  /**
   * Force a blocking refresh.  If a refresh is already in progress the
   * existing promise is returned (deduplication).
   */
  async refresh(username: string): Promise<PullRequest[]> {
    if (this.updateInProgress.has(username)) {
      return this.updateInProgress.get(username)!;
    }

    const promise = this.fetchPRs(username);
    this.updateInProgress.set(username, promise);

    try {
      const data = await promise;
      const now = Date.now();
      this.cache.set(username, { data, timestamp: now, lastInteraction: now });
      return data;
    } finally {
      this.updateInProgress.delete(username);
    }
  }

  /**
   * Invalidate the cache for `username` and trigger a blocking refresh.
   */
  async invalidate(username: string): Promise<PullRequest[]> {
    this.cache.delete(username);
    return this.refresh(username);
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  private triggerBackgroundUpdate(username: string): void {
    if (this.updateInProgress.has(username)) {
      return;
    }

    const promise = this.fetchPRs(username);
    this.updateInProgress.set(username, promise);

    promise
      .then((data) => {
        const now = Date.now();
        const existing = this.cache.get(username);
        this.cache.set(username, {
          data,
          timestamp: now,
          lastInteraction: existing?.lastInteraction ?? now,
        });
      })
      .catch((err) => {
        this.logger.appendLine(
          `[pr-cache] Background refresh failed for ${username}: ${String(err)}`,
        );
      })
      .finally(() => {
        this.updateInProgress.delete(username);
      });
  }

  private async fetchPRs(username: string): Promise<PullRequest[]> {
    return this.github.listPRs(this.repoName, {
      state: 'open',
      author: username,
    });
  }
}
