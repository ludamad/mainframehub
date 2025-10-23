/**
 * PR Cache Service
 *
 * Maintains cached PR data per user and serves it quickly.
 * Invalidates cache on PR creation or after 60 minutes of inactivity.
 */

import type { GitHubService, PullRequest } from './github.js';

interface CacheEntry {
  data: PullRequest[];
  timestamp: number;
  lastInteraction: number;
}

export class PRCacheService {
  private cache = new Map<string, CacheEntry>();
  private updateInProgress = new Map<string, Promise<PullRequest[]>>();
  private readonly ttlMs = 60 * 60 * 1000; // 60 minutes

  constructor(
    private github: GitHubService,
    private repoName: string
  ) {}

  /**
   * Get PRs from cache if fresh, otherwise trigger update and return stale data
   * or wait for fresh data if no cache exists
   */
  async get(username: string): Promise<PullRequest[]> {
    const now = Date.now();
    const entry = this.cache.get(username);

    // If cache exists and is fresh (within TTL since last interaction), return it
    if (entry && (now - entry.lastInteraction) < this.ttlMs) {
      // Update last interaction time
      entry.lastInteraction = now;
      return entry.data;
    }

    // If update is already in progress, wait for it
    if (this.updateInProgress.has(username)) {
      return this.updateInProgress.get(username)!;
    }

    // If we have stale cache, return it and trigger background update
    if (entry) {
      this.triggerBackgroundUpdate(username);
      return entry.data;
    }

    // No cache exists, must wait for first load
    return this.refresh(username);
  }

  /**
   * Force refresh the cache (blocks until complete)
   */
  async refresh(username: string): Promise<PullRequest[]> {
    // If already updating, wait for that
    if (this.updateInProgress.has(username)) {
      return this.updateInProgress.get(username)!;
    }

    const updatePromise = this.github.listPRs(this.repoName, {
      state: 'open',
      author: username
    });

    this.updateInProgress.set(username, updatePromise);

    try {
      const data = await updatePromise;
      const now = Date.now();
      this.cache.set(username, {
        data,
        timestamp: now,
        lastInteraction: now
      });
      return data;
    } finally {
      this.updateInProgress.delete(username);
    }
  }

  /**
   * Trigger cache update in background without waiting
   */
  private triggerBackgroundUpdate(username: string): void {
    if (this.updateInProgress.has(username)) {
      return; // Already updating
    }

    const updatePromise = this.github.listPRs(this.repoName, {
      state: 'open',
      author: username
    });

    this.updateInProgress.set(username, updatePromise);

    updatePromise
      .then(data => {
        const now = Date.now();
        const existing = this.cache.get(username);
        this.cache.set(username, {
          data,
          timestamp: now,
          lastInteraction: existing?.lastInteraction || now
        });
      })
      .catch(error => {
        console.error(`Background PR cache update failed for ${username}:`, error);
        // Keep stale cache on error
      })
      .finally(() => {
        this.updateInProgress.delete(username);
      });
  }

  /**
   * Invalidate cache for a specific user and trigger immediate refresh
   */
  async invalidate(username: string): Promise<PullRequest[]> {
    this.cache.delete(username);
    return this.refresh(username);
  }

  /**
   * Invalidate all user caches
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Get cache age in milliseconds (null if no cache)
   */
  getCacheAge(username: string): number | null {
    const entry = this.cache.get(username);
    if (!entry) return null;
    return Date.now() - entry.timestamp;
  }

  /**
   * Check if cache is fresh for a user
   */
  isCacheFresh(username: string): boolean {
    const entry = this.cache.get(username);
    if (!entry) return false;
    return (Date.now() - entry.lastInteraction) < this.ttlMs;
  }

  /**
   * Mark user interaction (resets TTL timer)
   */
  markInteraction(username: string): void {
    const entry = this.cache.get(username);
    if (entry) {
      entry.lastInteraction = Date.now();
    }
  }
}
