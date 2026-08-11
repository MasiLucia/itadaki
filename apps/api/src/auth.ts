import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  type Permission,
  type Role,
  type TrialInput,
  can,
  canEditConfiguration,
  describeSubscription,
} from '@itadaki/identity/domain';
import { peekTableToken, verifyToken, verifyTableToken } from '@itadaki/identity/infra';
import { InMemoryTableStore, PostgresTableStore, PostgresTenantStore } from '@itadaki/identity/infra';
import { database } from './database';
import { type Request } from 'express';

const DEV_SECRET = 'desarrollo-inseguro-cambiar-en-produccion';

/**
 * Signing key for staff sessions.
 *
 * The development fallback is public, so booting with it outside development
 * would let anyone mint a valid admin token. Refusing to start is the only
 * safe behaviour — a warning would be ignored until it mattered.
 */
function resolveAuthSecret(): string {
  const configured = process.env['AUTH_SECRET'];
  const production = process.env['NODE_ENV'] === 'production';

  if (configured === undefined || configured === '') {
    if (production) {
      throw new Error('AUTH_SECRET is required in production');
    }
    return DEV_SECRET;
  }

  if (production && configured.length < 32) {
    throw new Error('AUTH_SECRET must be at least 32 characters in production');
  }
  return configured;
}

export const AUTH_SECRET = resolveAuthSecret();
export const USING_DEV_SECRET = AUTH_SECRET === DEV_SECRET;

export const SESSION_HOURS = 12;

/** Where a reset link points; the admin panel owns that screen. */
export const ADMIN_APP_URL = process.env['ADMIN_APP_URL'] ?? 'http://localhost:4400';

/** Tenant assumed for an anonymous diner with no table token yet. */
export const DEFAULT_TENANT = process.env['DEFAULT_TENANT'] ?? 'itadaki';

export interface AuthContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: Role;
  readonly displayName: string;
}

export interface AuthedRequest extends Request {
  auth?: AuthContext;
  /** Set by `TableScopeGuard` on `@TableScoped()` routes. */
  scope?: DinerScope;
}

/** Marks an endpoint as reachable without a session (login, diner routes). */
export const PUBLIC = 'itadaki:public';
export const Public = (): MethodDecorator => SetMetadata(PUBLIC, true);

/** Declares the permission an endpoint needs. */
export const PERMISSION = 'itadaki:permission';
export const RequirePermission = (permission: Permission): MethodDecorator =>
  SetMetadata(PERMISSION, permission);

/**
 * Resolves the caller from the bearer token.
 *
 * The tenant comes from the signed token, never from the request. That is the
 * whole point: `?tenant=` used to let anyone read another restaurant's data by
 * editing the URL.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const controller = context.getClass();

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [handler, controller]);
    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (token === '') {
      throw new UnauthorizedException({ kind: 'NO_SESSION' });
    }

    const payload = verifyToken(token, AUTH_SECRET, new Date());
    if (payload === null) {
      throw new UnauthorizedException({ kind: 'INVALID_SESSION' });
    }

    request.auth = {
      userId: payload.userId,
      tenantId: payload.tenantId,
      role: payload.role,
      displayName: payload.displayName,
    };

    const needed = this.reflector.getAllAndOverride<Permission>(PERMISSION, [handler, controller]);
    if (needed !== undefined && !can(payload.role, needed)) {
      throw new ForbiddenException({ kind: 'FORBIDDEN', permission: needed });
    }

    return true;
  }
}

/** Injects the verified session into a handler parameter. */
export const Auth = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthedRequest>();
  return request.auth;
});

/**
 * Tenant for the current request.
 *
 * A verified session always wins, even on a public endpoint: the guard skips
 * authentication there but a staff member who sends a token must still be
 * scoped to their own restaurant. Only a request with no token at all — a
 * diner following a QR — falls back to the query parameter.
 */
/**
 * Resolves the restaurant a scanned QR belongs to.
 *
 * The token claims a tenant and a table; the claim is only accepted after
 * checking the signature against that table's own secret. Returns null when
 * the token is missing, forged or expired.
 */
/**
 * Same switch the services use. Built per call rather than at module load so
 * importing this file never opens a connection — the guard runs in tests too.
 */
function tableStore(): PostgresTableStore | InMemoryTableStore {
  return process.env['USE_POSTGRES'] !== 'false'
    ? new PostgresTableStore(database)
    : new InMemoryTableStore();
}

export async function resolveTableToken(
  token: string | undefined,
): Promise<{ tenantId: string; tableId: string } | null> {
  if (token === undefined || token === '') return null;

  const claimed = peekTableToken(token);
  if (claimed === null) return null;

  const table = await tableStore().find(claimed.tenantId, claimed.tableId);
  if (table.isErr()) return null;

  const verified = verifyTableToken(token, table.value.secret, new Date());
  return verified === null ? null : { tenantId: verified.tenantId, tableId: verified.tableId };
}

/**
 * The table a diner request is allowed to act on.
 *
 * Public endpoints must not take the tenant from `?tenant=`: that parameter is
 * attacker-controlled, so pairing it with a guessed session id would be enough
 * to read or write another table's data. Every diner-facing handler resolves
 * its scope through here instead, and a staff token is accepted as well so the
 * same routes keep working from the admin and kitchen apps.
 */
export interface DinerScope {
  readonly tenantId: string;
  /** Null for a staff caller, who is not tied to any single table. */
  readonly tableId: string | null;
}

/**
 * Declares that a route is scoped to one table.
 *
 * `TableScopeGuard` then refuses the request unless it carries a signed table
 * token or a staff session, so a new diner-facing endpoint cannot be written
 * without the check — forgetting the decorator leaves the route unreachable
 * rather than silently open.
 */
export const TABLE_SCOPED = 'itadaki:table-scoped';
export const TableScoped = (): MethodDecorator => SetMetadata(TABLE_SCOPED, true);

/** Seam for tests: the real one needs a database to look the table secret up. */
export type TableTokenResolver = typeof resolveTableToken;

export async function resolveDinerScope(
  request: AuthedRequest,
  tableToken: string | undefined,
  resolve: TableTokenResolver = resolveTableToken,
): Promise<DinerScope | null> {
  // A verified staff session wins: it is strictly stronger than a table QR.
  if (request.auth !== undefined) {
    return { tenantId: request.auth.tenantId, tableId: null };
  }

  const header = request.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) {
    const payload = verifyToken(header.slice(7), AUTH_SECRET, new Date());
    if (payload !== null) {
      return { tenantId: payload.tenantId, tableId: null };
    }
  }

  const table = await resolve(tableToken);
  return table === null ? null : { tenantId: table.tenantId, tableId: table.tableId };
}

/**
 * Enforces `@TableScoped()`.
 *
 * Runs after `AuthGuard`, so a staff session is already on the request. The
 * resolved scope is cached there for `@Scope()` to read: the token is verified
 * against the database, and doing that twice per request would be wasteful.
 */
@Injectable()
export class TableScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /** Overridden in tests so the guard can run without a database. */
  protected resolveTable: TableTokenResolver = resolveTableToken;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scoped = this.reflector.getAllAndOverride<boolean>(TABLE_SCOPED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (scoped !== true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers['x-table-token'];
    const tableToken = typeof header === 'string' ? header : undefined;

    const scope = await resolveDinerScope(request, tableToken, this.resolveTable);
    if (scope === null) {
      throw new UnauthorizedException({ kind: 'INVALID_TABLE_TOKEN' });
    }

    request.scope = scope;
    return true;
  }
}

/**
 * Enforces the free trial on configuration changes.
 *
 * Deliberately narrow. It gates `menu:write` and `staff:manage` — the owner
 * editing their own setup — and nothing a diner or the kitchen touches. An
 * expired trial must never stop a table from ordering or a cook from seeing
 * the ticket: a restaurant burned mid-service does not become a customer.
 */
@Injectable()
export class TrialGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /** Overridden in tests so the guard runs without a database. */
  protected lookUp: (tenantId: string) => Promise<TrialInput | null> = async (tenantId) => {
    const found = await new PostgresTenantStore(database).subscriptionFor(tenantId);
    return found.isOk() ? found.value : null;
  };

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const needed = this.reflector.getAllAndOverride<Permission>(PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Reading is always allowed; only changes are gated.
    if (needed !== 'menu:write' && needed !== 'staff:manage') return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const tenantId = request.auth?.tenantId;
    if (tenantId === undefined) return true;

    const trial = await this.lookUp(tenantId);
    // A lookup failure must not lock a paying restaurant out of its own panel.
    if (trial === null) return true;

    if (!canEditConfiguration(describeSubscription(trial, new Date()))) {
      throw new ForbiddenException({ kind: 'TRIAL_EXPIRED' });
    }
    return true;
  }
}

/** Injects the scope resolved by `TableScopeGuard`. */
export const Scope = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthedRequest>();
  if (request.scope === undefined) {
    // Only reachable if a handler asks for the scope without declaring
    // @TableScoped(); failing loudly beats handing back an empty tenant.
    throw new UnauthorizedException({ kind: 'SCOPE_NOT_RESOLVED' });
  }
  return request.scope;
});

/**
 * Tenant for the current request.
 *
 * A verified staff session always wins. The `?tenant=` fallback that remains
 * is only sound for endpoints that expose nothing table-specific — the public
 * carte, which a diner has to be able to read before scanning anything.
 *
 * Do not reach for this on a route that touches a session, a bill or an order:
 * the parameter is caller-supplied, so it would let anyone pick the restaurant
 * they are asking about. Those routes use `@TableScoped()` + `@Scope()`, which
 * derive the tenant from a signed token instead.
 */
export const TenantId = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthedRequest>();
  if (request.auth !== undefined) {
    return request.auth.tenantId;
  }

  const header = request.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) {
    const payload = verifyToken(header.slice(7), AUTH_SECRET, new Date());
    if (payload !== null) {
      return payload.tenantId;
    }
  }

  const fromQuery = request.query['tenant'];
  return typeof fromQuery === 'string' && fromQuery !== '' ? fromQuery : DEFAULT_TENANT;
});
