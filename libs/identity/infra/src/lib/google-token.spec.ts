import { createSign, generateKeyPairSync } from 'node:crypto';
import { type GoogleKey, isGoogleError, verifyGoogleIdToken } from './google-token';

const CLIENT_ID = '1234567890-abc.apps.googleusercontent.com';
const NOW = new Date('2026-08-07T12:00:00Z');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
const KEYS: readonly GoogleKey[] = [{ kid: 'test-key', n: jwk.n, e: jwk.e }];

const b64 = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/** Mints a token the way Google would, so the tests exercise the real path. */
function mint(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  signer = privateKey,
): string {
  const head = b64({ alg: 'RS256', kid: 'test-key', ...header });
  const body = b64({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '10987654321',
    email: 'ana@parrilla.ar',
    email_verified: true,
    name: 'Ana',
    exp: Math.floor(NOW.getTime() / 1000) + 3600,
    ...claims,
  });

  const signature = createSign('RSA-SHA256');
  signature.update(`${head}.${body}`);
  signature.end();
  return `${head}.${body}.${signature.sign(signer).toString('base64url')}`;
}

const verify = (token: string) =>
  verifyGoogleIdToken(token, { clientId: CLIENT_ID, keys: KEYS, now: NOW });

describe('verifying a Google ID token', () => {
  it('accepts a well-formed token and returns the identity', () => {
    const result = verify(mint());
    if (isGoogleError(result)) throw new Error(`expected an identity, got ${result.kind}`);

    expect(result.subject).toBe('10987654321');
    expect(result.email).toBe('ana@parrilla.ar');
    expect(result.name).toBe('Ana');
  });

  it('lowercases the address, since accounts are matched on it', () => {
    const result = verify(mint({ email: 'Ana@Parrilla.AR' }));
    if (isGoogleError(result)) throw new Error('expected an identity');
    expect(result.email).toBe('ana@parrilla.ar');
  });

  it('rejects a token signed by someone else', () => {
    const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const result = verify(mint({}, {}, attacker));
    if (!isGoogleError(result)) throw new Error('expected a rejection');
    expect(result.kind).toBe('BAD_SIGNATURE');
  });

  it('rejects a tampered payload', () => {
    const [head, , signature] = mint().split('.');
    const forged = b64({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'someone-else',
      email: 'dueno@itadaki.ar',
      email_verified: true,
      exp: Math.floor(NOW.getTime() / 1000) + 3600,
    });
    const result = verify(`${head}.${forged}.${signature}`);
    if (!isGoogleError(result)) throw new Error('expected a rejection');
    expect(result.kind).toBe('BAD_SIGNATURE');
  });

  it('refuses alg:none, the classic JWT bypass', () => {
    const head = b64({ alg: 'none', kid: 'test-key' });
    const body = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'x', email: 'x@y.z' });
    const result = verify(`${head}.${body}.`);
    if (!isGoogleError(result)) throw new Error('expected a rejection');
    expect(result.kind).toBe('MALFORMED');
  });

  it('refuses HS256, where the public key would double as the secret', () => {
    const result = verify(mint({}, { alg: 'HS256' }));
    if (!isGoogleError(result)) throw new Error('expected a rejection');
    expect(result.kind).toBe('MALFORMED');
  });

  it('rejects a token minted for a different application', () => {
    const result = verify(mint({ aud: 'someone-elses-client-id' }));
    if (!isGoogleError(result)) throw new Error('expected a rejection');
    expect(result.kind).toBe('WRONG_AUDIENCE');
  });

  it('rejects an issuer that is not Google', () => {
    const result = verify(mint({ iss: 'https://evil.example' }));
    if (!isGoogleError(result)) throw new Error('expected a rejection');
    expect(result.kind).toBe('WRONG_ISSUER');
  });

  it('accepts both issuer spellings Google uses', () => {
    const result = verify(mint({ iss: 'accounts.google.com' }));
    expect(isGoogleError(result)).toBe(false);
  });

  it('rejects an expired token', () => {
    const result = verify(mint({ exp: Math.floor(NOW.getTime() / 1000) - 1 }));
    if (!isGoogleError(result)) throw new Error('expected a rejection');
    expect(result.kind).toBe('EXPIRED');
  });

  it('rejects an unverified address, which anyone could claim', () => {
    const result = verify(mint({ email_verified: false }));
    if (!isGoogleError(result)) throw new Error('expected a rejection');
    expect(result.kind).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects a token signed with a key it does not know', () => {
    const result = verify(mint({}, { kid: 'rotated-away' }));
    if (!isGoogleError(result)) throw new Error('expected a rejection');
    expect(result.kind).toBe('UNKNOWN_KEY');
  });

  it('rejects anything that is not three segments', () => {
    for (const bad of ['', 'a', 'a.b', 'not-a-token']) {
      const result = verify(bad);
      if (!isGoogleError(result)) throw new Error(`expected a rejection for ${bad}`);
      expect(result.kind).toBe('MALFORMED');
    }
  });
});
