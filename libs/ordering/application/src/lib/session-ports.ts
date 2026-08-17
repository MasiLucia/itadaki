import { type Cart, type TableSession } from '@itadaki/ordering/domain';
import { type Result } from '@itadaki/shared/domain';
import { type OrderRepositoryError } from './ports';

/** A session and the cart the table is building together. */
export interface SessionState {
  readonly session: TableSession;
  readonly cart: Cart;
}

export interface SessionReader {
  findById(tenantId: string, sessionId: string): Promise<Result<SessionState, OrderRepositoryError>>;
  findOpenForTable(
    tenantId: string,
    tableId: string,
  ): Promise<Result<SessionState | null, OrderRepositoryError>>;

  /**
   * Todas las mesas ocupadas ahora mismo.
   *
   * Lo que el salón necesita para no perder una mesa de vista: el tablero de
   * cocina sólo muestra lo que tiene platos en curso, así que una mesa que ya
   * recibió todo desaparece de la pantalla aunque no haya pagado.
   */
  listOpen(tenantId: string): Promise<Result<readonly SessionState[], OrderRepositoryError>>;
}

export interface SessionWriter {
  save(tenantId: string, state: SessionState): Promise<Result<SessionState, OrderRepositoryError>>;

  /**
   * Reads a session, applies `change`, and writes it back atomically.
   *
   * A shared cart is read-modify-write on one JSON document, so two phones
   * adding a dish at the same moment would each save over the other and one
   * dish would simply vanish. Implementations hold a row lock for the whole
   * callback, which serialises the table's own writes and nothing else.
   */
  mutate(
    tenantId: string,
    sessionId: string,
    change: (state: SessionState) => Result<SessionState, OrderRepositoryError>,
  ): Promise<Result<SessionState, OrderRepositoryError>>;
}

export interface SessionEvent {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly reason: 'joined' | 'left' | 'cart-changed' | 'closed';
}

/** Pushes table changes to every phone in the session. */
export interface SessionEventPublisher {
  sessionChanged(event: SessionEvent): Promise<void>;
}

/**
 * Cierra los llamados que la mesa dejó abiertos.
 *
 * Una mesa que termina no sigue pidiendo nada: sin esto, el timbre quedaba
 * encendido para siempre en los teléfonos de esa mesa y el salón veía el
 * llamado de gente que ya se había ido.
 */
export interface CallCloser {
  closeForSession(tenantId: string, sessionId: string, at: Date): Promise<unknown>;
}
