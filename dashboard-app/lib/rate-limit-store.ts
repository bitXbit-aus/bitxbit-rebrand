export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimitStore {
  /**
   * Atomically increments the counter for `key` and returns whether the request
   * is allowed under the configured window and maximum request count.
   */
  increment(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult>;
}

interface MemoryEntry {
  count: number;
  resetAt: number;
}

/**
 * Single-instance, in-memory rate limit store. Suitable for local development
 * and single-instance deployments; not consistent across serverless function
 * instances.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly store = new Map<string, MemoryEntry>();

  private cleanupExpiredEntries(now: number) {
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
      }
    }
  }

  async increment(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    this.cleanupExpiredEntries(now);

    const entry = this.store.get(key);

    if (!entry || entry.resetAt <= now) {
      const resetAt = now + windowMs;
      this.store.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: maxRequests - 1, resetAt };
    }

    if (entry.count >= maxRequests) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count += 1;
    return {
      allowed: true,
      remaining: maxRequests - entry.count,
      resetAt: entry.resetAt,
    };
  }
}
