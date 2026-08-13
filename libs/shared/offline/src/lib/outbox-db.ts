import { type OutboxEntry, backoffMs, classify, nextEntry } from './outbox';

/**
 * The outbox, stored in IndexedDB and replayed on reconnect.
 *
 * Shared by the diner and the kitchen because the need is the same on both
 * sides of the pass: a tap that happened must not be lost because the wifi
 * dropped. What differs is only how a request is sent, which the caller
 * supplies — the diner signs with its table token, staff with their session.
 *
 * Entries are replayed oldest-first and the queue stops at the first one that
 * cannot go, so the kitchen never sees a dish finished before it was started.
 */

export type SendFn = (
  entry: OutboxEntry,
) => Promise<{ status: number }>;

export interface OutboxDbOptions {
  /** Database name, one per app so two tabs never share a queue. */
  readonly dbName: string;
  readonly send: SendFn;
  /** Called whenever the queue length changes, for a badge in the UI. */
  readonly onCount?: (pending: number) => void;
  /** Called when connectivity is inferred from a failed send. */
  readonly onOffline?: () => void;
}

const OUTBOX = 'outbox';

/**
 * The slice of IndexedDB this queue uses.
 *
 * Described here rather than pulled from the DOM lib: this package is shared
 * with builds that do not load DOM types, and naming exactly what is touched
 * also documents how little of IndexedDB is involved.
 */
interface Req<T> {
  result: T;
  onsuccess?: (() => void) | null;
  onerror?: (() => void) | null;
  error?: unknown;
}

interface Store {
  put(value: unknown): Req<unknown>;
  delete(key: string): Req<unknown>;
  getAll(): Req<OutboxEntry[]>;
}

interface Db {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options: { keyPath: string }): unknown;
  transaction(name: string, mode: 'readonly' | 'readwrite'): { objectStore(name: string): Store };
}

interface OpenReq extends Req<Db> {
  onupgradeneeded?: (() => void) | null;
}

export class OutboxDb {
  private db: Db | null = null;
  private flushing = false;

  constructor(private readonly options: OutboxDbOptions) {}

  private open(): Promise<Db> {
    if (this.db !== null) return Promise.resolve(this.db);

    return new Promise((resolve, reject) => {
      // Through `unknown`: the real DOM signature is wider than the slice
      // described above, which is the point of describing it.
      const factory = (globalThis as unknown as {
        indexedDB?: { open(name: string, version: number): OpenReq };
      }).indexedDB;
      if (factory === undefined) {
        reject(new Error('indexedDB unavailable'));
        return;
      }

      const request = factory.open(this.options.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OUTBOX)) {
          db.createObjectStore(OUTBOX, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async tx<T>(
    mode: 'readonly' | 'readwrite',
    run: (store: Store) => Req<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = run(db.transaction(OUTBOX, mode).objectStore(OUTBOX));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async all(): Promise<readonly OutboxEntry[]> {
    return this.tx<OutboxEntry[]>('readonly', (store) => store.getAll());
  }

  private async announce(): Promise<void> {
    this.options.onCount?.((await this.all()).length);
  }

  /** Replays what is already queued; call once at startup. */
  async start(): Promise<void> {
    await this.announce();
    await this.flush();
  }

  /**
   * Queues a write for whenever there is signal.
   *
   * `id` doubles as the idempotency key, so a replay the server already saw is
   * a no-op rather than a second ticket.
   */
  async enqueue(
    url: string,
    method: 'POST' | 'PATCH',
    body: unknown,
    id: string = crypto.randomUUID(),
  ): Promise<string> {
    const entry: OutboxEntry = { id, url, method, body, queuedAt: Date.now(), attempts: 0 };
    await this.tx('readwrite', (store) => store.put(entry));
    await this.announce();
    void this.flush();
    return entry.id;
  }

  /** Sends queued writes oldest-first, stopping at the first that cannot go. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;

    try {
      for (;;) {
        const entry = nextEntry(await this.all());
        if (entry === null) break;

        let status: number | null = null;
        try {
          status = (await this.options.send(entry)).status;
        } catch {
          status = null;
        }

        const outcome = classify(entry, status);

        if (outcome.kind === 'sent' || outcome.kind === 'dropped') {
          await this.tx('readwrite', (store) => store.delete(entry.id));
          await this.announce();
          continue;
        }

        // Keep it and stop: order matters, so nothing behind it may jump ahead.
        await this.tx('readwrite', (store) =>
          store.put({ ...entry, attempts: entry.attempts + 1 }),
        );

        if (outcome.reason === 'offline') {
          this.options.onOffline?.();
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
