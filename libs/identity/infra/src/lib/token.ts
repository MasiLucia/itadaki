import { createHmac, timingSafeEqual } from 'node:crypto';
import { type Role, isRole } from '@itadaki/identity/domain';

export interface TokenPayload {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: Role;
  readonly displayName: string;
  readonly expiresAt: number;
}

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

/**
 * Signed session token, HMAC-SHA256 over the payload.
 *
 * Hand-rolled rather than pulling a JWT library: the format is a subset of JWT
 * with one algorithm and no `alg` field, which sidesteps the algorithm-confusion
 * class of bug entirely.
 */
export function signToken(payload: TokenPayload, secret: string): string {
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyToken(token: string, secret: string, now: Date): TokenPayload | null {
  const [body, signature] = token.split('.');
  if (body === undefined || signature === undefined) return null;

  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);

  // Length check first: timingSafeEqual throws on mismatched sizes.
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate['userId'] !== 'string' ||
      typeof candidate['tenantId'] !== 'string' ||
      typeof candidate['displayName'] !== 'string' ||
      typeof candidate['role'] !== 'string' ||
      !isRole(candidate['role']) ||
      typeof candidate['expiresAt'] !== 'number'
    ) {
      return null;
    }

    if (candidate['expiresAt'] <= now.getTime()) return null;

    return {
      userId: candidate['userId'],
      tenantId: candidate['tenantId'],
      role: candidate['role'],
      displayName: candidate['displayName'],
      expiresAt: candidate['expiresAt'],
    };
  } catch {
    return null;
  }
}
