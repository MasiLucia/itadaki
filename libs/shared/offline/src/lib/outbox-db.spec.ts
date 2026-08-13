import { type OutboxEntry } from './outbox';
import { OutboxDb } from './outbox-db';

/**
 * A stand-in for IndexedDB.
 *
 * Only what OutboxDb touches: open a database, put, delete and getAll on one
 * object store. Enough to drive the queue's real behaviour without pulling a
 * browser into the test run.
 */
function installFakeIndexedDb(): Map<string, OutboxEntry> {
  const rows = new Map<string, OutboxEntry>();

  // The DOM lib is not loaded in this test environment, so the shape the
  // production code awaits is described locally.
  type FakeRequest<T> = { result: T; onsuccess?: () => void; onerror?: () => void };

  const request = <T>(result: T): FakeRequest<T> => {
    const handle: FakeRequest<T> = { result };
    queueMicrotask(() => handle.onsuccess?.());
    return handle;
  };

  const store = {
    put: (entry: OutboxEntry) => {
      rows.set(entry.id, entry);
      return request(undefined);
    },
    delete: (id: string) => {
      rows.delete(id);
      return request(undefined);
    },
    getAll: () => request([...rows.values()]),
  };

  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => store }),
  };

  (globalThis as Record<string, unknown>)['indexedDB'] = {
    open: () => {
      const handle: Record<string, unknown> = { result: db };
      queueMicrotask(() => (handle['onsuccess'] as (() => void) | undefined)?.());
      return handle;
    },
  };

  return rows;
}

/** Lets the queued microtasks and timers settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the kitchen tapping without signal', () => {
  let rows: Map<string, OutboxEntry>;

  beforeEach(() => {
    rows = installFakeIndexedDb();
  });

  it('keeps the tap when the network is gone', async () => {
    const outbox = new OutboxDb({
      dbName: 'test',
      send: () => Promise.reject(new Error('offline')),
    });

    await outbox.enqueue('/orders/1/status', 'PATCH', { next: 'READY' });
    await settle();

    // The cook's tap is still on the device rather than lost.
    expect(rows.size).toBe(1);
  });

  it('sends it once the connection is back', async () => {
    const sent: string[] = [];
    let online = false;

    const outbox = new OutboxDb({
      dbName: 'test',
      send: (entry) => {
        if (!online) return Promise.reject(new Error('offline'));
        sent.push(entry.url);
        return Promise.resolve({ status: 200 });
      },
    });

    await outbox.enqueue('/orders/1/status', 'PATCH', { next: 'READY' });
    await settle();
    expect(sent).toEqual([]);

    online = true;
    await outbox.flush();
    await settle();

    expect(sent).toEqual(['/orders/1/status']);
    expect(rows.size).toBe(0);
  });

  it('replays taps in the order the cook made them', async () => {
    const sent: unknown[] = [];
    let online = false;

    const outbox = new OutboxDb({
      dbName: 'test',
      send: (entry) => {
        if (!online) return Promise.reject(new Error('offline'));
        sent.push(entry.body);
        return Promise.resolve({ status: 200 });
      },
    });

    // A dish cannot be ready before it started cooking.
    await outbox.enqueue('/orders/1/status', 'PATCH', { next: 'COOKING' });
    await outbox.enqueue('/orders/1/status', 'PATCH', { next: 'READY' });
    await settle();

    online = true;
    await outbox.flush();
    await settle();

    expect(sent).toEqual([{ next: 'COOKING' }, { next: 'READY' }]);
  });

  it('carries an idempotency key so a replay is not a second write', async () => {
    const keys: string[] = [];
    const outbox = new OutboxDb({
      dbName: 'test',
      send: (entry) => {
        keys.push(entry.id);
        return Promise.resolve({ status: 200 });
      },
    });

    const id = await outbox.enqueue('/orders/1/status', 'PATCH', { next: 'READY' });
    await settle();

    expect(keys).toEqual([id]);
  });

  it('drops an advance the server refuses instead of wedging the queue', async () => {
    const sent: unknown[] = [];
    const outbox = new OutboxDb({
      dbName: 'test',
      send: (entry) => {
        sent.push(entry.body);
        // 409: the ticket already moved on, so this advance is stale.
        return Promise.resolve({ status: (entry.body as { next: string }).next === 'COOKING' ? 409 : 200 });
      },
    });

    await outbox.enqueue('/orders/1/status', 'PATCH', { next: 'COOKING' });
    await outbox.enqueue('/orders/1/status', 'PATCH', { next: 'READY' });
    await settle();

    // The rejected one is gone and the next still went through.
    expect(sent).toEqual([{ next: 'COOKING' }, { next: 'READY' }]);
    expect(rows.size).toBe(0);
  });

  it('reports how many taps are still waiting', async () => {
    const counts: number[] = [];
    const outbox = new OutboxDb({
      dbName: 'test',
      send: () => Promise.reject(new Error('offline')),
      onCount: (pending) => counts.push(pending),
    });

    await outbox.enqueue('/orders/1/status', 'PATCH', { next: 'READY' });
    await outbox.enqueue('/orders/2/status', 'PATCH', { next: 'READY' });
    await settle();

    expect(counts.at(-1)).toBe(2);
  });

  it('says it is offline so the screen can show it', async () => {
    let sawOffline = false;
    const outbox = new OutboxDb({
      dbName: 'test',
      send: () => Promise.reject(new Error('offline')),
      onOffline: () => (sawOffline = true),
    });

    await outbox.enqueue('/orders/1/status', 'PATCH', { next: 'READY' });
    await settle();

    expect(sawOffline).toBe(true);
  });
});
