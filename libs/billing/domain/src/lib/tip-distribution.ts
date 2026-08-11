import { Money, type MoneyError, type Result, err, ok } from '@itadaki/shared/domain';
import { type SplitShare } from './bill-split';

/**
 * Spreads a tip across shares in proportion to what each payer owes.
 *
 * Splitting the tip evenly would overcharge whoever ordered least — the
 * problem is most visible in a by-item split where one person had a coffee
 * and another had dinner. Remainder cents go to the largest shares, so the
 * distributed tip always sums to exactly the tip charged.
 */
export function distributeTip(
  shares: readonly SplitShare[],
  tip: Money,
): Result<readonly SplitShare[], MoneyError> {
  if (shares.length === 0) {
    return ok([]);
  }
  if (tip.isZero()) {
    return ok(shares);
  }

  const base = shares.reduce((sum, share) => sum + share.amount.amountInMinorUnits, 0);

  // Nobody owes anything: fall back to an even spread rather than divide by zero.
  if (base === 0) {
    const even = tip.allocateEvenly(shares.length);
    if (even.isErr()) {
      return err(even.error);
    }
    return combine(shares, even.value);
  }

  const exact = shares.map((share) => (share.amount.amountInMinorUnits * tip.amountInMinorUnits) / base);
  const floored = exact.map((value) => Math.floor(value));
  let remainder = tip.amountInMinorUnits - floored.reduce((sum, value) => sum + value, 0);

  // Largest fractional part first: the standard way to keep the rounding fair.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);

  for (const entry of order) {
    if (remainder <= 0) break;
    floored[entry.index] = (floored[entry.index] ?? 0) + 1;
    remainder -= 1;
  }

  const portions: Money[] = [];
  for (const amount of floored) {
    const built = Money.of(amount, tip.currency);
    if (built.isErr()) {
      return err(built.error);
    }
    portions.push(built.value);
  }

  return combine(shares, portions);
}

function combine(
  shares: readonly SplitShare[],
  portions: readonly Money[],
): Result<readonly SplitShare[], MoneyError> {
  const combined: SplitShare[] = [];

  for (const [index, share] of shares.entries()) {
    const portion = portions[index];
    if (portion === undefined) {
      combined.push(share);
      continue;
    }

    const total = share.amount.add(portion);
    if (total.isErr()) {
      return err(total.error);
    }
    combined.push({ ...share, amount: total.value });
  }

  return ok(combined);
}
