import { RateLimiter } from './rate-limit';

const RULE = { limit: 3, windowMs: 60_000 };
const T0 = 1_000_000;

describe('RateLimiter', () => {
  it('allows requests up to the limit', () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.hit('1.2.3.4', T0).allowed).toBe(true);
    }
  });

  it('refuses the one past the limit', () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 3; i += 1) limiter.hit('1.2.3.4', T0);
    expect(limiter.hit('1.2.3.4', T0).allowed).toBe(false);
  });

  it('counts each caller separately', () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 3; i += 1) limiter.hit('1.2.3.4', T0);

    // One address exhausting its budget must not lock out everyone else.
    expect(limiter.hit('5.6.7.8', T0).allowed).toBe(true);
  });

  it('reports how many are left', () => {
    const limiter = new RateLimiter(RULE);
    expect(limiter.hit('a', T0).remaining).toBe(2);
    expect(limiter.hit('a', T0).remaining).toBe(1);
    expect(limiter.hit('a', T0).remaining).toBe(0);
  });

  it('never reports a negative remaining', () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 10; i += 1) limiter.hit('a', T0);
    expect(limiter.hit('a', T0).remaining).toBe(0);
  });

  it('opens up again once the window passes', () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 3; i += 1) limiter.hit('a', T0);
    expect(limiter.hit('a', T0).allowed).toBe(false);

    expect(limiter.hit('a', T0 + RULE.windowMs).allowed).toBe(true);
  });

  it('counts down the retry hint as the window elapses', () => {
    const limiter = new RateLimiter(RULE);
    limiter.hit('a', T0);
    expect(limiter.hit('a', T0 + 30_000).retryAfterSeconds).toBe(30);
  });

  it('never suggests retrying in zero seconds', () => {
    const limiter = new RateLimiter(RULE);
    limiter.hit('a', T0);
    // Right at the boundary the wait rounds to nothing, which would invite an
    // immediate retry that fails again.
    expect(limiter.hit('a', T0 + RULE.windowMs - 1).retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('forgets callers whose window has expired', () => {
    const limiter = new RateLimiter(RULE);
    limiter.hit('a', T0);
    limiter.hit('b', T0);
    expect(limiter.size).toBe(2);

    // Otherwise the map grows one entry per address, forever.
    expect(limiter.prune(T0 + RULE.windowMs)).toBe(2);
    expect(limiter.size).toBe(0);
  });

  it('keeps callers whose window is still open', () => {
    const limiter = new RateLimiter(RULE);
    limiter.hit('a', T0);
    expect(limiter.prune(T0 + 1_000)).toBe(0);
    expect(limiter.size).toBe(1);
  });
});
