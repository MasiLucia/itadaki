import { type CurrencyCode, Money, type MoneyError, type Result, err, ok } from '@itadaki/shared/domain';
import { type OrderItem } from './order-item';
import { type ItemProgress, orderStatusFrom } from './item-status';
import { type OrderStatus, canTransition } from './order-status';

export type OrderError =
  | MoneyError
  | { readonly kind: 'ILLEGAL_TRANSITION'; readonly from: OrderStatus; readonly to: OrderStatus }
  | { readonly kind: 'EMPTY_ORDER' }
  | { readonly kind: 'NOT_A_DRAFT'; readonly status: OrderStatus }
  | { readonly kind: 'ITEM_NOT_FOUND'; readonly itemId: string };

export interface StatusChange {
  readonly status: OrderStatus;
  readonly at: Date;
  readonly actor: string;
}

/**
 * A batch of items sent to the kitchen. Transitions return a new Order;
 * instances are never mutated in place.
 */
export class Order {
  readonly id: string;
  readonly clientRequestId: string;
  readonly sessionId: string;
  readonly currency: CurrencyCode;
  readonly items: readonly OrderItem[];
  readonly status: OrderStatus;
  readonly history: readonly StatusChange[];
  /** Where each dish is; the order's own status is read from these. */
  readonly itemProgress: readonly ItemProgress[];

  private constructor(params: {
    id: string;
    clientRequestId: string;
    sessionId: string;
    currency: CurrencyCode;
    items: readonly OrderItem[];
    status: OrderStatus;
    history: readonly StatusChange[];
    itemProgress?: readonly ItemProgress[];
  }) {
    this.id = params.id;
    this.clientRequestId = params.clientRequestId;
    this.sessionId = params.sessionId;
    this.currency = params.currency;
    this.items = Object.freeze([...params.items]);
    // Orders saved before per-dish tracking have none; they read as one block.
    this.itemProgress = Object.freeze([...(params.itemProgress ?? [])]);
    this.status =
      this.itemProgress.length > 0
        ? orderStatusFrom(this.itemProgress, params.status)
        : params.status;
    this.history = Object.freeze([...params.history]);
    Object.freeze(this);
  }

  /** `clientRequestId` is the caller's UUID, used for offline-queue idempotency. */
  static draft(params: {
    id: string;
    clientRequestId: string;
    sessionId: string;
    currency: CurrencyCode;
    items: readonly OrderItem[];
  }): Result<Order, OrderError> {
    return ok(
      new Order({
        ...params,
        status: 'DRAFT',
        history: [],
        itemProgress: params.items.map((item) => ({ itemId: item.id, status: 'DRAFT' })),
      }),
    );
  }

  /** Rehydrates a persisted order without replaying transitions. */
  static restore(params: {
    id: string;
    clientRequestId: string;
    sessionId: string;
    currency: CurrencyCode;
    items: readonly OrderItem[];
    status: OrderStatus;
    history: readonly StatusChange[];
    itemProgress?: readonly ItemProgress[];
  }): Order {
    return new Order(params);
  }

  transitionTo(next: OrderStatus, actor: string, at: Date): Result<Order, OrderError> {
    if (!canTransition(this.status, next)) {
      return err({ kind: 'ILLEGAL_TRANSITION', from: this.status, to: next });
    }
    if (next === 'SENT' && this.items.length === 0) {
      return err({ kind: 'EMPTY_ORDER' });
    }
    return ok(
      new Order({
        id: this.id,
        clientRequestId: this.clientRequestId,
        sessionId: this.sessionId,
        currency: this.currency,
        items: this.items,
        status: next,
        history: [...this.history, { status: next, at, actor }],
        // Advancing the whole ticket moves every dish with it — what the
        // "advance all" button on the board still does.
        itemProgress: this.items.map((item) => ({ itemId: item.id, status: next })),
      }),
    );
  }

  /**
   * Advances one dish, leaving the rest where they are.
   *
   * This is how a kitchen actually works, and the order's own status follows
   * from the result: a ticket is only READY once its slowest dish is.
   */
  transitionItem(
    itemId: string,
    next: OrderStatus,
    actor: string,
    at: Date,
  ): Result<Order, OrderError> {
    const current =
      this.itemProgress.find((entry) => entry.itemId === itemId)?.status ?? this.status;

    if (this.items.every((item) => item.id !== itemId)) {
      return err({ kind: 'ITEM_NOT_FOUND', itemId });
    }
    if (!canTransition(current, next)) {
      return err({ kind: 'ILLEGAL_TRANSITION', from: current, to: next });
    }

    const base =
      this.itemProgress.length > 0
        ? this.itemProgress
        : this.items.map((item) => ({ itemId: item.id, status: this.status }));

    const progress = base.map((entry) =>
      entry.itemId === itemId ? { itemId, status: next } : entry,
    );

    return ok(
      new Order({
        id: this.id,
        clientRequestId: this.clientRequestId,
        sessionId: this.sessionId,
        currency: this.currency,
        items: this.items,
        status: this.status,
        history: [...this.history, { status: next, at, actor }],
        itemProgress: progress,
      }),
    );
  }

  /** Where one dish is, for a screen that renders per dish. */
  statusOf(itemId: string): OrderStatus {
    return this.itemProgress.find((entry) => entry.itemId === itemId)?.status ?? this.status;
  }

  /** Items may only change while the order is still a draft. */
  withItems(items: readonly OrderItem[]): Result<Order, OrderError> {
    if (this.status !== 'DRAFT') {
      return err({ kind: 'NOT_A_DRAFT', status: this.status });
    }
    return ok(
      new Order({
        id: this.id,
        clientRequestId: this.clientRequestId,
        sessionId: this.sessionId,
        currency: this.currency,
        items,
        status: this.status,
        history: this.history,
        itemProgress: items.map((item) => ({ itemId: item.id, status: this.status })),
      }),
    );
  }

  total(): Result<Money, MoneyError> {
    return this.items.reduce<Result<Money, MoneyError>>(
      (acc, item) => acc.flatMap((sum) => item.lineTotal().flatMap((line) => sum.add(line))),
      ok(Money.zero(this.currency)),
    );
  }
}
