import { Injectable } from '@nestjs/common';
import { type GoogleKey } from '@itadaki/identity/infra';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * Google sign-in configuration and key material.
 *
 * The client id is public by design — it ships in the browser — so it lives in
 * an environment variable rather than the secret store. Sign-in is simply off
 * until one is configured, which keeps a missing value from looking like a bug.
 */
@Injectable()
export class GoogleService {
  readonly clientId = process.env['GOOGLE_CLIENT_ID'] ?? '';

  private cached: readonly GoogleKey[] = [];
  private fetchedAt = 0;

  get enabled(): boolean {
    return this.clientId !== '';
  }

  /**
   * Google's signing keys, cached for an hour.
   *
   * They rotate, so this cannot be pinned at boot; fetching per request would
   * put an external call on the login path.
   */
  async keys(): Promise<readonly GoogleKey[]> {
    const fresh = Date.now() - this.fetchedAt < 3_600_000;
    if (fresh && this.cached.length > 0) return this.cached;

    const response = await fetch(CERTS_URL);
    if (!response.ok) {
      // Serve stale keys rather than lock everyone out on a blip.
      return this.cached;
    }

    const body = (await response.json()) as { keys?: Array<Record<string, string>> };
    this.cached = (body.keys ?? [])
      .filter((key) => key['kid'] !== undefined && key['n'] !== undefined && key['e'] !== undefined)
      .map((key) => ({ kid: key['kid'] ?? '', n: key['n'] ?? '', e: key['e'] ?? '' }));
    this.fetchedAt = Date.now();
    return this.cached;
  }
}
