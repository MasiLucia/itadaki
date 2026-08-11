import { Money, type MoneyError, type Result, ok } from '@itadaki/shared/domain';
import { type Cart, type CartLine, lineTotal } from './cart';
import { type Diner, type TableSession } from './table-session';

export interface DinerSubtotal {
  readonly diner: Diner;
  readonly lines: readonly CartLine[];
  readonly subtotal: Money;
}

/**
 * Splits the shared cart by who added each line.
 *
 * Everyone at the table reads from one cart, so the view has to answer
 * "who ordered what" without the domain storing a second copy per person.
 */
export function groupByDiner(
  session: TableSession,
  cart: Cart,
): readonly DinerSubtotal[] {
  return session.diners.map((diner) => {
    const lines = cart.lines.filter((line) => line.dinerId === diner.id);
    const subtotal = lines.reduce<Result<Money, MoneyError>>(
      (acc, line) => acc.flatMap((sum) => lineTotal(line).flatMap((amount) => sum.add(amount))),
      ok(Money.zero(cart.currency)),
    );

    return {
      diner,
      lines,
      // A mixed-currency cart cannot occur: every line is added in the
      // session's own currency.
      subtotal: subtotal.isOk() ? subtotal.value : Money.zero(cart.currency),
    };
  });
}

/** Lines added by someone who has since left the table. */
export function orphanedLines(session: TableSession, cart: Cart): readonly CartLine[] {
  const present = new Set(session.diners.map((diner) => diner.id));
  return cart.lines.filter((line) => !present.has(line.dinerId));
}

/** Only the diner who added a line may change or remove it. */
export function canModify(line: CartLine, dinerId: string): boolean {
  return line.dinerId === dinerId;
}
