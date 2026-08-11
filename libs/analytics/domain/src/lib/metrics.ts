import { Money, type MoneyError, type Result, ok } from '@itadaki/shared/domain';

export interface SoldItem {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly lineTotal: Money;
}

export interface CompletedOrder {
  readonly orderId: string;
  readonly sessionId: string;
  readonly placedAt: Date;
  readonly deliveredAt: Date | null;
  readonly items: readonly SoldItem[];
}

export interface ProductRanking {
  readonly productId: string;
  readonly name: string;
  readonly unitsSold: number;
  readonly revenue: Money;
}

/** Average spend per order — the number an owner checks first. */
export function averageTicket(
  orders: readonly CompletedOrder[],
  currency: Money['currency'],
): Result<Money, MoneyError> {
  if (orders.length === 0) {
    return ok(Money.zero(currency));
  }

  const total = orders.reduce<Result<Money, MoneyError>>(
    (acc, order) =>
      acc.flatMap((sum) =>
        order.items.reduce<Result<Money, MoneyError>>(
          (inner, item) => inner.flatMap((running) => running.add(item.lineTotal)),
          ok(sum),
        ),
      ),
    ok(Money.zero(currency)),
  );

  return total.flatMap((sum) => sum.multiply(1 / orders.length));
}

/** Best and worst sellers, ranked by units moved. */
export function rankProducts(
  orders: readonly CompletedOrder[],
  currency: Money['currency'],
): readonly ProductRanking[] {
  const tally = new Map<string, { name: string; units: number; revenue: Money }>();

  for (const order of orders) {
    for (const item of order.items) {
      const existing = tally.get(item.productId) ?? {
        name: item.name,
        units: 0,
        revenue: Money.zero(currency),
      };
      const revenue = existing.revenue.add(item.lineTotal);

      tally.set(item.productId, {
        name: item.name,
        units: existing.units + item.quantity,
        revenue: revenue.isOk() ? revenue.value : existing.revenue,
      });
    }
  }

  return [...tally.entries()]
    .map(([productId, entry]) => ({
      productId,
      name: entry.name,
      unitsSold: entry.units,
      revenue: entry.revenue,
    }))
    .sort((left, right) => right.unitsSold - left.unitsSold);
}

/**
 * Median rather than mean preparation time: one forgotten ticket would drag
 * an average far enough to make the estimate useless.
 */
export function medianPrepMinutes(orders: readonly CompletedOrder[]): number | null {
  const durations = orders
    .filter((order): order is CompletedOrder & { deliveredAt: Date } => order.deliveredAt !== null)
    .map((order) => (order.deliveredAt.getTime() - order.placedAt.getTime()) / 60_000)
    .filter((minutes) => minutes >= 0)
    .sort((left, right) => left - right);

  if (durations.length === 0) return null;

  const middle = Math.floor(durations.length / 2);
  return durations.length % 2 === 1
    ? (durations[middle] ?? null)
    : ((durations[middle - 1] ?? 0) + (durations[middle] ?? 0)) / 2;
}

/** Orders per hour of the day, for the occupancy heat map. */
export function ordersByHour(orders: readonly CompletedOrder[]): readonly number[] {
  const hours = new Array<number>(24).fill(0);
  for (const order of orders) {
    const hour = order.placedAt.getHours();
    hours[hour] = (hours[hour] ?? 0) + 1;
  }
  return hours;
}

/** Share of sessions that built a cart but never sent it. */
export function abandonmentRate(params: {
  readonly sessionsWithCart: number;
  readonly sessionsThatOrdered: number;
}): number {
  if (params.sessionsWithCart === 0) return 0;
  const abandoned = params.sessionsWithCart - params.sessionsThatOrdered;
  return Math.max(0, Math.min(1, abandoned / params.sessionsWithCart));
}
