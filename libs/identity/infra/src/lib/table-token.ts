import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface TablePayload {
  readonly tenantId: string;
  readonly tableId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/**
 * How long a scanned QR stays valid.
 *
 * Long enough that a diner is never kicked out mid-meal, short enough that a
 * photo of the QR posted online stops working the same day.
 */
export const TABLE_TOKEN_HOURS = 8;

export function newTableSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Signs a token for one table.
 *
 * The signature uses the table's own secret rather than a global key, so
 * rotating one table's QR invalidates only that table.
 */
export function signTableToken(payload: TablePayload, tableSecret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', tableSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

/** Reads the claimed table without trusting it, so the secret can be looked up. */
export function peekTableToken(token: string): { tenantId: string; tableId: string } | null {
  const body = token.split('.')[0];
  if (body === undefined) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate['tenantId'] !== 'string' || typeof candidate['tableId'] !== 'string') {
      return null;
    }
    return { tenantId: candidate['tenantId'], tableId: candidate['tableId'] };
  } catch {
    return null;
  }
}

export function verifyTableToken(
  token: string,
  tableSecret: string,
  now: Date,
): TablePayload | null {
  const [body, signature] = token.split('.');
  if (body === undefined || signature === undefined) return null;

  const expected = createHmac('sha256', tableSecret).update(body).digest('base64url');
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);

  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate['tenantId'] !== 'string' ||
      typeof candidate['tableId'] !== 'string' ||
      typeof candidate['issuedAt'] !== 'number' ||
      typeof candidate['expiresAt'] !== 'number'
    ) {
      return null;
    }

    if (candidate['expiresAt'] <= now.getTime()) return null;

    return {
      tenantId: candidate['tenantId'],
      tableId: candidate['tableId'],
      issuedAt: candidate['issuedAt'],
      expiresAt: candidate['expiresAt'],
    };
  } catch {
    return null;
  }
}
