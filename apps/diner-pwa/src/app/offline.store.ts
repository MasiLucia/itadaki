import { Injectable, inject, signal } from '@angular/core';
import {
  type OutboxEntry,
  backoffMs,
  classify,
  nextEntry,
} from '@itadaki/shared/offline';
import { ApiClient } from './api-client';

const DB_NAME = 'itadaki';
const DB_VERSION = 1;
const OUTBOX = 'outbox';
const CACHE = 'cache';

/**
 * Offline queue backed by IndexedDB.
 *
 * The diner keeps building an order with no signal; each write lands here and
 * is replayed on reconnect. Because every entry carries its own idempotency
 * key, a replay that the server already saw is a no-op rather than a duplicate.
 */
@Injectable({ providedIn: 'root' })
export class OfflineStore {
  private readonly api = inject(ApiClient);
  private db: IDBDatabase | null = null;
  private flushing = false;

  readonly online = signal(navigator.onLine);
  readonly pending = signal(0);

  constructor() {
    globalThis.addEventListener('online', () => {
      this.online.set(true);
      void this.flush();
    });
    globalThis.addEventListener('offline', () => this.online.set(false));

    void this.open().then(() => {
      void this.refreshCount();
      void this.flush();
    });
  }

  private open(): Promise<IDBDatabase> {
    if (this.db !== null) return Promise.resolve(this.db);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE);
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = run(db.transaction(store, mode).objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** Caches the menu so the carte renders instantly, and at all, without signal. */
  async cacheMenu(menu: unknown): Promise<void> {
    await this.tx(CACHE, 'readwrite', (store) => store.put(menu, 'menu'));
  }

  async cachedMenu<T>(): Promise<T | null> {
    const found = await this.tx<T | undefined>(CACHE, 'readonly', (store) => store.get('menu'));
    return found ?? null;
  }

  /**
   * Queues a write for the next time there is signal.
   *
   * `id` doubles as the idempotency key on replay, so a caller that already
   * minted one passes it in: an order that half-reached the kitchen before the
   * connection dropped must not become a second ticket when it is retried.
   */
  async enqueue(
    url: string,
    method: 'POST' | 'PATCH',
    body: unknown,
    id: string = crypto.randomUUID(),
  ): Promise<string> {
    const entry: OutboxEntry = {
      id,
      url,
      method,
      body,
      queuedAt: Date.now(),
      attempts: 0,
    };

    await this.tx(OUTBOX, 'readwrite', (store) => store.put(entry));
    await this.refreshCount();
    void this.flush();
    return entry.id;
  }

  private async all(): Promise<readonly OutboxEntry[]> {
    return this.tx<OutboxEntry[]>(OUTBOX, 'readonly', (store) => store.getAll());
  }

  private async refreshCount(): Promise<void> {
    this.pending.set((await this.all()).length);
  }

  /** Sends queued writes oldest-first, stopping at the first one that cannot go. */
  async flush(): Promise<void> {
    if (this.flushing || !this.online()) return;
    this.flushing = true;

    try {
      for (;;) {
        const queue = await this.all();
        const entry = nextEntry(queue);
        if (entry === null) break;

        let status: number | null = null;
        try {
          // Replayed writes carry the table token too — the API scopes these
          // routes by the QR, not by a tenant parameter.
          const response = await this.api.send(entry.url, entry.method, entry.body, {
            'Idempotency-Key': entry.id,
          });
          status = response.status;
        } catch {
          status = null;
        }

        const outcome = classify(entry, status);

        if (outcome.kind === 'sent' || outcome.kind === 'dropped') {
          await this.tx(OUTBOX, 'readwrite', (store) => store.delete(entry.id));
          await this.refreshCount();
          continue;
        }

        // Keep it and stop: order matters, so nothing behind it may jump ahead.
        await this.tx(OUTBOX, 'readwrite', (store) =>
          store.put({ ...entry, attempts: entry.attempts + 1 }),
        );

        if (outcome.reason === 'offline') {
          this.online.set(false);
        } else {
          globalThis.setTimeout(() => void this.flush(), backoffMs(entry.attempts + 1));
        }
        break;
      }
    } finally {
      this.flushing = false;
    }
  }
}
