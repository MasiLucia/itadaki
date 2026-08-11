import {
  type OrderReader,
  type OrderRepositoryError,
  type OrderWriter,
} from '@itadaki/ordering/application';
import { type Order, isTerminal } from '@itadaki/ordering/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';

/** Rows are keyed by tenant so one restaurant never reads another's tickets. */
export class InMemoryOrderStore implements OrderReader, OrderWriter {
  private readonly rows = new Map<string, Map<string, Order>>();

  private tenantRows(tenantId: string): Map<string, Order> {
    const existing = this.rows.get(tenantId);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, Order>();
    this.rows.set(tenantId, created);
    return created;
  }

  async findById(tenantId: string, orderId: string): Promise<Result<Order, OrderRepositoryError>> {
    const found = this.tenantRows(tenantId).get(orderId);
    return found === undefined ? err({ kind: 'NOT_FOUND', id: orderId }) : ok(found);
  }

  async listActive(tenantId: string): Promise<Result<readonly Order[], OrderRepositoryError>> {
    return ok([...this.tenantRows(tenantId).values()].filter((order) => !isTerminal(order.status)));
  }

  async listBySession(
    tenantId: string,
    sessionId: string,
  ): Promise<Result<readonly Order[], OrderRepositoryError>> {
    return ok(
      [...this.tenantRows(tenantId).values()].filter((order) => order.sessionId === sessionId),
    );
  }

  async listPlacedBetween(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<Result<readonly Order[], OrderRepositoryError>> {
    return ok(
      [...this.tenantRows(tenantId).values()].filter((order) => {
        const placed = order.history.find((entry) => entry.status === 'SENT')?.at;
        return placed !== undefined && placed >= from && placed < to;
      }),
    );
  }

  async findByClientRequestId(
    tenantId: string,
    clientRequestId: string,
  ): Promise<Result<Order | null, OrderRepositoryError>> {
    const found = [...this.tenantRows(tenantId).values()].find(
      (order) => order.clientRequestId === clientRequestId,
    );
    return ok(found ?? null);
  }

  async save(tenantId: string, order: Order): Promise<Result<Order, OrderRepositoryError>> {
    this.tenantRows(tenantId).set(order.id, order);
    return ok(order);
  }
}
