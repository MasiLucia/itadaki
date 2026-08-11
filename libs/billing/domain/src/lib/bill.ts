import { type CurrencyCode, type ExchangeRate, Money, type MoneyError, type Result, ok } from '@itadaki/shared/domain';

/**
 * A billable line, copied from the order at close time.
 *
 * Prices are already frozen upstream; the bill copies them rather than
 * referencing the catalog, so reprinting an old bill can never re-price it.
 */
export interface BillLine {
  readonly id: string;
  readonly dinerId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitTotal: Money;
}

export interface BillParticipant {
  readonly id: string;
  readonly nickname: string;
  readonly colorIndex: number;
}

/**
 * Whether the bill still tracks the table.
 *
 * A table asks for the bill, looks at it, and then orders coffee — so an open
 * bill has to keep following the shared cart. Settling is what freezes it:
 * after that the document must never change, or a reprint could contradict
 * what was actually paid.
 */
export type BillStatus = 'OPEN' | 'SETTLED';

export interface Bill {
  readonly id: string;
  readonly sessionId: string;
  readonly currency: CurrencyCode;
  readonly status: BillStatus;
  readonly lines: readonly BillLine[];
  readonly participants: readonly BillParticipant[];
  /** Rate captured when the bill was raised, kept for dispute-proof display. */
  readonly rates: readonly ExchangeRate[];
  readonly closedAt: Date;
}

export function isSettled(bill: Bill): boolean {
  return bill.status === 'SETTLED';
}

export function lineTotal(line: BillLine): Result<Money, MoneyError> {
  return line.unitTotal.multiply(line.quantity);
}

export function billSubtotal(bill: Bill): Result<Money, MoneyError> {
  return bill.lines.reduce<Result<Money, MoneyError>>(
    (acc, line) => acc.flatMap((sum) => lineTotal(line).flatMap((amount) => sum.add(amount))),
    ok(Money.zero(bill.currency)),
  );
}

/** What one diner ordered, used by the per-diner split. */
export function subtotalFor(bill: Bill, dinerId: string): Result<Money, MoneyError> {
  return bill.lines
    .filter((line) => line.dinerId === dinerId)
    .reduce<Result<Money, MoneyError>>(
      (acc, line) => acc.flatMap((sum) => lineTotal(line).flatMap((amount) => sum.add(amount))),
      ok(Money.zero(bill.currency)),
    );
}

/**
 * Converts an amount for display only. The rate must have been captured with
 * the bill: looking one up at render time would make the same bill show
 * different numbers on different days.
 */
export function displayIn(
  bill: Bill,
  amount: Money,
  target: CurrencyCode,
): Result<Money, MoneyError> {
  if (target === bill.currency) {
    return ok(amount);
  }

  const rate = bill.rates.find((candidate) => candidate.from === bill.currency && candidate.to === target);
  if (rate === undefined) {
    return amount.convert({
      from: bill.currency,
      to: target,
      rate: Number.NaN,
      source: 'missing',
      capturedAt: bill.closedAt,
    });
  }
  return amount.convert(rate);
}
