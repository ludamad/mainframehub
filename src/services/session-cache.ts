/**
 * Session Cache Service
 *
 * Maintains cached session data and serves it quickly.
 * Periodically updates cache in the background to avoid slow API calls.
 */

import type { DiscoveryService, SessionState } from './discovery.js';

interface CacheEntry {
  data: SessionState[];
  timestamp: number;
}

export class SessionCacheService {
  private cache: CacheEntry | null = null;
  private updateInProgress = false;
  private updatePromise: Promise<SessionState[]> | null = null;

  constructor(
    private discovery: DiscoveryService,
    private ttlMs: number = 30000 // 30 seconds default
  ) {}

  /**
   * Get sessions from cache if fresh, otherwise trigger update and return stale data
   * or wait for fresh data if no cache exists
   */
  async get(): Promise<SessionState[]> {
    const now = Date.now();

    // If cache is fresh, return it immediately
    if (this.cache && (now - this.cache.timestamp) < this.ttlMs) {
      return this.cache.data;
    }

    // If update is already in progress, wait for it
    if (this.updateInProgress && this.updatePromise) {
      return this.updatePromise;
    }

    // If we have stale cache, return it and trigger background update
    if (this.cache) {
      this.triggerBackgroundUpdate();
      return this.cache.data;
    }

    // No cache exists, must wait for first load
    return this.refresh();
  }

  /**
   * Force refresh the cache (blocks until complete)
   */
  async refresh(): Promise<SessionState[]> {
    // If already updating, wait for that
    if (this.updateInProgress && this.updatePromise) {
      return this.updatePromise;
    }

    this.updateInProgress = true;
    this.updatePromise = this.discovery.discover();

    try {
      const data = await this.updatePromise;
      this.cache = {
        data,
        timestamp: Date.now()
      };
      return data;
    } finally {
      this.updateInProgress = false;
      this.updatePromise = null;
    }
  }

  /**
   * Trigger cache update in background without waiting
   */
  private triggerBackgroundUpdate(): void {
    if (this.updateInProgress) {
      return; // Already updating
    }

    this.updateInProgress = true;
    this.updatePromise = this.discovery.discover();

    this.updatePromise
      .then(data => {
        this.cache = {
          data,
          timestamp: Date.now()
        };
      })
      .catch(error => {
        console.error('Background session cache update failed:', error);
        // Keep stale cache on error
      })
      .finally(() => {
        this.updateInProgress = false;
        this.updatePromise = null;
      });
  }

  /**
   * Invalidate cache and trigger immediate refresh
   */
  async invalidate(): Promise<SessionState[]> {
    this.cache = null;
    return this.refresh();
  }

  /**
   * Get cache age in milliseconds (null if no cache)
   */
  getCacheAge(): number | null {
    if (!this.cache) return null;
    return Date.now() - this.cache.timestamp;
  }

  /**
   * Check if cache is fresh
   */
  isCacheFresh(): boolean {
    if (!this.cache) return false;
    return (Date.now() - this.cache.timestamp) < this.ttlMs;
  }
}
