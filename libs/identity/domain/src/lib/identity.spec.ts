import { MIN_PASSWORD_LENGTH, isSessionValid, normaliseEmail, validateCredentials } from './staff';
import { PERMISSIONS, ROLES, can, isRole, permissionsOf } from './role';

describe('roles and permissions', () => {
  it('gives the owner everything', () => {
    for (const permission of PERMISSIONS) {
      expect(can('OWNER', permission)).toBe(true);
    }
  });

  it('keeps kitchen staff away from prices', () => {
    expect(can('KITCHEN', 'menu:write')).toBe(false);
    expect(can('KITCHEN', 'metrics:read')).toBe(false);
    expect(can('KITCHEN', 'staff:manage')).toBe(false);
  });

  it('lets kitchen staff move tickets', () => {
    expect(can('KITCHEN', 'orders:read')).toBe(true);
    expect(can('KITCHEN', 'orders:advance')).toBe(true);
  });

  it('lets a waiter close a bill but not edit the menu', () => {
    expect(can('WAITER', 'bills:close')).toBe(true);
    expect(can('WAITER', 'menu:write')).toBe(false);
  });

  it('reserves staff management for the owner', () => {
    expect(can('MANAGER', 'staff:manage')).toBe(false);
    expect(can('OWNER', 'staff:manage')).toBe(true);
  });

  it('grants no permission outside the declared list', () => {
    for (const role of ROLES) {
      for (const permission of permissionsOf(role)) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it('recognises valid role names', () => {
    expect(isRole('OWNER')).toBe(true);
    expect(isRole('ADMIN')).toBe(false);
  });
});

describe('credentials', () => {
  it('accepts a valid pair', () => {
    const result = validateCredentials('Ana@Itadaki.AR', 'contrasena-larga');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.email).toBe('ana@itadaki.ar');
  });

  it('normalises case and surrounding space', () => {
    expect(normaliseEmail('  Ana@ITADAKI.ar ')).toBe('ana@itadaki.ar');
  });

  it('rejects a malformed address', () => {
    for (const email of ['ana', 'ana@', '@itadaki.ar', 'ana itadaki.ar']) {
      const result = validateCredentials(email, 'contrasena-larga');
      expect(result.isErr()).toBe(true);
    }
  });

  it('rejects a short password', () => {
    const result = validateCredentials('ana@itadaki.ar', 'corta');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('PASSWORD_TOO_SHORT');
  });

  it('accepts exactly the minimum length', () => {
    const result = validateCredentials('ana@itadaki.ar', 'a'.repeat(MIN_PASSWORD_LENGTH));
    expect(result.isOk()).toBe(true);
  });
});

describe('session expiry', () => {
  const session = (expiresAt: Date) => ({
    userId: 'u1',
    tenantId: 't1',
    role: 'OWNER' as const,
    displayName: 'Ana',
    expiresAt,
  });

  it('is valid before expiry', () => {
    const now = new Date('2026-01-01T20:00:00Z');
    expect(isSessionValid(session(new Date('2026-01-01T21:00:00Z')), now)).toBe(true);
  });

  it('is invalid after expiry', () => {
    const now = new Date('2026-01-01T20:00:00Z');
    expect(isSessionValid(session(new Date('2026-01-01T19:59:59Z')), now)).toBe(false);
  });
});
