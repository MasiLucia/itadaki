import { Injectable, inject, signal } from '@angular/core';
import { type TableBlock, blockFrom } from '@itadaki/shared/domain';
import { API_BASE_URL } from './catalog.tokens';
import { TableTokenStore } from './table-token.store';

export { type TableBlock };

/**
 * Every call the diner makes to its own table.
 *
 * The API scopes those routes by the table's signed QR rather than a tenant
 * query parameter, so the token has to ride along on each request. Centralised
 * here so a new screen cannot forget the header and get a 401 in production.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly table = inject(TableTokenStore);

  /** Null when the diner has not scanned a QR — callers skip the request. */
  tableToken(): string | null {
    return this.table.token();
  }

  headers(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
    const token = this.table.token();
    return {
      ...extra,
      ...(token === null ? {} : { 'X-Table-Token': token }),
    };
  }

  /**
   * Set once the table stops being usable, and never cleared on its own.
   *
   * Every screen reads this instead of each one guessing from its own failed
   * request what a 401 meant.
   */
  readonly blocked = signal<TableBlock | null>(null);

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.headers((init.headers as Record<string, string>) ?? {}),
    });

    await this.noteIfBlocked(response, path);
    return response;
  }

  /**
   * Whether a path addresses the session record itself.
   *
   * `/sessions/<id>` and its sub-resources speak for the table; `/bills/<id>`
   * and `/calls/<id>` merely reference it, and are routinely absent.
   */
  private isSessionPath(path: string): boolean {
    return path.startsWith('/sessions/');
  }

  /**
   * Recognises the two failures a diner cannot retry past.
   *
   * The body is read from a clone so callers still get an unconsumed response.
   */
  private async noteIfBlocked(response: Response, path: string): Promise<void> {
    if (this.blocked() !== null) return;
    // A settled table answers 200 with status CLOSED, so success is inspected
    // too — not only the error codes.
    if (response.ok && response.status !== 200) return;

    const detail = (await response
      .clone()
      .json()
      .catch(() => null)) as { kind?: string; status?: string } | null;

    const block = blockFrom({
      status: response.status,
      kind: detail?.kind,
      sessionStatus: detail?.status,
      aboutSession: this.isSessionPath(path),
    });
    if (block !== null) this.blocked.set(block);
  }

  /** Called after joining a fresh table, which clears any earlier block. */
  unblock(): void {
    this.blocked.set(null);
  }

  /** Shorthand for the common JSON POST/PATCH. */
  send(path: string, method: string, body: unknown, extra: Record<string, string> = {}): Promise<Response> {
    return this.fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...extra },
      body: JSON.stringify(body),
    });
  }
}
