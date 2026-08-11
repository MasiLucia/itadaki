import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * How long a reset link stays usable.
 *
 * Short on purpose: the link is a bearer credential sitting in an inbox, and
 * an hour is enough for someone who just asked for it.
 */
export const RESET_TOKEN_MINUTES = 60;

/**
 * Creates a reset token and the value to store for it.
 *
 * Only the digest is persisted — a leaked database must not hand anyone a
 * working reset link, the same reason passwords are never stored either.
 */
export function newResetToken(): { token: string; digest: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, digest: digestOf(token) };
}

export function digestOf(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** Constant-time comparison, so a wrong token leaks nothing through timing. */
export function digestMatches(token: string, storedDigest: string): boolean {
  const given = Buffer.from(digestOf(token));
  const want = Buffer.from(storedDigest);
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}
