import { type Bill, type BillLine, type BillParticipant, isSettled } from '@itadaki/billing/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';
import {
  type BillReader,
  type BillRepositoryError,
  type BillWriter,
  type ExchangeRateProvider,
} from './ports';

export interface CloseBillCommand {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly currency: Bill['currency'];
  readonly participants: readonly BillParticipant[];
  readonly lines: readonly BillLine[];
}

export type CloseBillError =
  | BillRepositoryError
  | { readonly kind: 'NOTHING_TO_BILL'; readonly sessionId: string };

/**
 * Raises the bill for a table.
 *
 * The exchange rates are captured here, once, and stored with the bill. A
 * later lookup would make the same bill show different numbers tomorrow —
 * exactly the dispute this is meant to prevent.
 */
export function closeBill(deps: {
  bills: BillReader & BillWriter;
  rates: ExchangeRateProvider;
  newId: () => string;
  now: () => Date;
}) {
  return async (command: CloseBillCommand): Promise<Result<Bill, CloseBillError>> => {
    if (command.lines.length === 0) {
      return err({ kind: 'NOTHING_TO_BILL', sessionId: command.sessionId });
    }

    const existing = await deps.bills.findBySession(command.tenantId, command.sessionId);

    // Settled is final: reprinting a paid bill must show what was paid.
    if (existing.isOk() && isSettled(existing.value)) {
      return ok(existing.value);
    }

    // Still open, so it re-reads the table. Returning the stored copy here is
    // what used to drop anything ordered after the bill was first asked for —
    // the dessert never made it onto the total.
    const captured = existing.isOk()
      ? existing.value.rates
      : await deps.rates.ratesFor(command.currency);

    const bill: Bill = {
      id: existing.isOk() ? existing.value.id : deps.newId(),
      sessionId: command.sessionId,
      currency: command.currency,
      status: 'OPEN',
      lines: command.lines,
      participants: command.participants,
      // Rates stay as first captured: a bill that reprices itself between
      // asking and paying is the dispute this is meant to prevent.
      rates: captured,
      closedAt: existing.isOk() ? existing.value.closedAt : deps.now(),
    };

    const saved = await deps.bills.save(command.tenantId, bill);
    return saved.isErr() ? err(saved.error) : ok(saved.value);
  };
}
