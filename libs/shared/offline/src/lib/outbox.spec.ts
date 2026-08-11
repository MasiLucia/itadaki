import { MAX_ATTEMPTS, backoffMs, classify, nextEntry, type OutboxEntry } from './outbox';

const entry = (overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: 'e1',
  url: '/api/orders',
  method: 'POST',
  body: {},
  queuedAt: 1000,
  attempts: 0,
  ...overrides,
});

describe('outbox classification', () => {
  it('marks a 2xx as sent', () => {
    expect(classify(entry(), 201).kind).toBe('sent');
    expect(classify(entry(), 200).kind).toBe('sent');
  });

  it('keeps an entry when the device is offline', () => {
    const outcome = classify(entry(), null);
    expect(outcome.kind).toBe('kept');
    if (outcome.kind === 'kept') expect(outcome.reason).toBe('offline');
  });

  it('retries a server error', () => {
    expect(classify(entry(), 500).kind).toBe('kept');
    expect(classify(entry(), 503).kind).toBe('kept');
  });

  it('retries a rate limit', () => {
    expect(classify(entry(), 429).kind).toBe('kept');
  });

  it('drops a request the server will never accept', () => {
    // A malformed order stays malformed; retrying blocks everything behind it.
    expect(classify(entry(), 400).kind).toBe('dropped');
    expect(classify(entry(), 403).kind).toBe('dropped');
    expect(classify(entry(), 409).kind).toBe('dropped');
  });

  it('gives up on a server error after the attempt ceiling', () => {
    const exhausted = entry({ attempts: MAX_ATTEMPTS - 1 });
    expect(classify(exhausted, 500).kind).toBe('dropped');
  });

  it('still retries below the ceiling', () => {
    expect(classify(entry({ attempts: MAX_ATTEMPTS - 2 }), 500).kind).toBe('kept');
  });
});

describe('backoff', () => {
  it('grows with each attempt', () => {
    const early = Array.from({ length: 20 }, () => backoffMs(0));
    const later = Array.from({ length: 20 }, () => backoffMs(5));
    const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

    expect(average(later)).toBeGreaterThan(average(early));
  });

  it('never exceeds the ceiling', () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(backoffMs(attempt)).toBeLessThanOrEqual(30_000);
    }
  });

  it('is jittered rather than fixed', () => {
    const samples = new Set(Array.from({ length: 30 }, () => backoffMs(4)));
    expect(samples.size).toBeGreaterThan(1);
  });
});

describe('queue ordering', () => {
  it('returns the oldest entry first', () => {
    const next = nextEntry([
      entry({ id: 'later', queuedAt: 5000 }),
      entry({ id: 'earlier', queuedAt: 1000 }),
    ]);
    expect(next?.id).toBe('earlier');
  });

  it('returns null for an empty queue', () => {
    expect(nextEntry([])).toBeNull();
  });

  it('does not mutate the queue it was given', () => {
    const queue = [entry({ id: 'b', queuedAt: 9 }), entry({ id: 'a', queuedAt: 1 })];
    nextEntry(queue);
    expect(queue[0]?.id).toBe('b');
  });
});

describe('an order queued with no signal', () => {
  const order = (attempts = 0): OutboxEntry => ({
    id: 'client-request-id',
    url: '/orders',
    method: 'POST',
    body: { sessionId: 's1' },
    queuedAt: 0,
    attempts,
  });

  it('is kept when the network is gone', () => {
    // The single worst outcome this app has is a table waiting for food the
    // kitchen never heard about, so an unsent order is never discarded.
    expect(classify(order(), null)).toEqual({
      kind: 'kept',
      id: 'client-request-id',
      reason: 'offline',
    });
  });

  it('is kept while the server is failing', () => {
    expect(classify(order(), 503).kind).toBe('kept');
  });

  it('is kept when the caller is being rate limited', () => {
    expect(classify(order(), 429).kind).toBe('kept');
  });

  it('is cleared once it lands', () => {
    expect(classify(order(), 201).kind).toBe('sent');
  });

  it('is cleared when a replay is answered as already handled', () => {
    // The API returns the existing order for a repeated idempotency key, so a
    // replay of something that already reached the kitchen resolves cleanly.
    expect(classify(order(2), 200).kind).toBe('sent');
  });

  it('is dropped when the kitchen refuses it outright', () => {
    // A sold-out dish will never succeed, however many times it is retried.
    expect(classify(order(), 409).kind).toBe('dropped');
  });

  it('gives up rather than retrying forever', () => {
    expect(classify(order(MAX_ATTEMPTS - 1), 503).kind).toBe('dropped');
  });

  it('keeps trying right up to the last attempt', () => {
    expect(classify(order(MAX_ATTEMPTS - 2), 503).kind).toBe('kept');
  });

  it('reuses the client request id as the idempotency key', () => {
    // What stops one order becoming two tickets when a retry races the
    // original request.
    expect(order().id).toBe('client-request-id');
  });
});
