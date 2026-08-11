import { hashPassword, verifyPassword } from './password';
import { signToken, verifyToken, type TokenPayload } from './token';

const SECRET = 'un-secreto-de-prueba-suficientemente-largo';
const NOW = new Date('2026-01-01T20:00:00Z');

const payload = (overrides: Partial<TokenPayload> = {}): TokenPayload => ({
  userId: 'u1',
  tenantId: 'itadaki',
  role: 'OWNER',
  displayName: 'Ana',
  expiresAt: NOW.getTime() + 3_600_000,
  ...overrides,
});

describe('password hashing', () => {
  it('accepts the right password', async () => {
    const stored = await hashPassword('contrasena-secreta');
    expect(await verifyPassword('contrasena-secreta', stored)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('contrasena-secreta');
    expect(await verifyPassword('otra-contrasena', stored)).toBe(false);
  });

  it('never stores the password itself', async () => {
    const stored = await hashPassword('contrasena-secreta');
    expect(stored).not.toContain('contrasena-secreta');
    expect(stored.startsWith('scrypt$')).toBe(true);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('misma-contrasena');
    const b = await hashPassword('misma-contrasena');
    expect(a).not.toBe(b);
    // Both still verify: the salt travels with the hash.
    expect(await verifyPassword('misma-contrasena', a)).toBe(true);
    expect(await verifyPassword('misma-contrasena', b)).toBe(true);
  });

  it('rejects a malformed stored value instead of throwing', async () => {
    expect(await verifyPassword('x', 'basura')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'md5$aa$bb')).toBe(false);
  });
});

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    const token = signToken(payload(), SECRET);
    const decoded = verifyToken(token, SECRET, NOW);

    expect(decoded).not.toBeNull();
    expect(decoded?.tenantId).toBe('itadaki');
    expect(decoded?.role).toBe('OWNER');
  });

  it('rejects a token signed with another secret', () => {
    const token = signToken(payload(), 'otro-secreto-completamente-distinto');
    expect(verifyToken(token, SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signToken(payload({ tenantId: 'itadaki' }), SECRET);
    const [body, signature] = token.split('.');

    // Re-encode the payload pointing at another restaurant, keep the signature.
    const forged = JSON.parse(Buffer.from(body ?? '', 'base64url').toString('utf-8')) as TokenPayload;
    const tamperedBody = Buffer.from(
      JSON.stringify({ ...forged, tenantId: 'parrilla-don-julio' }),
    ).toString('base64url');

    expect(verifyToken(`${tamperedBody}.${signature ?? ''}`, SECRET, NOW)).toBeNull();
  });

  it('rejects an escalated role', () => {
    const token = signToken(payload({ role: 'KITCHEN' }), SECRET);
    const [body, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(body ?? '', 'base64url').toString('utf-8')) as TokenPayload;
    const escalated = Buffer.from(JSON.stringify({ ...decoded, role: 'OWNER' })).toString('base64url');

    expect(verifyToken(`${escalated}.${signature ?? ''}`, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signToken(payload({ expiresAt: NOW.getTime() - 1 }), SECRET);
    expect(verifyToken(token, SECRET, NOW)).toBeNull();
  });

  it('rejects garbage', () => {
    for (const bad of ['', 'sin-punto', 'a.b', '....', 'null.null']) {
      expect(verifyToken(bad, SECRET, NOW)).toBeNull();
    }
  });

  it('rejects an unknown role value', () => {
    const body = Buffer.from(
      JSON.stringify({ ...payload(), role: 'SUPERADMIN' }),
    ).toString('base64url');
    const token = signToken(payload(), SECRET);
    const signature = token.split('.')[1] ?? '';
    expect(verifyToken(`${body}.${signature}`, SECRET, NOW)).toBeNull();
  });
});
