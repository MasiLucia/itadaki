import { Money } from '@itadaki/shared/domain';
import { type SplitShare } from './bill-split';
import { distributeTip } from './tip-distribution';

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

const share = (payerId: string, minor: number): SplitShare => ({
  payerId,
  label: payerId,
  amount: ars(minor),
});

const totalOf = (shares: readonly SplitShare[]): number =>
  shares.reduce((sum, entry) => sum + entry.amount.amountInMinorUnits, 0);

describe('distributeTip', () => {
  it('leaves shares untouched when there is no tip', () => {
    const shares = [share('a', 1000), share('b', 2000)];
    const result = distributeTip(shares, ars(0));

    if (result.isErr()) throw new Error('expected ok');
    expect(totalOf(result.value)).toBe(3000);
  });

  it('charges more tip to whoever owes more', () => {
    // 1000 and 3000 owed; a 400 tip should land 100 / 300.
    const result = distributeTip([share('a', 1000), share('b', 3000)], ars(400));

    if (result.isErr()) throw new Error('expected ok');
    expect(result.value[0]?.amount.amountInMinorUnits).toBe(1100);
    expect(result.value[1]?.amount.amountInMinorUnits).toBe(3300);
  });

  it('splits evenly when everyone owes the same', () => {
    const result = distributeTip([share('a', 1000), share('b', 1000)], ars(300));

    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.map((entry) => entry.amount.amountInMinorUnits)).toEqual([1150, 1150]);
  });

  it('distributes the full tip even when it does not divide cleanly', () => {
    const shares = [share('a', 1000), share('b', 2000), share('c', 3000)];
    const result = distributeTip(shares, ars(101));

    if (result.isErr()) throw new Error('expected ok');
    // 6000 owed + 101 tip must equal the new total exactly.
    expect(totalOf(result.value)).toBe(6101);
  });

  it('holds for awkward tips across many payers', () => {
    const shares = [
      share('a', 733),
      share('b', 1291),
      share('c', 4507),
      share('d', 2),
      share('e', 99_999),
    ];
    const base = totalOf(shares);

    for (const tip of [1, 7, 13, 997, 12_345]) {
      const result = distributeTip(shares, ars(tip));
      if (result.isErr()) throw new Error('expected ok');
      expect(totalOf(result.value)).toBe(base + tip);
    }
  });

  it('gives the remainder to the largest fractional parts', () => {
    // Three equal shares and a tip of 100: 33.33 each, one cent left over.
    const result = distributeTip([share('a', 100), share('b', 100), share('c', 100)], ars(100));

    if (result.isErr()) throw new Error('expected ok');
    const added = result.value.map((entry) => entry.amount.amountInMinorUnits - 100).sort();
    expect(added).toEqual([33, 33, 34]);
  });

  it('falls back to an even spread when nobody owes anything', () => {
    const result = distributeTip([share('a', 0), share('b', 0)], ars(101));

    if (result.isErr()) throw new Error('expected ok');
    expect(totalOf(result.value)).toBe(101);
  });

  it('handles a single payer', () => {
    const result = distributeTip([share('a', 5000)], ars(750));

    if (result.isErr()) throw new Error('expected ok');
    expect(result.value[0]?.amount.amountInMinorUnits).toBe(5750);
  });

  it('returns an empty list unchanged', () => {
    const result = distributeTip([], ars(500));
    if (result.isErr()) throw new Error('expected ok');
    expect(result.value).toHaveLength(0);
  });
});
