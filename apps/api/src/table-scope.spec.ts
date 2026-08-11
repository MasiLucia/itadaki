import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { type AuthedRequest, type DinerScope, TableScopeGuard } from './auth';

/** Stands in for the real resolver, which needs the table secret from Postgres. */
const resolverFor = (
  scope: { tenantId: string; tableId: string } | null,
): ((token: string | undefined) => Promise<{ tenantId: string; tableId: string } | null>) =>
  async (token) => (token === undefined || token === '' ? null : scope);

class TestableGuard extends TableScopeGuard {
  constructor(
    scoped: boolean,
    resolved: { tenantId: string; tableId: string } | null,
  ) {
    super({ getAllAndOverride: () => scoped } as unknown as Reflector);
    this.resolveTable = resolverFor(resolved);
  }
}

const contextFor = (request: AuthedRequest): ExecutionContext =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const requestWith = (
  headers: Record<string, string> = {},
  auth?: AuthedRequest['auth'],
): AuthedRequest => ({ headers, auth }) as unknown as AuthedRequest;

const TABLE = { tenantId: 'itadaki', tableId: 'mesa-7' };

describe('TableScopeGuard', () => {
  it('lets a route through untouched when it is not table-scoped', async () => {
    const guard = new TestableGuard(false, TABLE);
    const request = requestWith();

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    // Nothing to inject: the handler never asked to be scoped.
    expect(request.scope).toBeUndefined();
  });

  it('rejects a scoped route with no credentials at all', async () => {
    const guard = new TestableGuard(true, TABLE);

    await expect(guard.canActivate(contextFor(requestWith()))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a scoped route when the table token does not verify', async () => {
    const guard = new TestableGuard(true, null);

    await expect(
      guard.canActivate(contextFor(requestWith({ 'x-table-token': 'forged' }))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('ignores a tenant query parameter — it is caller-supplied', async () => {
    const guard = new TestableGuard(true, TABLE);
    const request = {
      headers: {},
      query: { tenant: 'itadaki' },
    } as unknown as AuthedRequest;

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('admits a signed table token and publishes its scope', async () => {
    const guard = new TestableGuard(true, TABLE);
    const request = requestWith({ 'x-table-token': 'signed' });

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.scope).toEqual<DinerScope>({ tenantId: 'itadaki', tableId: 'mesa-7' });
  });

  it('admits a staff session without a table token, unbound to any table', async () => {
    const guard = new TestableGuard(true, TABLE);
    const request = requestWith({}, {
      userId: 'u1',
      tenantId: 'itadaki',
      role: 'OWNER',
      displayName: 'ana',
    });

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    // tableId null is what lets the kitchen read any table in its restaurant.
    expect(request.scope).toEqual<DinerScope>({ tenantId: 'itadaki', tableId: null });
  });

  it('prefers the staff session over a table token from another restaurant', async () => {
    const guard = new TestableGuard(true, { tenantId: 'parrilla-don-julio', tableId: 'mesa-1' });
    const request = requestWith({ 'x-table-token': 'signed' }, {
      userId: 'u1',
      tenantId: 'itadaki',
      role: 'OWNER',
      displayName: 'ana',
    });

    await guard.canActivate(contextFor(request));
    expect(request.scope?.tenantId).toBe('itadaki');
  });
});
