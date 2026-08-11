import { type CurrencyCode, type ExchangeRate, minorUnitExponent } from './currency';
import { type Result, err, ok } from './result';

export type MoneyError =
  | { readonly kind: 'CURRENCY_MISMATCH'; readonly left: CurrencyCode; readonly right: CurrencyCode }
  | { readonly kind: 'NOT_AN_INTEGER'; readonly received: number }
  | { readonly kind: 'NOT_FINITE'; readonly received: number }
  | { readonly kind: 'NEGATIVE_RESULT'; readonly amountInMinorUnits: number }
  | { readonly kind: 'RATE_DIRECTION_MISMATCH'; readonly expected: CurrencyCode; readonly received: CurrencyCode };

/** Rounds half away from zero, matching how prices are quoted commercially. */
function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * An immutable monetary amount held as an integer count of minor units.
 * Floats never touch a price: 0.1 + 0.2 is exactly why this type exists.
 */
export class Money {
  readonly amountInMinorUnits: number;
  readonly currency: CurrencyCode;

  private constructor(amountInMinorUnits: number, currency: CurrencyCode) {
    this.amountInMinorUnits = amountInMinorUnits;
    this.currency = currency;
    Object.freeze(this);
  }

  static of(amountInMinorUnits: number, currency: CurrencyCode): Result<Money, MoneyError> {
    if (!Number.isFinite(amountInMinorUnits)) {
      return err({ kind: 'NOT_FINITE', received: amountInMinorUnits });
    }
    if (!Number.isInteger(amountInMinorUnits)) {
      return err({ kind: 'NOT_AN_INTEGER', received: amountInMinorUnits });
    }
    return ok(new Money(amountInMinorUnits, currency));
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(0, currency);
  }

  add(other: Money): Result<Money, MoneyError> {
    if (other.currency !== this.currency) {
      return err({ kind: 'CURRENCY_MISMATCH', left: this.currency, right: other.currency });
    }
    return ok(new Money(this.amountInMinorUnits + other.amountInMinorUnits, this.currency));
  }

  subtract(other: Money): Result<Money, MoneyError> {
    if (other.currency !== this.currency) {
      return err({ kind: 'CURRENCY_MISMATCH', left: this.currency, right: other.currency });
    }
    return ok(new Money(this.amountInMinorUnits - other.amountInMinorUnits, this.currency));
  }

  /** Multiplies by a quantity or ratio, rounding to whole minor units. */
  multiply(factor: number): Result<Money, MoneyError> {
    if (!Number.isFinite(factor)) {
      return err({ kind: 'NOT_FINITE', received: factor });
    }
    return ok(new Money(roundHalfUp(this.amountInMinorUnits * factor), this.currency));
  }

  /**
   * Splits into `parts` amounts that sum back to exactly this amount.
   * Remainder minor units go to the earliest parts, so nobody loses a cent.
   */
  allocateEvenly(parts: number): Result<Money[], MoneyError> {
    if (!Number.isInteger(parts) || parts <= 0) {
      return err({ kind: 'NOT_AN_INTEGER', received: parts });
    }
    const base = Math.trunc(this.amountInMinorUnits / parts);
    const remainder = this.amountInMinorUnits - base * parts;
    const sign = remainder < 0 ? -1 : 1;
    let left = Math.abs(remainder);

    return ok(
      Array.from({ length: parts }, () => {
        const extra = left > 0 ? sign : 0;
        if (left > 0) left -= 1;
        return new Money(base + extra, this.currency);
      }),
    );
  }

  /** Converts using a captured rate. The rate's direction must match this currency. */
  convert(rate: ExchangeRate): Result<Money, MoneyError> {
    if (rate.from !== this.currency) {
      return err({ kind: 'RATE_DIRECTION_MISMATCH', expected: this.currency, received: rate.from });
    }
    if (!Number.isFinite(rate.rate)) {
      return err({ kind: 'NOT_FINITE', received: rate.rate });
    }
    return ok(new Money(roundHalfUp(this.amountInMinorUnits * rate.rate), rate.to));
  }

  isZero(): boolean {
    return this.amountInMinorUnits === 0;
  }

  isNegative(): boolean {
    return this.amountInMinorUnits < 0;
  }

  equals(other: Money): boolean {
    return this.amountInMinorUnits === other.amountInMinorUnits && this.currency === other.currency;
  }

  /** Sums same-currency amounts; an empty list needs an explicit currency. */
  static sum(amounts: readonly Money[], currency: CurrencyCode): Result<Money, MoneyError> {
    return amounts.reduce<Result<Money, MoneyError>>(
      (acc, amount) => acc.flatMap((total) => total.add(amount)),
      ok(Money.zero(currency)),
    );
  }

  toString(): string {
    const exponent = minorUnitExponent(this.currency);
    const divisor = 10 ** exponent;
    const major = Math.trunc(Math.abs(this.amountInMinorUnits) / divisor);
    const minor = String(Math.abs(this.amountInMinorUnits) % divisor).padStart(exponent, '0');
    const sign = this.amountInMinorUnits < 0 ? '-' : '';
    return `${sign}${major}.${minor} ${this.currency}`;
  }
}
