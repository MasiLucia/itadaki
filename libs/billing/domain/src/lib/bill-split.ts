import { Money, type MoneyError, type Result, err, ok } from '@itadaki/shared/domain';
import { type Bill, billSubtotal, lineTotal, subtotalFor } from './bill';

export type SplitKind = 'EQUAL' | 'BY_DINER' | 'BY_ITEM' | 'CUSTOM_AMOUNT';

export interface SplitShare {
  readonly payerId: string;
  readonly label: string;
  readonly amount: Money;
}

export type SplitError =
  | MoneyError
  | { readonly kind: 'NO_PAYERS' }
  | { readonly kind: 'UNASSIGNED_LINES'; readonly lineIds: readonly string[] }
  | { readonly kind: 'AMOUNTS_DO_NOT_MATCH'; readonly expected: number; readonly received: number }
  | { readonly kind: 'UNKNOWN_LINE'; readonly lineId: string };

/**
 * A split strategy. Every implementation returns shares that sum to exactly
 * the bill total — that invariant is what makes the strategies swappable
 * without the caller checking which one it got.
 */
export interface SplitStrategy {
  readonly kind: SplitKind;
  split(bill: Bill): Result<readonly SplitShare[], SplitError>;
}

const nameOf = (bill: Bill, dinerId: string): string =>
  bill.participants.find((participant) => participant.id === dinerId)?.nickname ?? 'comensal';

/** Everyone pays the same; leftover cents go to the earliest payers. */
export function equalSplit(parts: number): SplitStrategy {
  return {
    kind: 'EQUAL',
    split(bill) {
      if (parts <= 0) {
        return err({ kind: 'NO_PAYERS' });
      }

      const total = billSubtotal(bill);
      if (total.isErr()) {
        return err(total.error);
      }

      const allocated = total.value.allocateEvenly(parts);
      if (allocated.isErr()) {
        return err(allocated.error);
      }

      return ok(
        allocated.value.map((amount, index) => ({
          payerId: bill.participants[index]?.id ?? `parte-${index + 1}`,
          label: bill.participants[index]?.nickname ?? `parte ${index + 1}`,
          amount,
        })),
      );
    },
  };
}

/** Each diner pays exactly what they ordered. */
export function byDinerSplit(): SplitStrategy {
  return {
    kind: 'BY_DINER',
    split(bill) {
      if (bill.participants.length === 0) {
        return err({ kind: 'NO_PAYERS' });
      }

      const shares: SplitShare[] = [];
      for (const participant of bill.participants) {
        const owed = subtotalFor(bill, participant.id);
        if (owed.isErr()) {
          return err(owed.error);
        }
        shares.push({ payerId: participant.id, label: participant.nickname, amount: owed.value });
      }

      // Lines from someone who left the table belong to nobody; charging
      // silently to the first payer would be a quiet billing error.
      const known = new Set(bill.participants.map((participant) => participant.id));
      const orphans = bill.lines.filter((line) => !known.has(line.dinerId));
      if (orphans.length > 0) {
        return err({ kind: 'UNASSIGNED_LINES', lineIds: orphans.map((line) => line.id) });
      }

      return ok(shares);
    },
  };
}

export interface ItemAssignment {
  readonly lineId: string;
  readonly payerIds: readonly string[];
}

/** Lines are assigned to payers; a shared line splits evenly between them. */
export function byItemSplit(assignments: readonly ItemAssignment[]): SplitStrategy {
  return {
    kind: 'BY_ITEM',
    split(bill) {
      const assignedIds = new Set(assignments.map((assignment) => assignment.lineId));
      const missing = bill.lines.filter((line) => !assignedIds.has(line.id));
      if (missing.length > 0) {
        return err({ kind: 'UNASSIGNED_LINES', lineIds: missing.map((line) => line.id) });
      }

      const totals = new Map<string, Money>();

      for (const assignment of assignments) {
        const line = bill.lines.find((candidate) => candidate.id === assignment.lineId);
        if (line === undefined) {
          return err({ kind: 'UNKNOWN_LINE', lineId: assignment.lineId });
        }
        if (assignment.payerIds.length === 0) {
          return err({ kind: 'UNASSIGNED_LINES', lineIds: [assignment.lineId] });
        }

        const amount = lineTotal(line);
        if (amount.isErr()) {
          return err(amount.error);
        }

        // Splitting each line rather than the total keeps the cent remainder
        // attached to the line that produced it.
        const portions = amount.value.allocateEvenly(assignment.payerIds.length);
        if (portions.isErr()) {
          return err(portions.error);
        }

        assignment.payerIds.forEach((payerId, index) => {
          const portion = portions.value[index];
          if (portion === undefined) return;

          const running = totals.get(payerId) ?? Money.zero(bill.currency);
          const sum = running.add(portion);
          if (sum.isOk()) {
            totals.set(payerId, sum.value);
          }
        });
      }

      if (totals.size === 0) {
        return err({ kind: 'NO_PAYERS' });
      }

      return ok(
        [...totals.entries()].map(([payerId, amount]) => ({
          payerId,
          label: nameOf(bill, payerId),
          amount,
        })),
      );
    },
  };
}

export interface CustomAmount {
  readonly payerId: string;
  readonly amountInMinorUnits: number;
}

/** Free-form amounts; they must add up to the bill exactly. */
export function customSplit(amounts: readonly CustomAmount[]): SplitStrategy {
  return {
    kind: 'CUSTOM_AMOUNT',
    split(bill) {
      if (amounts.length === 0) {
        return err({ kind: 'NO_PAYERS' });
      }

      const total = billSubtotal(bill);
      if (total.isErr()) {
        return err(total.error);
      }

      const declared = amounts.reduce((sum, entry) => sum + entry.amountInMinorUnits, 0);
      if (declared !== total.value.amountInMinorUnits) {
        return err({
          kind: 'AMOUNTS_DO_NOT_MATCH',
          expected: total.value.amountInMinorUnits,
          received: declared,
        });
      }

      const shares: SplitShare[] = [];
      for (const entry of amounts) {
        const amount = Money.of(entry.amountInMinorUnits, bill.currency);
        if (amount.isErr()) {
          return err(amount.error);
        }
        shares.push({
          payerId: entry.payerId,
          label: nameOf(bill, entry.payerId),
          amount: amount.value,
        });
      }
      return ok(shares);
    },
  };
}

/** Sums the shares; used to assert the invariant every strategy promises. */
export function sharesTotal(
  shares: readonly SplitShare[],
  currency: Bill['currency'],
): Result<Money, MoneyError> {
  return shares.reduce<Result<Money, MoneyError>>(
    (acc, share) => acc.flatMap((sum) => sum.add(share.amount)),
    ok(Money.zero(currency)),
  );
}
