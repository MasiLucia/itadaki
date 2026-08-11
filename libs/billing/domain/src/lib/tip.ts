import { Money, type MoneyError, type Result, err, ok } from '@itadaki/shared/domain';

export type Tip =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'PERCENTAGE'; readonly percent: number }
  | { readonly kind: 'FIXED'; readonly amount: Money };

export type TipError =
  | MoneyError
  | { readonly kind: 'INVALID_PERCENT'; readonly percent: number };

/**
 * No tip until the diner picks one.
 *
 * Pre-selecting a percentage is the pattern that makes people feel charged
 * for something they did not choose; the product decision is that the
 * default is always zero.
 */
export const NO_TIP: Tip = { kind: 'NONE' };

export const TIP_PRESETS = [0.1, 0.15, 0.2] as const;

export function tipAmount(tip: Tip, base: Money): Result<Money, TipError> {
  switch (tip.kind) {
    case 'NONE':
      return ok(Money.zero(base.currency));

    case 'PERCENTAGE': {
      if (!Number.isFinite(tip.percent) || tip.percent < 0 || tip.percent > 1) {
        return err({ kind: 'INVALID_PERCENT', percent: tip.percent });
      }
      return base.multiply(tip.percent);
    }

    case 'FIXED':
      return tip.amount.isNegative()
        ? err({ kind: 'INVALID_PERCENT', percent: 0 })
        : ok(tip.amount);
  }
}

export function totalWithTip(base: Money, tip: Tip): Result<Money, TipError> {
  return tipAmount(tip, base).flatMap((amount) => base.add(amount));
}
