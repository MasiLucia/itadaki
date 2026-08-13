/**
 * A table asking for someone to come over.
 *
 * Deliberately not an order: it has no items, no price and no kitchen state.
 * Modelling it separately keeps the order lifecycle from growing a branch that
 * every screen would have to ignore.
 */

export const CALL_REASONS = ['WAITER', 'BILL', 'QUESTION'] as const;
export type CallReason = (typeof CALL_REASONS)[number];

export type CallStatus = 'PENDING' | 'ACKNOWLEDGED';

/**
 * How the table intends to pay, when they ask for the bill.
 *
 * Its own field rather than a note: the waiter has to know whether to bring
 * the card reader before walking over, and a free-text line is something you
 * read rather than something you see.
 */
export const PAYMENT_METHODS = ['CARD', 'CASH', 'UNDECIDED'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface TableCall {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly tableId: string;
  readonly reason: CallReason;
  readonly status: CallStatus;
  readonly note: string;
  /** Only meaningful on a BILL call; null everywhere else. */
  readonly paymentMethod: PaymentMethod | null;
  readonly raisedAt: Date;
  readonly acknowledgedAt: Date | null;
}

/**
 * How long a call keeps counting as waiting.
 *
 * Past this the staff screen stops nagging: an hour-old call is either handled
 * or forgotten, and either way shouting about it helps nobody.
 */
export const CALL_STALE_MINUTES = 60;

export function isPending(call: TableCall): boolean {
  return call.status === 'PENDING';
}

export function minutesWaiting(call: TableCall, now: Date): number {
  return Math.floor((now.getTime() - call.raisedAt.getTime()) / 60_000);
}

/**
 * Whether a new call should be raised, or the table already has one waiting.
 *
 * Tapping twice is what an impatient table does; a second row for the same
 * reason would just make the staff screen noisier without saying anything new.
 */
export function alreadyWaiting(
  calls: readonly TableCall[],
  sessionId: string,
  reason: CallReason,
): TableCall | null {
  return (
    calls.find(
      (call) => call.sessionId === sessionId && call.reason === reason && isPending(call),
    ) ?? null
  );
}

/** Whether the waiter should take the card reader to the table. */
export function needsCardReader(call: TableCall): boolean {
  return call.reason === 'BILL' && call.paymentMethod === 'CARD';
}

export function acknowledge(call: TableCall, at: Date): TableCall {
  return { ...call, status: 'ACKNOWLEDGED', acknowledgedAt: at };
}
