import { Injectable, computed, signal } from '@angular/core';

const STORAGE_KEY = 'itadaki.table-token';

/**
 * Holds the token from the scanned QR.
 *
 * It is what proves which restaurant and which table the diner is at, so the
 * app no longer guesses either. Kept in storage because the URL parameter is
 * gone after the first navigation.
 */
/**
 * Captures `?t=` before Angular boots.
 *
 * The router resolves `'' → bienvenida` without carrying query parameters
 * over, so by the time this service is first injected the token can already be
 * gone from the URL. Reading it at module load — which happens before
 * `bootstrapApplication` — is what makes a scanned QR survive that redirect.
 */
function captureFromUrl(): string | null {
  const fromUrl = new URLSearchParams(globalThis.location.search).get('t');
  if (fromUrl === null || fromUrl === '') return null;

  localStorage.setItem(STORAGE_KEY, fromUrl);

  // Drop it from the address bar: a shared screenshot of the URL should
  // not hand someone else a working table token.
  const clean = new URL(globalThis.location.href);
  clean.searchParams.delete('t');
  globalThis.history.replaceState({}, '', clean.toString());

  return fromUrl;
}

const CAPTURED = captureFromUrl();

@Injectable({ providedIn: 'root' })
export class TableTokenStore {
  readonly token = signal<string | null>(CAPTURED ?? localStorage.getItem(STORAGE_KEY));
  readonly hasToken = computed(() => this.token() !== null);

  clear(): void {
    this.token.set(null);
    localStorage.removeItem(STORAGE_KEY);
  }
}
