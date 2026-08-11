import { Money } from './money';
import { type ExchangeRate } from './currency';

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

describe('Money construction', () => {
  it('rejects non-integer minor units', () => {
    const result = Money.of(10.5, 'ARS');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('NOT_AN_INTEGER');
  });

  it('rejects NaN and Infinity', () => {
    expect(Money.of(Number.NaN, 'ARS').isErr()).toBe(true);
    expect(Money.of(Number.POSITIVE_INFINITY, 'ARS').isErr()).toBe(true);
  });

  it('is frozen after construction', () => {
    const money = ars(1000);
    expect(Object.isFrozen(money)).toBe(true);
  });
});

describe('Money arithmetic', () => {
  it('adds amounts of the same currency', () => {
    const result = ars(1050).add(ars(250));
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.amountInMinorUnits).toBe(1300);
  });

  it('refuses to add across currencies', () => {
    const usd = Money.of(100, 'USD');
    if (usd.isErr()) throw new Error('fixture');
    const result = ars(100).add(usd.value);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('CURRENCY_MISMATCH');
  });

  it('avoids float drift that plain numbers would introduce', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; in minor units it is exact.
    const result = ars(10).add(ars(20));
    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.amountInMinorUnits).toBe(30);
  });

  it('rounds multiplication half away from zero', () => {
    const result = ars(101).multiply(0.5);
    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.amountInMinorUnits).toBe(51);
  });

  it('sums a list into a single amount', () => {
    const result = Money.sum([ars(100), ars(250), ars(33)], 'ARS');
    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.amountInMinorUnits).toBe(383);
  });
});

describe('Money.allocateEvenly', () => {
  it('distributes the remainder so parts sum back exactly', () => {
    const result = ars(1000).allocateEvenly(3);
    if (result.isErr()) throw new Error('expected ok');
    const parts = result.value.map((part) => part.amountInMinorUnits);
    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('splits evenly when it divides cleanly', () => {
    const result = ars(900).allocateEvenly(3);
    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.map((p) => p.amountInMinorUnits)).toEqual([300, 300, 300]);
  });

  it('rejects a non-positive number of parts', () => {
    expect(ars(100).allocateEvenly(0).isErr()).toBe(true);
    expect(ars(100).allocateEvenly(-2).isErr()).toBe(true);
  });
});

describe('Money.convert', () => {
  const rate: ExchangeRate = {
    from: 'ARS',
    to: 'USD',
    rate: 0.001,
    source: 'test',
    capturedAt: new Date('2026-01-01T00:00:00Z'),
  };

  it('converts using the captured rate', () => {
    const result = ars(1_000_000).convert(rate);
    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.amountInMinorUnits).toBe(1000);
    expect(result.value.currency).toBe('USD');
  });

  it('rejects a rate whose direction does not match', () => {
    const usd = Money.of(100, 'USD');
    if (usd.isErr()) throw new Error('fixture');
    const result = usd.value.convert(rate);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('RATE_DIRECTION_MISMATCH');
  });
});

describe('Money.toString', () => {
  it('pads minor units', () => {
    expect(ars(1005).toString()).toBe('10.05 ARS');
    expect(ars(-1005).toString()).toBe('-10.05 ARS');
  });
});
