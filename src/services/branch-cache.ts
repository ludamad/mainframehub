/**
 * Branch Cache Service
 *
 * Maintains cached branch data per user and serves it quickly.
 * Invalidates cache on branch creation or after 30 minutes of inactivity.
 */

export interface Branch {
  name: string;
  protected: boolean;
}

interface CacheEntry {
  data: Branch[];
  timestamp: number;
  lastInteraction: number;
}

export class BranchCacheService {
  private cache = new Map<string, CacheEntry>();
  private updateInProgress = new Map<string, Promise<Branch[]>>();
  private readonly ttlMs = 30 * 60 * 1000; // 30 minutes

  constructor(
    private fetchBranches: (username: string) => Promise<Branch[]>
  ) {}

  /**
   * Get branches from cache if fresh, otherwise trigger update and return stale data
   * or wait for fresh data if no cache exists
   */
  async get(username: string): Promise<Branch[]> {
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
  async refresh(username: string): Promise<Branch[]> {
    // If already updating, wait for that
    if (this.updateInProgress.has(username)) {
      return this.updateInProgress.get(username)!;
    }

    const updatePromise = this.fetchBranches(username);
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

    const updatePromise = this.fetchBranches(username);
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
        console.error(`Background branch cache update failed for ${username}:`, error);
        // Keep stale cache on error
      })
      .finally(() => {
        this.updateInProgress.delete(username);
      });
  }

  /**
   * Invalidate cache for a specific user and trigger immediate refresh
   */
  async invalidate(username: string): Promise<Branch[]> {
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
