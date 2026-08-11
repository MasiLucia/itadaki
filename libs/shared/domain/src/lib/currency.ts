export const CURRENCY_CODES = ['ARS', 'USD', 'EUR', 'BRL'] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** Minor-unit exponent per currency. All four supported currencies use 2. */
const MINOR_UNIT_EXPONENT: Record<CurrencyCode, number> = {
  ARS: 2,
  USD: 2,
  EUR: 2,
  BRL: 2,
};

export function minorUnitExponent(currency: CurrencyCode): number {
  return MINOR_UNIT_EXPONENT[currency];
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (CURRENCY_CODES as readonly string[]).includes(value);
}

/**
 * A rate captured at a point in time. Orders store the rate used so the bill
 * never moves when the market does.
 */
export interface ExchangeRate {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  readonly rate: number;
  readonly source: string;
  readonly capturedAt: Date;
}
