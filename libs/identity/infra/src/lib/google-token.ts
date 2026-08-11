import { createPublicKey, createVerify } from 'node:crypto';

/**
 * Verifies the ID token Google hands back after a sign-in.
 *
 * Written against Google's published contract rather than pulled from a
 * library: the checks that matter are few and explicit, and every one of them
 * is a place where a shortcut becomes an authentication bypass.
 */

export interface GoogleIdentity {
  /** Google's stable user id — the thing to link an account to. */
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string;
}

export type GoogleError =
  | { readonly kind: 'MALFORMED' }
  | { readonly kind: 'UNKNOWN_KEY'; readonly keyId: string }
  | { readonly kind: 'BAD_SIGNATURE' }
  | { readonly kind: 'WRONG_AUDIENCE' }
  | { readonly kind: 'WRONG_ISSUER' }
  | { readonly kind: 'EXPIRED' }
  | { readonly kind: 'EMAIL_NOT_VERIFIED' };

/** A JSON Web Key from Google's published set. */
export interface GoogleKey {
  readonly kid: string;
  readonly n: string;
  readonly e: string;
}

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

interface Header {
  alg?: unknown;
  kid?: unknown;
}

interface Claims {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
}

const decode = (segment: string): unknown => {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf-8')) as unknown;
  } catch {
    return null;
  }
};

/** Builds an RSA public key from a JWK, so `crypto` can verify against it. */
function toPublicKey(key: GoogleKey): ReturnType<typeof createPublicKey> {
  return createPublicKey({
    key: { kty: 'RSA', n: key.n, e: key.e },
    format: 'jwk',
  });
}

export function verifyGoogleIdToken(
  idToken: string,
  options: { clientId: string; keys: readonly GoogleKey[]; now: Date },
): GoogleIdentity | GoogleError {
  const [headerPart, claimsPart, signaturePart] = idToken.split('.');
  if (headerPart === undefined || claimsPart === undefined || signaturePart === undefined) {
    return { kind: 'MALFORMED' };
  }

  const header = decode(headerPart) as Header | null;
  const claims = decode(claimsPart) as Claims | null;
  if (header === null || claims === null) return { kind: 'MALFORMED' };

  // Only RS256. Accepting the token's own `alg` is how "none" attacks work.
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    return { kind: 'MALFORMED' };
  }

  const key = options.keys.find((candidate) => candidate.kid === header.kid);
  if (key === undefined) return { kind: 'UNKNOWN_KEY', keyId: header.kid };

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerPart}.${claimsPart}`);
  verifier.end();

  let signatureOk = false;
  try {
    signatureOk = verifier.verify(toPublicKey(key), Buffer.from(signaturePart, 'base64url'));
  } catch {
    return { kind: 'BAD_SIGNATURE' };
  }
  if (!signatureOk) return { kind: 'BAD_SIGNATURE' };

  // Audience before anything else: a validly signed token issued for a
  // different application must never be accepted here.
  if (claims.aud !== options.clientId) return { kind: 'WRONG_AUDIENCE' };
  if (typeof claims.iss !== 'string' || !ISSUERS.includes(claims.iss)) {
    return { kind: 'WRONG_ISSUER' };
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= options.now.getTime()) {
    return { kind: 'EXPIRED' };
  }
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
    return { kind: 'MALFORMED' };
  }

  // An unverified address could belong to anyone, and it is what accounts get
  // matched on — accepting it would let someone claim a colleague's account.
  if (claims.email_verified !== true) return { kind: 'EMAIL_NOT_VERIFIED' };

  return {
    subject: claims.sub,
    email: claims.email.toLowerCase(),
    emailVerified: true,
    name: typeof claims.name === 'string' ? claims.name : claims.email.split('@')[0] ?? 'usuario',
  };
}

export function isGoogleError(value: GoogleIdentity | GoogleError): value is GoogleError {
  return 'kind' in value;
}
