export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
  retryAfterSeconds?: number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly config: RateLimitConfig;
  private readonly now: () => number;

  constructor(config: RateLimitConfig, now?: () => number) {
    this.config = config;
    this.now = now ?? (() => Date.now());
  }

  check(key: string): RateLimitResult {
    const currentTime = this.now();
    const windowStart = currentTime - this.config.windowMs;

    // Prune stale keys if map grows large to prevent memory leaks
    if (this.hits.size > 2000) {
      for (const [k, ts] of this.hits.entries()) {
        if (ts.length === 0 || ts[ts.length - 1] <= windowStart) {
          this.hits.delete(k);
        }
      }
    }

    const timestamps = this.hits.get(key) ?? [];
    const validTimestamps = timestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= this.config.maxRequests) {
      const oldestValid = validTimestamps[0];
      const resetAtMs = oldestValid + this.config.windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - currentTime) / 1000));

      this.hits.set(key, validTimestamps);
      return {
        allowed: false,
        remaining: 0,
        resetAtMs,
        retryAfterSeconds,
      };
    }

    validTimestamps.push(currentTime);
    this.hits.set(key, validTimestamps);

    return {
      allowed: true,
      remaining: Math.max(0, this.config.maxRequests - validTimestamps.length),
      resetAtMs: currentTime + this.config.windowMs,
    };
  }

  reset(key?: string) {
    if (key) {
      this.hits.delete(key);
    } else {
      this.hits.clear();
    }
  }
}

// Default global limiters
export const createInterviewRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60 * 1000, // 1 minute window
  maxRequests: 10, // max 10 creates per minute per user
});

export const submitAnswerRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60 * 1000, // 1 minute window
  maxRequests: 30, // max 30 submissions per minute per user
});
