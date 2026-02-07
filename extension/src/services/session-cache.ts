/**
 * SessionCacheService — caches the output of `DiscoveryService.discover()`
 * with stale-while-revalidate semantics and a short TTL (default 30 s).
 *
 * Behaviour:
 *   - First call blocks until data arrives (no stale data).
 *   - Subsequent calls within the TTL return cached data instantly.
 *   - After the TTL expires, stale data is returned immediately while a
 *     background refresh runs.
 *   - `invalidate()` clears the cache and forces a blocking refresh.
 */

import type { DiscoveryService } from './discovery';
import type { SessionState } from '../interfaces';

interface Logger {
  appendLine(value: string): void;
}

export class SessionCacheService {
  private cache: { data: SessionState[]; timestamp: number } | null = null;
  private updatePromise: Promise<SessionState[]> | null = null;
  private readonly ttlMs: number;

  constructor(
    private discovery: DiscoveryService,
    ttlSeconds: number,
    private logger: Logger,
  ) {
    this.ttlMs = ttlSeconds * 1_000;
  }

  /**
   * Return cached sessions.  Triggers a background refresh when stale;
   * blocks on the very first call.
   */
  async get(): Promise<SessionState[]> {
    const now = Date.now();

    if (this.cache && now - this.cache.timestamp < this.ttlMs) {
      return this.cache.data;
    }

    if (this.updatePromise) {
      return this.updatePromise;
    }

    if (this.cache) {
      this.triggerBackgroundUpdate();
      return this.cache.data;
    }

    return this.refresh();
  }

  /**
   * Force a blocking refresh.  Deduplicates concurrent calls.
   */
  async refresh(): Promise<SessionState[]> {
    if (this.updatePromise) {
      return this.updatePromise;
    }

    this.updatePromise = this.discovery.discover();

    try {
      const data = await this.updatePromise;
      this.cache = { data, timestamp: Date.now() };
      return data;
    } finally {
      this.updatePromise = null;
    }
  }

  /**
   * Clear the cache and perform a blocking refresh.
   */
  async invalidate(): Promise<SessionState[]> {
    this.cache = null;
    return this.refresh();
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  private triggerBackgroundUpdate(): void {
    if (this.updatePromise) {
      return;
    }

    this.updatePromise = this.discovery.discover();

    this.updatePromise
      .then((data) => {
        this.cache = { data, timestamp: Date.now() };
      })
      .catch((err) => {
        this.logger.appendLine(
          `[session-cache] Background refresh failed: ${String(err)}`,
        );
      })
      .finally(() => {
        this.updatePromise = null;
      });
  }
}
