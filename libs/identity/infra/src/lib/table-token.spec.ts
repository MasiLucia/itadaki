import { createHmac } from 'node:crypto';
import {
  type TablePayload,
  newTableSecret,
  peekTableToken,
  signTableToken,
  verifyTableToken,
} from './table-token';

const NOW = new Date('2026-01-01T20:00:00Z');
const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);

const payload = (overrides: Partial<TablePayload> = {}): TablePayload => ({
  tenantId: 'itadaki',
  tableId: 'mesa-07',
  issuedAt: NOW.getTime(),
  expiresAt: NOW.getTime() + 8 * 3_600_000,
  ...overrides,
});

describe('table tokens', () => {
  it('round-trips a valid token', () => {
    const token = signTableToken(payload(), SECRET_A);
    const decoded = verifyTableToken(token, SECRET_A, NOW);

    expect(decoded?.tenantId).toBe('itadaki');
    expect(decoded?.tableId).toBe('mesa-07');
  });

  it('rejects a token signed with another table secret', () => {
    // The QR of table 7 must not work on table 9.
    const token = signTableToken(payload(), SECRET_A);
    expect(verifyTableToken(token, SECRET_B, NOW)).toBeNull();
  });

  it('rejects a tampered tenant', () => {
    const token = signTableToken(payload(), SECRET_A);
    const [body, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(body ?? '', 'base64url').toString()) as TablePayload;
    const forged = Buffer.from(
      JSON.stringify({ ...decoded, tenantId: 'parrilla-don-julio' }),
    ).toString('base64url');

    expect(verifyTableToken(`${forged}.${signature ?? ''}`, SECRET_A, NOW)).toBeNull();
  });

  it('rejects a tampered table', () => {
    const token = signTableToken(payload(), SECRET_A);
    const [body, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(body ?? '', 'base64url').toString()) as TablePayload;
    const forged = Buffer.from(JSON.stringify({ ...decoded, tableId: 'mesa-99' })).toString(
      'base64url',
    );

    expect(verifyTableToken(`${forged}.${signature ?? ''}`, SECRET_A, NOW)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signTableToken(payload({ expiresAt: NOW.getTime() - 1 }), SECRET_A);
    expect(verifyTableToken(token, SECRET_A, NOW)).toBeNull();
  });

  it('rejects garbage', () => {
    for (const bad of ['', 'sin-punto', 'a.b', 'null.null']) {
      expect(verifyTableToken(bad, SECRET_A, NOW)).toBeNull();
    }
  });

  it('peeks the claimed table without verifying', () => {
    // Needed to look up which secret to check against.
    const token = signTableToken(payload(), SECRET_A);
    expect(peekTableToken(token)).toEqual({ tenantId: 'itadaki', tableId: 'mesa-07' });
  });

  it('returns null when peeking garbage', () => {
    expect(peekTableToken('basura')).toBeNull();
    expect(peekTableToken('')).toBeNull();
  });

  it('generates distinct secrets', () => {
    const secrets = new Set(Array.from({ length: 20 }, () => newTableSecret()));
    expect(secrets.size).toBe(20);
  });
});

describe('the QR printed on the table', () => {
  /** A year later the sticker is still on the same table. */
  const MUCH_LATER = new Date('2027-06-01T13:00:00Z');

  const printed = (overrides: Partial<TablePayload> = {}): TablePayload => ({
    tenantId: 'itadaki',
    tableId: 'mesa-07',
    issuedAt: NOW.getTime(),
    ...overrides,
  });

  it('still works long after it was printed', () => {
    // The diner cannot "scan it again" when the paper is what went stale.
    const token = signTableToken(printed(), SECRET_A);
    expect(verifyTableToken(token, SECRET_A, MUCH_LATER)?.tableId).toBe('mesa-07');
  });

  it('carries no expiry at all', () => {
    const token = signTableToken(printed(), SECRET_A);
    expect(verifyTableToken(token, SECRET_A, NOW)?.expiresAt).toBeUndefined();
  });

  it('stops working once the table secret is rotated', () => {
    // Rotating is what invalidates a printed QR, since time no longer does.
    const token = signTableToken(printed(), SECRET_A);
    expect(verifyTableToken(token, SECRET_B, MUCH_LATER)).toBeNull();
  });

  it('is still bound to its own table', () => {
    const token = signTableToken(printed({ tableId: 'mesa-09' }), SECRET_A);
    expect(verifyTableToken(token, SECRET_A, MUCH_LATER)?.tableId).toBe('mesa-09');
  });

  it('rejects a token whose expiry is present but malformed', () => {
    // Absent means permanent; garbage means broken, and must not read as permanent.
    const body = Buffer.from(
      JSON.stringify({ ...printed(), expiresAt: 'nunca' }),
    ).toString('base64url');
    const signature = createHmac('sha256', SECRET_A).update(body).digest('base64url');
    expect(verifyTableToken(`${body}.${signature}`, SECRET_A, NOW)).toBeNull();
  });
});
