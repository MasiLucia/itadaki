import { type Money, type MoneyError, type Result, err, ok } from '@itadaki/shared/domain';

/**
 * Name and price frozen at send time. The catalog may change tonight;
 * last night's bill must not. Every field is readonly by construction.
 */
export interface ProductSnapshot {
  readonly productId: string;
  readonly name: string;
  readonly unitPrice: Money;
  readonly capturedAt: Date;
}

export interface ModifierSnapshot {
  readonly modifierId: string;
  readonly name: string;
  readonly priceDelta: Money;
}

export type OrderItemError =
  | MoneyError
  | { readonly kind: 'INVALID_QUANTITY'; readonly received: number };

export class OrderItem {
  readonly id: string;
  readonly dinerId: string;
  readonly product: ProductSnapshot;
  readonly modifiers: readonly ModifierSnapshot[];
  readonly quantity: number;
  readonly notes: string;

  private constructor(params: {
    id: string;
    dinerId: string;
    product: ProductSnapshot;
    modifiers: readonly ModifierSnapshot[];
    quantity: number;
    notes: string;
  }) {
    this.id = params.id;
    this.dinerId = params.dinerId;
    this.product = Object.freeze(params.product);
    this.modifiers = Object.freeze([...params.modifiers]);
    this.quantity = params.quantity;
    this.notes = params.notes;
    Object.freeze(this);
  }

  static create(params: {
    id: string;
    dinerId: string;
    product: ProductSnapshot;
    modifiers?: readonly ModifierSnapshot[];
    quantity: number;
    notes?: string;
  }): Result<OrderItem, OrderItemError> {
    if (!Number.isInteger(params.quantity) || params.quantity < 1) {
      return err({ kind: 'INVALID_QUANTITY', received: params.quantity });
    }
    return ok(
      new OrderItem({
        id: params.id,
        dinerId: params.dinerId,
        product: params.product,
        modifiers: params.modifiers ?? [],
        quantity: params.quantity,
        notes: params.notes ?? '',
      }),
    );
  }

  /** Unit price plus modifier deltas, before quantity. */
  unitTotal(): Result<Money, MoneyError> {
    return this.modifiers.reduce<Result<Money, MoneyError>>(
      (acc, modifier) => acc.flatMap((total) => total.add(modifier.priceDelta)),
      ok(this.product.unitPrice),
    );
  }

  lineTotal(): Result<Money, MoneyError> {
    return this.unitTotal().flatMap((unit) => unit.multiply(this.quantity));
  }
}
