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

/**
 * El número de mesa que viaja dentro del token del QR.
 *
 * Sólo para mostrarlo: se lee el cuerpo sin comprobar la firma, que es cosa de
 * la API. Alguien podría escribirse un token con el número que quiera y ver ese
 * cartel — no gana nada, porque cualquier pedido lo valida el servidor contra
 * la firma real.
 *
 * Existe `peekTableToken` en identity/infra, pero usa `Buffer` y es de Node.
 */
function tableFromToken(token: string | null): string | null {
  if (token === null) return null;

  const body = token.split('.')[0];
  if (body === undefined) return null;

  try {
    // base64url a base64: el token viaja en una URL, así que trae - y _.
    const base64 = body.replaceAll('-', '+').replaceAll('_', '/');
    const parsed = JSON.parse(atob(base64)) as { tableId?: unknown };
    if (typeof parsed.tableId !== 'string') return null;

    // Del id "mesa-01" cuelga sólo el número, que es lo impreso en la mesa.
    return /(\d+)\s*$/.exec(parsed.tableId)?.[1] ?? parsed.tableId;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class TableTokenStore {
  readonly token = signal<string | null>(CAPTURED ?? localStorage.getItem(STORAGE_KEY));
  readonly hasToken = computed(() => this.token() !== null);

  /** La mesa que dice el QR, disponible antes de unirse. */
  readonly tableLabel = computed(() => tableFromToken(this.token()));

  clear(): void {
    this.token.set(null);
    localStorage.removeItem(STORAGE_KEY);
  }
}
