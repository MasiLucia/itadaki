import { type OrderStatus } from './order-status';

/**
 * Where one dish is, independent of the rest of its order.
 *
 * A kitchen does not cook a ticket, it cooks dishes: empanadas come out in six
 * minutes while a slow-roast is still in the oven. Tying every dish to one
 * shared status forced staff to advance them together and showed the diner a
 * plate as served when it had not left the kitchen.
 */
export interface ItemProgress {
  readonly itemId: string;
  readonly status: OrderStatus;
}

/**
 * The order's status, read from its dishes.
 *
 * The slowest dish speaks for the order: a ticket is only READY when every
 * dish is, and the moment one is accepted the order has been accepted.
 * Cancelled dishes are ignored — they are no longer waiting on anyone.
 */
export function orderStatusFrom(
  progress: readonly ItemProgress[],
  fallback: OrderStatus,
): OrderStatus {
  const live = progress.filter((item) => item.status !== 'CANCELLED');
  if (live.length === 0) {
    // Every dish cancelled: so is the order.
    return progress.length > 0 ? 'CANCELLED' : fallback;
  }

  const rank: Record<OrderStatus, number> = {
    DRAFT: 0,
    SENT: 1,
    ACCEPTED: 2,
    IN_PREP: 3,
    READY: 4,
    DELIVERED: 5,
    CANCELLED: 6,
  };

  return live.reduce<OrderStatus>(
    (slowest, item) => (rank[item.status] < rank[slowest] ? item.status : slowest),
    'DELIVERED',
  );
}

/** How many dishes have reached at least `status`, for a progress summary. */
export function countAtLeast(
  progress: readonly ItemProgress[],
  status: OrderStatus,
): number {
  const rank: Record<OrderStatus, number> = {
    DRAFT: 0,
    SENT: 1,
    ACCEPTED: 2,
    IN_PREP: 3,
    READY: 4,
    DELIVERED: 5,
    CANCELLED: 0,
  };

  return progress.filter(
    (item) => item.status !== 'CANCELLED' && rank[item.status] >= rank[status],
  ).length;
}
