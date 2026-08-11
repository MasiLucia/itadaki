import {
  Order,
  OrderItem,
  type ModifierSnapshot,
  type OrderError,
  type OrderItemError,
  type ProductSnapshot,
} from '@itadaki/ordering/domain';
import { type CurrencyCode, type Result, err, ok } from '@itadaki/shared/domain';
import {
  type OrderEventPublisher,
  type OrderReader,
  type OrderRepositoryError,
  type OrderWriter,
} from './ports';

export interface SubmitOrderLine {
  readonly productId: string;
  readonly quantity: number;
  readonly notes: string;
  readonly modifierIds: readonly string[];
}

export interface SubmitOrderCommand {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly dinerId: string;
  readonly clientRequestId: string;
  readonly currency: CurrencyCode;
  readonly lines: readonly SubmitOrderLine[];
}

export type SubmitOrderError =
  | OrderRepositoryError
  | OrderError
  | OrderItemError
  | { readonly kind: 'PRODUCT_UNAVAILABLE'; readonly productId: string }
  | { readonly kind: 'EMPTY_SUBMISSION' };

/** Prices come from the catalog at submit time, never from the client. */
export interface PricedLine {
  readonly product: ProductSnapshot;
  readonly modifiers: readonly ModifierSnapshot[];
}

export interface LinePricer {
  price(
    tenantId: string,
    line: SubmitOrderLine,
  ): Promise<Result<PricedLine, SubmitOrderError>>;
}

/**
 * Turns a diner's cart into a kitchen order.
 *
 * Two properties matter here. First, prices are re-read from the catalog and
 * frozen into the order — a client that posts its own prices cannot move the
 * bill. Second, a repeated clientRequestId returns the original order instead
 * of creating a second one, so the offline queue can retry safely.
 */
export function submitOrder(deps: {
  orders: OrderReader & OrderWriter;
  pricer: LinePricer;
  events: OrderEventPublisher;
  newId: () => string;
  now: () => Date;
}) {
  return async (command: SubmitOrderCommand): Promise<Result<Order, SubmitOrderError>> => {
    if (command.lines.length === 0) {
      return err({ kind: 'EMPTY_SUBMISSION' });
    }

    const existing = await deps.orders.findByClientRequestId(
      command.tenantId,
      command.clientRequestId,
    );
    if (existing.isErr()) {
      return err(existing.error);
    }
    if (existing.value !== null) {
      return ok(existing.value);
    }

    const items: OrderItem[] = [];
    for (const line of command.lines) {
      const priced = await deps.pricer.price(command.tenantId, line);
      if (priced.isErr()) {
        return err(priced.error);
      }

      const item = OrderItem.create({
        id: deps.newId(),
        dinerId: command.dinerId,
        product: priced.value.product,
        modifiers: priced.value.modifiers,
        quantity: line.quantity,
        notes: line.notes,
      });
      if (item.isErr()) {
        return err(item.error);
      }
      items.push(item.value);
    }

    const draft = Order.draft({
      id: deps.newId(),
      clientRequestId: command.clientRequestId,
      sessionId: command.sessionId,
      currency: command.currency,
      items,
    });
    if (draft.isErr()) {
      return err(draft.error);
    }

    const sent = draft.value.transitionTo('SENT', command.dinerId, deps.now());
    if (sent.isErr()) {
      return err(sent.error);
    }

    const saved = await deps.orders.save(command.tenantId, sent.value);
    if (saved.isErr()) {
      return err(saved.error);
    }

    await deps.events.orderChanged({
      tenantId: command.tenantId,
      orderId: saved.value.id,
      sessionId: saved.value.sessionId,
      status: saved.value.status,
    });

    return saved;
  };
}
