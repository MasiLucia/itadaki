import { type Order, type OrderError, type OrderStatus } from '@itadaki/ordering/domain';
import { type Result, err } from '@itadaki/shared/domain';
import {
  type OrderEventPublisher,
  type OrderReader,
  type OrderRepositoryError,
  type OrderWriter,
} from './ports';

export interface AdvanceOrderCommand {
  /** Set to advance a single dish; omitted moves the whole ticket. */
  readonly itemId?: string | undefined;
  readonly tenantId: string;
  readonly orderId: string;
  readonly next: OrderStatus;
  readonly actorId: string;
}

export type AdvanceOrderError = OrderRepositoryError | OrderError;

/**
 * Moves a ticket across the kitchen board. The state machine in the domain
 * rejects illegal moves, so an out-of-order tap on a busy screen fails loudly
 * instead of corrupting the ticket.
 */
export function advanceOrder(deps: {
  orders: OrderReader & OrderWriter;
  events: OrderEventPublisher;
  now: () => Date;
}) {
  return async (command: AdvanceOrderCommand): Promise<Result<Order, AdvanceOrderError>> => {
    const found = await deps.orders.findById(command.tenantId, command.orderId);
    if (found.isErr()) {
      return err(found.error);
    }

    // With an item id the kitchen is moving one dish; without it, the whole
    // ticket. A cook marking empanadas ready must not claim the roast is too.
    const moved =
      command.itemId === undefined
        ? found.value.transitionTo(command.next, command.actorId, deps.now())
        : found.value.transitionItem(
            command.itemId,
            command.next,
            command.actorId,
            deps.now(),
          );
    if (moved.isErr()) {
      return err(moved.error);
    }

    const saved = await deps.orders.save(command.tenantId, moved.value);
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
