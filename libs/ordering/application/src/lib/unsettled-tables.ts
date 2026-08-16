import { type Order } from '@itadaki/ordering/domain';
import {
  type CurrencyCode,
  Money,
  type MoneyError,
  type Result,
  err,
  ok,
} from '@itadaki/shared/domain';
import { type OrderReader, type OrderRepositoryError } from './ports';
import { type SessionReader } from './session-ports';

/** Una mesa ocupada, con lo que el salón necesita saber de ella. */
export interface OpenTable {
  readonly sessionId: string;
  readonly tableId: string;
  /** Para cantárselo a quien llega tarde y no puede sentarse. */
  readonly joinCode: string | null;
  readonly diners: number;
  readonly openedAt: Date;
}

/**
 * Las mesas ocupadas ahora, con su código.
 *
 * El código sólo lo conoce quien ya está sentado, y eso deja afuera al que
 * llega media hora después: alguien tiene que poder decírselo. Va detrás de un
 * permiso de personal, nunca del token de la mesa — que es justamente lo que
 * el código protege.
 */
export function listOpenTables(deps: { sessions: SessionReader }) {
  return async (tenantId: string): Promise<Result<readonly OpenTable[], OrderRepositoryError>> => {
    const open = await deps.sessions.listOpen(tenantId);
    if (open.isErr()) return err(open.error);

    return ok(
      open.value.map((state) => ({
        sessionId: state.session.id,
        tableId: state.session.tableId,
        joinCode: state.session.joinCode ?? null,
        diners: state.session.diners.length,
        openedAt: state.session.openedAt,
      })),
    );
  };
}

/** Una mesa que ya comió todo y sigue con la cuenta abierta. */
export interface UnsettledTable {
  readonly sessionId: string;
  readonly tableId: string;
  /** Lo consumido, calculado de las comandas y no del carrito. */
  readonly owed: Money;
  /** Cuándo se entregó lo último: hace cuánto que la mesa podría irse. */
  readonly since: Date | null;
  readonly diners: number;
}

/**
 * Las mesas que el salón perdería de vista.
 *
 * El tablero del mozo se arma de lo que está en cocina, así que una mesa a la
 * que ya se le entregó todo desaparece de la pantalla — y con ella el botón de
 * liberar. Comieron, no pagaron, se van, y nadie tuvo delante el aviso de ir a
 * cobrar: la sesión queda abierta en silencio hasta que el barrido la cierra.
 *
 * Una mesa entra en la lista cuando tiene algo consumido y no le queda ningún
 * plato en curso. Mientras espera comida no está: el mozo ya la ve arriba.
 *
 * ponytail: una cuenta saldada cuya sesión no se cerró (el `settle` deja eso
 * registrado como anomalía) aparece acá igual. Es un falso positivo que el
 * mozo resuelve con "Cobrada"; cruzarlo contra el store de facturación cuesta
 * una consulta por mesa y sólo cambia un caso que ya está en el log.
 */
export function listUnsettledTables(deps: {
  sessions: SessionReader;
  orders: OrderReader;
}) {
  return async (
    tenantId: string,
  ): Promise<Result<readonly UnsettledTable[], OrderRepositoryError>> => {
    const open = await deps.sessions.listOpen(tenantId);
    if (open.isErr()) {
      return err(open.error);
    }

    const tables: UnsettledTable[] = [];
    for (const state of open.value) {
      const placed = await deps.orders.listBySession(tenantId, state.session.id);
      if (placed.isErr()) {
        return err(placed.error);
      }

      const served = servedItems(placed.value);
      if (served.length === 0) continue;

      // Algo todavía en cocina o en la barra: la mesa sigue a la vista del
      // mozo por el camino normal, y avisarle acá sería mandarlo a cobrarle a
      // alguien que está esperando el plato principal.
      if (pendingItems(placed.value).length > 0) continue;

      tables.push({
        sessionId: state.session.id,
        tableId: state.session.tableId,
        owed: totalOf(served, state.session.currency),
        since: lastChangeOf(placed.value),
        diners: state.session.diners.length,
      });
    }

    // La que hace más rato que podría levantarse y salir, primero.
    return ok(
      tables.sort((a, b) => (a.since?.getTime() ?? 0) - (b.since?.getTime() ?? 0)),
    );
  };
}

interface ServedItem {
  readonly quantity: number;
  readonly unitTotal: Money;
}

/** Lo entregado y no cancelado: es lo único que la mesa realmente debe. */
function servedItems(orders: readonly Order[]): readonly ServedItem[] {
  return orders
    .filter((order) => order.status !== 'CANCELLED')
    .flatMap((order) =>
      order.items
        .filter((item) => order.statusOf(item.id) === 'DELIVERED')
        .map((item) => ({ quantity: item.quantity, unitTotal: unitWithModifiers(item) })),
    );
}

function pendingItems(orders: readonly Order[]): readonly string[] {
  return orders
    .filter((order) => order.status !== 'CANCELLED')
    .flatMap((order) =>
      order.items
        .filter((item) => {
          const status = order.statusOf(item.id);
          return status !== 'DELIVERED' && status !== 'CANCELLED';
        })
        .map((item) => item.id),
    );
}

/**
 * Precio unitario con sus modificadores, el número congelado al pedir.
 *
 * Nunca un total de línea dividido de vuelta: eso redondea mal y la cuenta
 * termina sin cerrar por unos pesos.
 */
function unitWithModifiers(item: Order['items'][number]): Money {
  const unit = item.modifiers.reduce(
    (acc, modifier) => acc.flatMap((sum) => sum.add(modifier.priceDelta)),
    ok<Money, MoneyError>(item.product.unitPrice),
  );
  return unit.isOk() ? unit.value : item.product.unitPrice;
}

function totalOf(items: readonly ServedItem[], currency: CurrencyCode): Money {
  const total = items.reduce<Result<Money, MoneyError>>(
    (acc, item) =>
      acc.flatMap((sum) => item.unitTotal.multiply(item.quantity).flatMap((line) => sum.add(line))),
    ok(Money.zero(currency)),
  );
  return total.isOk() ? total.value : Money.zero(currency);
}

/** El último movimiento de la mesa, que es cuándo terminó de comer. */
function lastChangeOf(orders: readonly Order[]): Date | null {
  const times = orders.flatMap((order) => order.history.map((change) => change.at.getTime()));
  return times.length === 0 ? null : new Date(Math.max(...times));
}
