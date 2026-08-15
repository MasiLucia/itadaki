import { type ItemProgress, orderStatusFrom } from './item-status';
import { type OrderStatus } from './order-status';

/**
 * Lo que la cocina necesita ver de un pedido, sin depender de cómo viaja.
 *
 * Deliberadamente mínimo: el tablero agrupa por mesa, y para eso alcanza con
 * saber de qué mesa es cada comanda, qué platos trae y cuándo entró.
 */
export interface BoardTicket {
  readonly id: string;
  readonly sessionId: string;
  readonly tableId: string | null;
  readonly status: string;
  readonly placedAt: string | null;
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
    readonly name: string;
    readonly quantity: number;
    readonly notes: string;
    readonly station: string;
  }>;
}

/**
 * Todos los platos que una mesa tiene en cocina, vengan del envío que vengan.
 */
export interface TableCard {
  /** La mesa, o la sesión cuando la comanda es anterior al seguimiento por mesa. */
  readonly key: string;
  readonly tableId: string | null;
  /** En qué columna va: la del plato más atrasado. */
  readonly status: OrderStatus;
  /** El envío más viejo sin terminar, que es la espera que le importa al cocinero. */
  readonly placedAt: string | null;
  /** Cuántas veces pidió esta mesa; más de uno significa que agregó después. */
  readonly ticketCount: number;
  readonly items: ReadonlyArray<
    BoardTicket['items'][number] & {
      /** A qué comanda pertenece, que es lo que hay que avanzar. */
      readonly orderId: string;
    }
  >;
}

/**
 * Junta las comandas de una misma mesa en una sola tarjeta.
 *
 * Al cocinero no le importa cuántas veces pidió la mesa 1: le importa qué
 * tiene que sacar para la mesa 1. Con una tarjeta por envío, una mesa que
 * agrega el postre aparecía dos veces en la pantalla, a veces en columnas
 * distintas, y había que reconstruirla a ojo.
 *
 * Los platos se siguen marcando de a uno: la limonada sale en un minuto y el
 * vacío al horno en veinticinco, así que un estado único por mesa dejaría la
 * bebida esperando a la carne.
 */
export function groupByTable(tickets: readonly BoardTicket[]): readonly TableCard[] {
  const cards = new Map<string, TableCard>();

  for (const ticket of tickets) {
    // Sin mesa, cada sesión es su propia tarjeta: mezclarlas sería peor que
    // no agrupar, porque juntaría comandas de gente distinta.
    const key = ticket.tableId ?? `sesion:${ticket.sessionId}`;
    const previo = cards.get(key);

    const items = ticket.items.map((item) => ({ ...item, orderId: ticket.id }));
    const todos = [...(previo?.items ?? []), ...items];

    const progress: ItemProgress[] = todos.map((item) => ({
      itemId: item.id,
      status: item.status as OrderStatus,
    }));

    cards.set(key, {
      key,
      tableId: ticket.tableId,
      status: orderStatusFrom(progress, ticket.status as OrderStatus),
      // El envío más viejo: es hace cuánto que la mesa espera algo.
      placedAt: earliest(previo?.placedAt ?? null, ticket.placedAt),
      ticketCount: (previo?.ticketCount ?? 0) + 1,
      items: todos,
    });
  }

  // Las mesas que esperan hace más tiempo, primero.
  return [...cards.values()].sort((a, b) => (a.placedAt ?? '').localeCompare(b.placedAt ?? ''));
}

function earliest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

/**
 * Cuántas mesas se muestran abiertas antes de plegar el resto.
 *
 * Una cocina trabaja por orden de llegada: el cocinero saca lo más viejo y
 * recién después mira lo que sigue. Con veinte mesas activas, mostrarlas
 * todas desplegadas daba ocho pantallas de scroll y perdía de vista la
 * primera — que es justamente la que hay que sacar.
 *
 * Cinco es lo que entra en una tablet horizontal sin scrollear.
 */
export const OPEN_CARDS = 5;

/**
 * Parte el tablero en lo que se atiende ahora y lo que espera.
 *
 * Lo urgente va abierto, con sus platos y sus botones. El resto queda como
 * una línea por mesa: sigue estando a la vista — el cocinero ve cuántas
 * mesas tiene atrás y hace cuánto esperan — pero sin ocupar la pantalla.
 *
 * Una mesa que pasó el umbral de demora nunca se pliega, aunque haya muchas
 * antes: es la que se está enfriando.
 */
export function splitByUrgency(
  cards: readonly TableCard[],
  minutesWaiting: (card: TableCard) => number,
  lateAfterMinutes: number,
  openCount: number = OPEN_CARDS,
): { readonly open: readonly TableCard[]; readonly folded: readonly TableCard[] } {
  const open: TableCard[] = [];
  const folded: TableCard[] = [];

  for (const [index, card] of cards.entries()) {
    const late = minutesWaiting(card) >= lateAfterMinutes;
    if (index < openCount || late) open.push(card);
    else folded.push(card);
  }

  return { open, folded };
}
