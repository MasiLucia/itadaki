import { Money } from '@itadaki/shared/domain';
import {
  abandonmentRate,
  averageTicket,
  medianPrepMinutes,
  ordersByHour,
  rankProducts,
  type CompletedOrder,
} from './metrics';

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

const order = (overrides: Partial<CompletedOrder> = {}): CompletedOrder => ({
  orderId: 'o1',
  sessionId: 's1',
  placedAt: new Date('2026-01-01T20:00:00'),
  deliveredAt: new Date('2026-01-01T20:15:00'),
  items: [{ productId: 'p1', name: 'ramen', quantity: 1, lineTotal: ars(10_000) }],
  ...overrides,
});

describe('average ticket', () => {
  it('is zero with no orders', () => {
    const result = averageTicket([], 'ARS');
    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.isZero()).toBe(true);
  });

  it('averages across orders', () => {
    const result = averageTicket(
      [
        order({ items: [{ productId: 'p1', name: 'a', quantity: 1, lineTotal: ars(10_000) }] }),
        order({ items: [{ productId: 'p2', name: 'b', quantity: 1, lineTotal: ars(20_000) }] }),
      ],
      'ARS',
    );

    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.amountInMinorUnits).toBe(15_000);
  });

  it('sums every item in an order', () => {
    const result = averageTicket(
      [
        order({
          items: [
            { productId: 'p1', name: 'a', quantity: 1, lineTotal: ars(10_000) },
            { productId: 'p2', name: 'b', quantity: 2, lineTotal: ars(6_000) },
          ],
        }),
      ],
      'ARS',
    );

    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.amountInMinorUnits).toBe(16_000);
  });
});

describe('product ranking', () => {
  it('ranks by units sold', () => {
    const ranked = rankProducts(
      [
        order({ items: [{ productId: 'p1', name: 'ramen', quantity: 1, lineTotal: ars(10_000) }] }),
        order({ items: [{ productId: 'p2', name: 'onigiri', quantity: 5, lineTotal: ars(15_000) }] }),
      ],
      'ARS',
    );

    expect(ranked[0]?.productId).toBe('p2');
    expect(ranked[0]?.unitsSold).toBe(5);
    expect(ranked[1]?.productId).toBe('p1');
  });

  it('accumulates the same product across orders', () => {
    const ranked = rankProducts(
      [
        order({ items: [{ productId: 'p1', name: 'ramen', quantity: 2, lineTotal: ars(20_000) }] }),
        order({ items: [{ productId: 'p1', name: 'ramen', quantity: 3, lineTotal: ars(30_000) }] }),
      ],
      'ARS',
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.unitsSold).toBe(5);
    expect(ranked[0]?.revenue.amountInMinorUnits).toBe(50_000);
  });

  it('returns nothing for no orders', () => {
    expect(rankProducts([], 'ARS')).toHaveLength(0);
  });
});

describe('median prep time', () => {
  it('returns null when nothing was delivered', () => {
    expect(medianPrepMinutes([order({ deliveredAt: null })])).toBeNull();
  });

  it('takes the middle value of an odd count', () => {
    const orders = [5, 10, 60].map((minutes) =>
      order({
        placedAt: new Date('2026-01-01T20:00:00'),
        deliveredAt: new Date(new Date('2026-01-01T20:00:00').getTime() + minutes * 60_000),
      }),
    );
    expect(medianPrepMinutes(orders)).toBe(10);
  });

  it('averages the two middle values of an even count', () => {
    const orders = [10, 20].map((minutes) =>
      order({
        placedAt: new Date('2026-01-01T20:00:00'),
        deliveredAt: new Date(new Date('2026-01-01T20:00:00').getTime() + minutes * 60_000),
      }),
    );
    expect(medianPrepMinutes(orders)).toBe(15);
  });

  it('is not dragged by one forgotten ticket', () => {
    const orders = [10, 11, 12, 13, 600].map((minutes) =>
      order({
        placedAt: new Date('2026-01-01T20:00:00'),
        deliveredAt: new Date(new Date('2026-01-01T20:00:00').getTime() + minutes * 60_000),
      }),
    );
    // The mean would be ~129; the median stays honest.
    expect(medianPrepMinutes(orders)).toBe(12);
  });
});

describe('occupancy by hour', () => {
  it('counts orders into their hour', () => {
    const hours = ordersByHour([
      order({ placedAt: new Date('2026-01-01T20:15:00') }),
      order({ placedAt: new Date('2026-01-01T20:45:00') }),
      order({ placedAt: new Date('2026-01-01T22:05:00') }),
    ]);

    expect(hours[20]).toBe(2);
    expect(hours[22]).toBe(1);
    expect(hours).toHaveLength(24);
  });
});

describe('cart abandonment', () => {
  it('is zero when nobody built a cart', () => {
    expect(abandonmentRate({ sessionsWithCart: 0, sessionsThatOrdered: 0 })).toBe(0);
  });

  it('reports the share that never ordered', () => {
    expect(abandonmentRate({ sessionsWithCart: 10, sessionsThatOrdered: 7 })).toBeCloseTo(0.3);
  });

  it('never goes negative', () => {
    expect(abandonmentRate({ sessionsWithCart: 5, sessionsThatOrdered: 9 })).toBe(0);
  });
});
