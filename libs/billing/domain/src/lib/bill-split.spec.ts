import { Money, type ExchangeRate } from '@itadaki/shared/domain';
import { type Bill, billSubtotal, displayIn, subtotalFor } from './bill';
import {
  byDinerSplit,
  byItemSplit,
  customSplit,
  equalSplit,
  sharesTotal,
  type SplitStrategy,
} from './bill-split';
import { NO_TIP, TIP_PRESETS, tipAmount, totalWithTip } from './tip';

const AT = new Date('2026-01-01T22:00:00Z');

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 'b1',
    sessionId: 's1',
    currency: 'ARS',
    status: 'OPEN',
    participants: [
      { id: 'd1', nickname: 'Ana', colorIndex: 0 },
      { id: 'd2', nickname: 'Beto', colorIndex: 1 },
    ],
    lines: [
      { id: 'l1', dinerId: 'd1', name: 'ramen', quantity: 1, unitTotal: ars(820_000) },
      { id: 'l2', dinerId: 'd2', name: 'onigiri', quantity: 2, unitTotal: ars(340_000) },
    ],
    rates: [],
    closedAt: AT,
    ...overrides,
  };
}

/** Every strategy promises this; the suite checks it for each one. */
function expectSharesSumToBill(strategy: SplitStrategy, bill: Bill): void {
  const shares = strategy.split(bill);
  if (shares.isErr()) throw new Error(`split failed: ${shares.error.kind}`);

  const summed = sharesTotal(shares.value, bill.currency);
  const total = billSubtotal(bill);
  if (summed.isErr() || total.isErr()) throw new Error('expected ok');

  expect(summed.value.amountInMinorUnits).toBe(total.value.amountInMinorUnits);
}

describe('bill totals', () => {
  it('sums every line', () => {
    const total = billSubtotal(makeBill());
    if (total.isErr()) throw new Error('expected ok');
    expect(total.value.amountInMinorUnits).toBe(820_000 + 340_000 * 2);
  });

  it('totals what one diner ordered', () => {
    const owed = subtotalFor(makeBill(), 'd2');
    if (owed.isErr()) throw new Error('expected ok');
    expect(owed.value.amountInMinorUnits).toBe(680_000);
  });

  it('totals an empty bill to zero', () => {
    const total = billSubtotal(makeBill({ lines: [] }));
    if (total.isErr()) throw new Error('expected ok');
    expect(total.value.isZero()).toBe(true);
  });
});

describe('equal split', () => {
  it('divides evenly when it divides cleanly', () => {
    const bill = makeBill({
      lines: [{ id: 'l1', dinerId: 'd1', name: 'x', quantity: 1, unitTotal: ars(900) }],
    });
    const shares = equalSplit(3).split(bill);
    if (shares.isErr()) throw new Error('expected ok');

    expect(shares.value.map((share) => share.amount.amountInMinorUnits)).toEqual([300, 300, 300]);
  });

  it('gives the leftover cents to the earliest payers', () => {
    const bill = makeBill({
      lines: [{ id: 'l1', dinerId: 'd1', name: 'x', quantity: 1, unitTotal: ars(1000) }],
    });
    const shares = equalSplit(3).split(bill);
    if (shares.isErr()) throw new Error('expected ok');

    expect(shares.value.map((share) => share.amount.amountInMinorUnits)).toEqual([334, 333, 333]);
  });

  it('sums to the bill exactly', () => {
    expectSharesSumToBill(equalSplit(3), makeBill());
    expectSharesSumToBill(equalSplit(7), makeBill());
  });

  it('rejects a non-positive number of parts', () => {
    expect(equalSplit(0).split(makeBill()).isErr()).toBe(true);
    expect(equalSplit(-1).split(makeBill()).isErr()).toBe(true);
  });
});

describe('by-diner split', () => {
  it('charges each diner what they ordered', () => {
    const shares = byDinerSplit().split(makeBill());
    if (shares.isErr()) throw new Error('expected ok');

    expect(shares.value.find((share) => share.label === 'Ana')?.amount.amountInMinorUnits).toBe(820_000);
    expect(shares.value.find((share) => share.label === 'Beto')?.amount.amountInMinorUnits).toBe(680_000);
  });

  it('sums to the bill exactly', () => {
    expectSharesSumToBill(byDinerSplit(), makeBill());
  });

  it('refuses to hide a line belonging to someone who left', () => {
    const bill = makeBill({
      lines: [
        { id: 'l1', dinerId: 'd1', name: 'ramen', quantity: 1, unitTotal: ars(820_000) },
        { id: 'l9', dinerId: 'ghost', name: 'cerveza', quantity: 1, unitTotal: ars(200_000) },
      ],
    });
    const result = byDinerSplit().split(bill);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('UNASSIGNED_LINES');
  });

  it('reports a bill with no participants', () => {
    const result = byDinerSplit().split(makeBill({ participants: [] }));
    expect(result.isErr()).toBe(true);
  });
});

describe('by-item split', () => {
  it('assigns each line to its payer', () => {
    const shares = byItemSplit([
      { lineId: 'l1', payerIds: ['d1'] },
      { lineId: 'l2', payerIds: ['d2'] },
    ]).split(makeBill());

    if (shares.isErr()) throw new Error('expected ok');
    expect(shares.value.find((share) => share.payerId === 'd1')?.amount.amountInMinorUnits).toBe(820_000);
  });

  it('splits a shared line between its payers', () => {
    const bill = makeBill({
      lines: [{ id: 'l1', dinerId: 'd1', name: 'picada', quantity: 1, unitTotal: ars(1000) }],
    });
    const shares = byItemSplit([{ lineId: 'l1', payerIds: ['d1', 'd2'] }]).split(bill);

    if (shares.isErr()) throw new Error('expected ok');
    expect(shares.value.map((share) => share.amount.amountInMinorUnits).sort()).toEqual([500, 500]);
  });

  it('keeps the cent remainder on the line that produced it', () => {
    const bill = makeBill({
      lines: [{ id: 'l1', dinerId: 'd1', name: 'picada', quantity: 1, unitTotal: ars(1001) }],
    });
    const shares = byItemSplit([{ lineId: 'l1', payerIds: ['d1', 'd2'] }]).split(bill);

    if (shares.isErr()) throw new Error('expected ok');
    const amounts = shares.value.map((share) => share.amount.amountInMinorUnits).sort((a, b) => a - b);
    expect(amounts).toEqual([500, 501]);
  });

  it('sums to the bill exactly, including shared lines', () => {
    expectSharesSumToBill(
      byItemSplit([
        { lineId: 'l1', payerIds: ['d1', 'd2'] },
        { lineId: 'l2', payerIds: ['d2'] },
      ]),
      makeBill(),
    );
  });

  it('refuses to leave a line unassigned', () => {
    const result = byItemSplit([{ lineId: 'l1', payerIds: ['d1'] }]).split(makeBill());
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('UNASSIGNED_LINES');
  });

  it('rejects an assignment with no payer', () => {
    const result = byItemSplit([
      { lineId: 'l1', payerIds: [] },
      { lineId: 'l2', payerIds: ['d2'] },
    ]).split(makeBill());

    expect(result.isErr()).toBe(true);
  });
});

describe('custom split', () => {
  it('accepts amounts that add up', () => {
    const shares = customSplit([
      { payerId: 'd1', amountInMinorUnits: 1_000_000 },
      { payerId: 'd2', amountInMinorUnits: 500_000 },
    ]).split(makeBill());

    if (shares.isErr()) throw new Error('expected ok');
    expect(shares.value).toHaveLength(2);
  });

  it('sums to the bill exactly', () => {
    expectSharesSumToBill(
      customSplit([
        { payerId: 'd1', amountInMinorUnits: 1_000_000 },
        { payerId: 'd2', amountInMinorUnits: 500_000 },
      ]),
      makeBill(),
    );
  });

  it('rejects amounts that do not add up', () => {
    const result = customSplit([
      { payerId: 'd1', amountInMinorUnits: 1_000_000 },
      { payerId: 'd2', amountInMinorUnits: 100 },
    ]).split(makeBill());

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('AMOUNTS_DO_NOT_MATCH');
  });

  it('rejects an empty list', () => {
    expect(customSplit([]).split(makeBill()).isErr()).toBe(true);
  });
});

describe('every strategy sums to the bill', () => {
  // Awkward totals are where rounding bugs surface.
  const totals = [1, 7, 100, 1001, 99_999, 1_234_567];

  for (const total of totals) {
    it(`holds for a bill of ${total} minor units`, () => {
      const bill = makeBill({
        lines: [{ id: 'l1', dinerId: 'd1', name: 'x', quantity: 1, unitTotal: ars(total) }],
      });

      expectSharesSumToBill(equalSplit(2), bill);
      expectSharesSumToBill(equalSplit(3), bill);
      expectSharesSumToBill(equalSplit(7), bill);
      expectSharesSumToBill(byItemSplit([{ lineId: 'l1', payerIds: ['d1', 'd2', 'd3'] }]), bill);
    });
  }
});

describe('tip', () => {
  it('defaults to nothing', () => {
    const amount = tipAmount(NO_TIP, ars(10_000));
    if (amount.isErr()) throw new Error('expected ok');
    expect(amount.value.isZero()).toBe(true);
  });

  it('computes a percentage', () => {
    const amount = tipAmount({ kind: 'PERCENTAGE', percent: 0.1 }, ars(10_000));
    if (amount.isErr()) throw new Error('expected ok');
    expect(amount.value.amountInMinorUnits).toBe(1_000);
  });

  it('offers presets but selects none', () => {
    expect(TIP_PRESETS).toEqual([0.1, 0.15, 0.2]);
    expect(NO_TIP.kind).toBe('NONE');
  });

  it('accepts a fixed amount', () => {
    const amount = tipAmount({ kind: 'FIXED', amount: ars(50_000) }, ars(10_000));
    if (amount.isErr()) throw new Error('expected ok');
    expect(amount.value.amountInMinorUnits).toBe(50_000);
  });

  it('rejects a percentage above 100', () => {
    expect(tipAmount({ kind: 'PERCENTAGE', percent: 1.5 }, ars(10_000)).isErr()).toBe(true);
  });

  it('rejects a negative percentage', () => {
    expect(tipAmount({ kind: 'PERCENTAGE', percent: -0.1 }, ars(10_000)).isErr()).toBe(true);
  });

  it('adds the tip to the base', () => {
    const total = totalWithTip(ars(10_000), { kind: 'PERCENTAGE', percent: 0.15 });
    if (total.isErr()) throw new Error('expected ok');
    expect(total.value.amountInMinorUnits).toBe(11_500);
  });
});

describe('multi-currency display', () => {
  const rate: ExchangeRate = {
    from: 'ARS',
    to: 'USD',
    rate: 0.001,
    source: 'bcra',
    capturedAt: AT,
  };

  it('returns the amount unchanged in its own currency', () => {
    const shown = displayIn(makeBill(), ars(1_000_000), 'ARS');
    if (shown.isErr()) throw new Error('expected ok');
    expect(shown.value.amountInMinorUnits).toBe(1_000_000);
  });

  it('converts with the rate frozen on the bill', () => {
    const bill = makeBill({ rates: [rate] });
    const shown = displayIn(bill, ars(1_000_000), 'USD');

    if (shown.isErr()) throw new Error('expected ok');
    expect(shown.value.amountInMinorUnits).toBe(1_000);
    expect(shown.value.currency).toBe('USD');
  });

  it('fails rather than guess when no rate was captured', () => {
    const shown = displayIn(makeBill({ rates: [] }), ars(1_000_000), 'USD');
    expect(shown.isErr()).toBe(true);
  });

  it('keeps showing the old rate after the market moves', () => {
    const bill = makeBill({ rates: [rate] });
    const first = displayIn(bill, ars(1_000_000), 'USD');

    // A later, different rate does not belong to this bill.
    const laterBill = makeBill({ rates: [{ ...rate, rate: 0.002 }] });
    const second = displayIn(laterBill, ars(1_000_000), 'USD');

    if (first.isErr() || second.isErr()) throw new Error('expected ok');
    expect(first.value.amountInMinorUnits).toBe(1_000);
    expect(second.value.amountInMinorUnits).toBe(2_000);
  });
});
