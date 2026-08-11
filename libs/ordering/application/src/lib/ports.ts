import { type Order, type OrderStatus } from '@itadaki/ordering/domain';
import { type Result } from '@itadaki/shared/domain';

export type OrderRepositoryError =
  | { readonly kind: 'NOT_FOUND'; readonly id: string }
  | { readonly kind: 'STORAGE_FAILURE'; readonly detail: string };

export interface OrderReader {
  findById(tenantId: string, orderId: string): Promise<Result<Order, OrderRepositoryError>>;
  /** Kitchen board query: everything not yet delivered or cancelled. */
  listActive(tenantId: string): Promise<Result<readonly Order[], OrderRepositoryError>>;
  /**
   * Every order a table has placed, terminal ones included — the diner's
   * tracking screen must keep showing a dish after it is handed over.
   */
  listBySession(
    tenantId: string,
    sessionId: string,
  ): Promise<Result<readonly Order[], OrderRepositoryError>>;

  /**
   * Orders placed in a window, whatever their status.
   *
   * What reporting needs: a delivered order is a sale, and it is exactly what
   * `listActive` filters out — reporting on the active board alone would show
   * a restaurant zero revenue the moment the last plate went out.
   */
  listPlacedBetween(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<Result<readonly Order[], OrderRepositoryError>>;
  findByClientRequestId(
    tenantId: string,
    clientRequestId: string,
  ): Promise<Result<Order | null, OrderRepositoryError>>;
}

export interface OrderWriter {
  save(tenantId: string, order: Order): Promise<Result<Order, OrderRepositoryError>>;
}

export interface OrderEvent {
  readonly tenantId: string;
  readonly orderId: string;
  readonly sessionId: string;
  readonly status: OrderStatus;
}

/** Pushes order changes to kitchen screens and diner devices. */
export interface OrderEventPublisher {
  orderChanged(event: OrderEvent): Promise<void>;
}
