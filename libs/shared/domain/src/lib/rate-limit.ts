/**
 * Fixed-window rate limiting.
 *
 * Written rather than pulled in because the whole algorithm is twenty lines
 * and the interesting part is choosing the limits, not the counting. Fixed
 * windows let twice the limit through across a boundary; for stopping password
 * guessing and reset-mail floods that is entirely acceptable, and it costs one
 * integer per key instead of a list of timestamps.
 */

export interface RateLimitRule {
  /** How many requests are allowed inside one window. */
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Seconds until the window resets; what a Retry-After header should say. */
  readonly retryAfterSeconds: number;
}

interface Counter {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly rule: RateLimitRule) {}

  /** Records a hit against `key` and says whether it is allowed. */
  hit(key: string, now: number): RateLimitDecision {
    const existing = this.counters.get(key);

    if (existing === undefined || now >= existing.resetAt) {
      this.counters.set(key, { count: 1, resetAt: now + this.rule.windowMs });
      return {
        allowed: true,
        remaining: this.rule.limit - 1,
        retryAfterSeconds: Math.ceil(this.rule.windowMs / 1000),
      };
    }

    existing.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

    return {
      allowed: existing.count <= this.rule.limit,
      remaining: Math.max(0, this.rule.limit - existing.count),
      retryAfterSeconds,
    };
  }

  /**
   * Drops windows that have already reset.
   *
   * Without this the map grows one entry per address seen, forever — a slow
   * leak that only shows up after weeks of uptime.
   */
  prune(now: number): number {
    let removed = 0;
    for (const [key, counter] of this.counters) {
      if (now >= counter.resetAt) {
        this.counters.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.counters.size;
  }
}
