import { type ExecutionContext, HttpException } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { type AuthedRequest } from './auth';
import { LIMITS, type LimitName, RateLimitGuard } from './rate-limit.guard';

class TestableGuard extends RateLimitGuard {
  constructor(name: LimitName | undefined) {
    super({ getAllAndOverride: () => name } as unknown as Reflector);
  }
}

const headers: string[] = [];

const contextFor = (request: Partial<AuthedRequest>): ExecutionContext =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({
        setHeader: (name: string, value: string) => headers.push(`${name}: ${value}`),
      }),
    }),
  }) as unknown as ExecutionContext;

const from = (ip: string, email?: string): Partial<AuthedRequest> =>
  ({ ip, body: email === undefined ? {} : { email } }) as Partial<AuthedRequest>;

describe('RateLimitGuard', () => {
  beforeEach(() => {
    headers.length = 0;
  });

  it('lets an unlimited route through untouched', () => {
    const guard = new TestableGuard(undefined);
    for (let i = 0; i < 500; i += 1) {
      expect(guard.canActivate(contextFor(from('1.2.3.4')))).toBe(true);
    }
  });

  it('allows a normal number of login attempts', () => {
    const guard = new TestableGuard('login');
    // Someone retyping a password a few times must never be blocked.
    for (let i = 0; i < LIMITS.login.limit; i += 1) {
      expect(guard.canActivate(contextFor(from('1.2.3.4', 'ana@x.ar')))).toBe(true);
    }
  });

  it('stops a password guessing run', () => {
    const guard = new TestableGuard('login');
    for (let i = 0; i < LIMITS.login.limit; i += 1) {
      guard.canActivate(contextFor(from('1.2.3.4', 'ana@x.ar')));
    }

    expect(() => guard.canActivate(contextFor(from('1.2.3.4', 'ana@x.ar')))).toThrow(HttpException);
  });

  it('answers 429 with a retry hint', () => {
    const guard = new TestableGuard('login');
    for (let i = 0; i < LIMITS.login.limit; i += 1) {
      guard.canActivate(contextFor(from('1.2.3.4', 'ana@x.ar')));
    }

    try {
      guard.canActivate(contextFor(from('1.2.3.4', 'ana@x.ar')));
      throw new Error('expected a rejection');
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(429);
      expect(headers.some((header) => header.startsWith('Retry-After:'))).toBe(true);
    }
  });

  it('does not lock out a colleague on the same connection', () => {
    const guard = new TestableGuard('login');
    for (let i = 0; i < LIMITS.login.limit; i += 1) {
      guard.canActivate(contextFor(from('1.2.3.4', 'ana@x.ar')));
    }

    // A whole restaurant shares one IP; keying on the address too is what
    // keeps one person's typo from blocking the rest of the staff.
    expect(guard.canActivate(contextFor(from('1.2.3.4', 'beto@x.ar')))).toBe(true);
  });

  it('keeps separate budgets per network for diner traffic', () => {
    const guard = new TestableGuard('diner');
    for (let i = 0; i < LIMITS.diner.limit; i += 1) {
      guard.canActivate(contextFor(from('1.2.3.4')));
    }

    expect(() => guard.canActivate(contextFor(from('1.2.3.4')))).toThrow(HttpException);
    expect(guard.canActivate(contextFor(from('5.6.7.8')))).toBe(true);
  });

  it('gives a table room to browse a menu', () => {
    // Six phones tapping through a carte is ordinary traffic, not abuse.
    expect(LIMITS.diner.limit).toBeGreaterThanOrEqual(60);
  });

  it('keeps reset mails scarce', () => {
    // Each attempt sends mail to someone's inbox, so the budget is small.
    expect(LIMITS.passwordReset.limit).toBeLessThanOrEqual(5);
  });

  it('survives a request with no address at all', () => {
    const guard = new TestableGuard('diner');
    expect(guard.canActivate(contextFor({} as Partial<AuthedRequest>))).toBe(true);
  });
});
