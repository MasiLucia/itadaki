/**
 * A write the diner made that has not reached the server yet.
 *
 * Every entry carries a client-generated id that becomes the request's
 * Idempotency-Key. Replaying the queue after a reconnect is therefore safe:
 * the server returns the original result instead of creating a duplicate.
 */
export interface OutboxEntry {
  readonly id: string;
  readonly url: string;
  readonly method: 'POST' | 'PATCH';
  readonly body: unknown;
  readonly queuedAt: number;
  readonly attempts: number;
}

export type FlushOutcome =
  | { readonly kind: 'sent'; readonly id: string }
  | { readonly kind: 'kept'; readonly id: string; readonly reason: 'offline' | 'server-error' }
  | { readonly kind: 'dropped'; readonly id: string; readonly status: number };

/** Give up after this many tries so a poisoned entry cannot block the queue. */
export const MAX_ATTEMPTS = 6;

/**
 * Decides what happens to an entry after one send attempt.
 *
 * A 4xx (other than 429) means the request will never succeed — retrying it
 * forever would wedge the queue behind a request the server rejects. A 5xx or
 * a network failure is worth another try.
 */
export function classify(entry: OutboxEntry, status: number | null): FlushOutcome {
  if (status === null) {
    return { kind: 'kept', id: entry.id, reason: 'offline' };
  }
  if (status >= 200 && status < 300) {
    return { kind: 'sent', id: entry.id };
  }
  if (status === 429 || status >= 500) {
    return entry.attempts + 1 >= MAX_ATTEMPTS
      ? { kind: 'dropped', id: entry.id, status }
      : { kind: 'kept', id: entry.id, reason: 'server-error' };
  }
  return { kind: 'dropped', id: entry.id, status };
}

/** Exponential backoff with a ceiling, so a long outage does not hammer the API. */
export function backoffMs(attempts: number): number {
  const base = Math.min(30_000, 1_000 * 2 ** attempts);
  // Jitter keeps a roomful of phones from retrying in lockstep.
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

/** Oldest first: the kitchen must receive orders in the sequence they were made. */
export function nextEntry(entries: readonly OutboxEntry[]): OutboxEntry | null {
  if (entries.length === 0) return null;
  return [...entries].sort((left, right) => left.queuedAt - right.queuedAt)[0] ?? null;
}
