import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { type Permission, type TrialInput, trialEndFor } from '@itadaki/identity/domain';
import { type AuthedRequest, TrialGuard } from './auth';

const NOW = new Date();
const inDays = (days: number): Date => new Date(NOW.getTime() + days * 86_400_000);

class TestableGuard extends TrialGuard {
  constructor(permission: Permission | undefined, trial: TrialInput | null) {
    super({ getAllAndOverride: () => permission } as unknown as Reflector);
    this.lookUp = async () => trial;
  }
}

const contextFor = (request: AuthedRequest): ExecutionContext =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const signedIn = (): AuthedRequest =>
  ({
    headers: {},
    auth: { userId: 'u1', tenantId: 't1', role: 'OWNER', displayName: 'Ana' },
  }) as unknown as AuthedRequest;

const expired: TrialInput = { trialEndsAt: inDays(-1), paid: false };
const running: TrialInput = { trialEndsAt: inDays(10), paid: false };

describe('TrialGuard', () => {
  it('blocks menu edits once the trial is over', async () => {
    const guard = new TestableGuard('menu:write', expired);
    await expect(guard.canActivate(contextFor(signedIn()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('blocks team changes once the trial is over', async () => {
    const guard = new TestableGuard('staff:manage', expired);
    await expect(guard.canActivate(contextFor(signedIn()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('still lets the owner read their own menu', async () => {
    const guard = new TestableGuard('menu:read', expired);
    await expect(guard.canActivate(contextFor(signedIn()))).resolves.toBe(true);
  });

  it('never stops the kitchen from working', async () => {
    // The whole point of gating configuration only: an expired trial must not
    // strand a room full of diners mid-service.
    for (const permission of ['orders:read', 'orders:advance'] as Permission[]) {
      const guard = new TestableGuard(permission, expired);
      await expect(guard.canActivate(contextFor(signedIn()))).resolves.toBe(true);
    }
  });

  it('never stops a bill from being closed', async () => {
    const guard = new TestableGuard('bills:close', expired);
    await expect(guard.canActivate(contextFor(signedIn()))).resolves.toBe(true);
  });

  it('leaves diner routes alone — they carry no permission at all', async () => {
    const guard = new TestableGuard(undefined, expired);
    await expect(guard.canActivate(contextFor(signedIn()))).resolves.toBe(true);
  });

  it('allows edits while the trial is running', async () => {
    const guard = new TestableGuard('menu:write', running);
    await expect(guard.canActivate(contextFor(signedIn()))).resolves.toBe(true);
  });

  it('allows edits for a paid restaurant with a long-past trial', async () => {
    const guard = new TestableGuard('menu:write', { trialEndsAt: inDays(-90), paid: true });
    await expect(guard.canActivate(contextFor(signedIn()))).resolves.toBe(true);
  });

  it('allows edits when no trial was ever recorded', async () => {
    const guard = new TestableGuard('menu:write', { trialEndsAt: null, paid: false });
    await expect(guard.canActivate(contextFor(signedIn()))).resolves.toBe(true);
  });

  it('fails open when the lookup itself fails', async () => {
    // A database blip must not lock a paying restaurant out of its own panel.
    const guard = new TestableGuard('menu:write', null);
    await expect(guard.canActivate(contextFor(signedIn()))).resolves.toBe(true);
  });

  it('allows edits on the final day of the trial', async () => {
    const guard = new TestableGuard('menu:write', { trialEndsAt: inDays(1), paid: false });
    await expect(guard.canActivate(contextFor(signedIn()))).resolves.toBe(true);
  });

  it('gives a brand new restaurant the full month', async () => {
    const guard = new TestableGuard('menu:write', {
      trialEndsAt: trialEndFor(NOW),
      paid: false,
    });
    await expect(guard.canActivate(contextFor(signedIn()))).resolves.toBe(true);
  });
});
