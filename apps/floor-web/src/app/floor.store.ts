import { apiUrl, socketUrl } from '@itadaki/shared/domain';
import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthStore } from '@itadaki/shared/ui-auth';
import { OutboxDb } from '@itadaki/shared/offline';
import { io, type Socket } from 'socket.io-client';

const API = apiUrl();
const WS = socketUrl();

export interface CallDto {
  readonly id: string;
  readonly sessionId: string;
  readonly tableId: string;
  readonly reason: 'WAITER' | 'BILL' | 'QUESTION';
  readonly note: string;
  readonly paymentMethod: 'CARD' | 'CASH' | 'UNDECIDED' | null;
  /** The API decides this so every screen says the same thing. */
  readonly needsCardReader: boolean;
  /** Van a pagar en la caja: nadie cobra en la mesa, hay que confirmarlo. */
  readonly paysAtCounter: boolean;
  readonly raisedAt: string;
}

export interface TicketItem {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
  readonly notes: string;
  readonly status: string;
}

export interface TicketDto {
  readonly id: string;
  readonly sessionId: string;
  readonly tableId: string | null;
  readonly status: string;
  readonly items: readonly TicketItem[];
  readonly placedAt: string | null;
}

/**
 * Una mesa que ya comió todo y sigue con la cuenta abierta.
 *
 * No sale del tablero de cocina: justamente son las que ya no tienen nada en
 * cocina, así que hasta ahora desaparecían de la pantalla del mozo.
 */
export interface UnsettledDto {
  readonly sessionId: string;
  readonly tableId: string;
  readonly owed: { readonly amountInMinorUnits: number; readonly currency: string };
  readonly since: string | null;
  readonly diners: number;
}

/**
 * Una mesa y su código, ocupada o no.
 *
 * Todas y no sólo las ocupadas: el mozo lo dice al sentar a la gente, o sea
 * antes de que exista ninguna sesión. Sin esto el primero que llega no puede
 * entrar a ningún lado.
 */
export interface TableCodeDto {
  readonly tableId: string;
  readonly label: string;
  readonly joinCode: string | null;
  readonly diners: number;
}

/** A dish waiting on the pass, flattened out of its ticket. */
export interface Pickup {
  readonly orderId: string;
  readonly itemId: string;
  readonly tableId: string;
  readonly name: string;
  readonly quantity: number;
  readonly notes: string;
}

/**
 * What the floor needs, which is not what the kitchen needs.
 *
 * A waiter walks the room with a phone: they care about who is calling and
 * what is ready to carry out. Cooking stages are the kitchen's business.
 */
@Injectable({ providedIn: 'root' })
export class FloorStore {
  private readonly auth = inject(AuthStore);
  private socket: Socket | null = null;

  readonly calls = signal<readonly CallDto[]>([]);

  /** Taps made with no signal, still waiting to reach the API. */
  readonly pending = signal(0);

  /**
   * The floor loses signal too — a phone walking between the bar and the back
   * tables drops more often than a fixed tablet does. A waiter who marks a
   * plate delivered and sees nothing happen will walk back to check.
   */
  private readonly outbox = new OutboxDb({
    dbName: 'itadaki-floor',
    send: async (entry) => {
      const response = await fetch(entry.url, {
        method: entry.method,
        headers: {
          ...this.auth.headers(),
          'Content-Type': 'application/json',
          'Idempotency-Key': entry.id,
        },
        body: JSON.stringify(entry.body),
      });
      this.auth.expired(response);
      return response;
    },
    onCount: (pending) => this.pending.set(pending),
    onOffline: () => this.connected.set(false),
  });
  /**
   * Lo último que falló, para decirlo en pantalla.
   *
   * Cobrar y liberar se hacían en silencio cuando el servidor rechazaba: el
   * mozo tocaba, no pasaba nada, y no tenía forma de saber si el toque no
   * había entrado o si la mesa seguía ocupada. En un salón lleno eso termina
   * en una mesa que nadie libera.
   */
  readonly actionError = signal<string | null>(null);

  readonly tickets = signal<readonly TicketDto[]>([]);
  readonly unsettled = signal<readonly UnsettledDto[]>([]);
  readonly tableCodes = signal<readonly TableCodeDto[]>([]);
  readonly connected = signal(false);

  /**
   * Lo que está listo, agrupado por mesa: un viaje, una tarjeta.
   *
   * Antes cada plato era su propia fila, así que una mesa con cuatro platos
   * listos aparecía cuatro veces seguidas y el mozo tenía que darse cuenta
   * solo de que era el mismo viaje.
   */
  /**
   * Las mesas que avisaron que pagan en la caja.
   *
   * El aviso llega como un llamado, pero la decisión de liberar se toma en la
   * lista de impagas: sin cruzarlos, el mozo ve "debe $12.400" sin saber que
   * esa mesa ya está pagando en la caja y libera una que sí pagó — o espera
   * un cobro en la mesa que nunca va a llegar.
   */
  readonly payingAtCounter = computed(
    () =>
      new Set(
        this.calls()
          .filter((call) => call.paysAtCounter)
          .map((call) => call.sessionId),
      ),
  );

  readonly pickupsByTable = computed(() => {
    const mesas = new Map<
      string,
      { tableId: string; dishes: Pickup[]; waitingSince: number }
    >();

    for (const pickup of this.pickups()) {
      const actual = mesas.get(pickup.tableId) ?? {
        tableId: pickup.tableId,
        dishes: [],
        waitingSince: Date.now(),
      };
      actual.dishes.push(pickup);
      mesas.set(pickup.tableId, actual);
    }

    // Las mesas con más platos primero: es el viaje que más rinde.
    return [...mesas.values()].sort((a, b) => b.dishes.length - a.dishes.length);
  });

  /**
   * Dishes the kitchen has finished, one row each.
   *
   * READY only: anything earlier is still being cooked, and a delivered dish
   * has already been carried out.
   */
  readonly pickups = computed<readonly Pickup[]>(() =>
    this.tickets().flatMap((ticket) =>
      ticket.items
        .filter((item) => item.status === 'READY')
        .map((item) => ({
          orderId: ticket.id,
          itemId: item.id,
          tableId: ticket.tableId ?? ticket.sessionId.slice(0, 4),
          name: item.name,
          quantity: item.quantity,
          notes: item.notes,
        })),
    ),
  );

  /** Tables with something in the kitchen, so the waiter can answer "ya sale". */
  readonly cooking = computed(() =>
    this.tickets().filter((ticket) =>
      ticket.items.some((item) => item.status !== 'READY' && item.status !== 'DELIVERED'),
    ),
  );

  connect(): void {
    if (this.socket !== null) return;

    void this.refresh();
    void this.outbox.start();

    globalThis.addEventListener('online', () => void this.outbox.flush());

    this.socket = io(WS, { transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      this.connected.set(true);
      // The server reads the restaurant from the token, not from us.
      this.socket?.emit('join', { token: this.auth.token() ?? '' });
      // Queued taps go out before the board reloads, so the refresh cannot
      // paint the server's older view over what the waiter already did.
      void this.outbox.flush().then(() => void this.refresh());
    });
    this.socket.on('disconnect', () => this.connected.set(false));
    this.socket.on('order.changed', () => {
      if (this.pending() === 0) void this.refresh();
    });
    this.socket.on('call.changed', () => {
      if (this.pending() === 0) void this.refresh();
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
  }

  async refresh(): Promise<void> {
    try {
      const [calls, orders, unsettled, codes] = await Promise.all([
        fetch(`${API}/calls`, { headers: this.auth.headers() }),
        fetch(`${API}/orders`, { headers: this.auth.headers() }),
        fetch(`${API}/sessions/unsettled`, { headers: this.auth.headers() }),
        fetch(`${API}/sessions/codes`, { headers: this.auth.headers() }),
      ]);

      // A shift long enough to outlive the session ends here rather than
      // leaving the board frozen on its last good data.
      if (this.auth.expired(calls) || this.auth.expired(orders)) return;

      if (calls.ok) this.calls.set((await calls.json()) as CallDto[]);
      if (orders.ok) this.tickets.set((await orders.json()) as TicketDto[]);
      if (unsettled.ok) this.unsettled.set((await unsettled.json()) as UnsettledDto[]);
      if (codes.ok) this.tableCodes.set((await codes.json()) as TableCodeDto[]);
    } catch {
      // Keep the last known room; the next event or reconnect retries.
    }
  }

  /** Clears a call once the waiter is on their way. */
  async attend(callId: string): Promise<void> {
    // Painted at once: the waiter is already walking to the table.
    this.calls.update((calls) => calls.filter((call) => call.id !== callId));

    await this.outbox.enqueue(`${API}/calls/${callId}/acknowledge`, 'PATCH', {});
    if (this.pending() === 0) await this.refresh();
  }

  /**
   * Le pone un código nuevo a una mesa.
   *
   * Para cuando se filtró: lo escucharon de la mesa de al lado, o quedó
   * anotado en una servilleta que se llevaron. Liberar la mesa ya lo renueva
   * solo, así que esto es para el medio del servicio.
   */
  async rotateCode(tableId: string): Promise<void> {
    const response = await fetch(`${API}/sessions/codes/${tableId}/rotate`, {
      method: 'POST',
      headers: { ...this.auth.headers(), 'Content-Type': 'application/json' },
    });
    if (this.auth.expired(response)) return;
    if (response.ok) await this.refresh();
  }

  /**
   * Marca la cuenta como cobrada y libera la mesa.
   *
   * Cobrar dejó de estar del lado del comensal: cualquiera sentado en la mesa
   * cerraba su propia cuenta sin pagar, y quien le sacara una foto al QR podía
   * hacerlo desde afuera. Ahora el teléfono avisa y esto lo confirma.
   *
   * El `settle` de la API cierra la sesión también, así que no hace falta
   * liberar aparte.
   */
  async chargeTable(sessionId: string): Promise<void> {
    this.actionError.set(null);
    try {
      const response = await fetch(`${API}/bills/${sessionId}/settle`, {
        method: 'POST',
        headers: { ...this.auth.headers(), 'Content-Type': 'application/json' },
      });
      if (this.auth.expired(response)) return;

      // La mesa que nunca pidió la cuenta la arma el servidor al cobrar: antes
      // acá se caía a liberarla, y esa plata se cobraba sin quedar registrada.
      if (response.ok) {
        await this.refresh();
        return;
      }
      this.actionError.set('No se pudo cobrar la mesa. Probá de nuevo.');
    } catch {
      this.actionError.set('Sin conexión — no se pudo cobrar');
    }
  }

  /**
   * Libera una mesa que se fue sin cerrar la cuenta.
   *
   * Mucha gente paga en la caja y se va sin tocar el teléfono. Esa mesa queda
   * ocupada hasta que corre el barrido automático, y mientras tanto el grupo
   * siguiente escanea el QR y cae en el pedido de los anteriores.
   */
  async releaseTable(sessionId: string): Promise<void> {
    this.actionError.set(null);
    try {
      const response = await fetch(`${API}/sessions/${sessionId}/release`, {
        method: 'POST',
        headers: { ...this.auth.headers(), 'Content-Type': 'application/json' },
      });
      if (this.auth.expired(response)) return;

      if (response.ok) {
        await this.refresh();
        return;
      }

      // La mesa que ya se liberó desde otro teléfono no es un error que valga
      // mostrar: el mozo quería que quedara libre y quedó libre.
      if (response.status === 404 || response.status === 409) {
        await this.refresh();
        return;
      }

      this.actionError.set('No se pudo liberar la mesa. Probá de nuevo.');
    } catch {
      this.actionError.set('Sin conexión — no se pudo liberar');
    }
  }

  /** Lleva toda la mesa de una: es un viaje, no cuatro. */
  async deliverTable(dishes: readonly Pickup[]): Promise<void> {
    for (const dish of dishes) {
      await this.deliver(dish.orderId, dish.itemId);
    }
  }

  /** Marks a dish as carried out to the table. */
  async deliver(orderId: string, itemId: string): Promise<void> {
    // Drops off the pickup list immediately; the plate is already on its way.
    this.tickets.update((tickets) =>
      tickets.map((ticket) =>
        ticket.id !== orderId
          ? ticket
          : {
              ...ticket,
              items: ticket.items.map((item) =>
                item.id === itemId ? { ...item, status: 'DELIVERED' } : item,
              ),
            },
      ),
    );

    await this.outbox.enqueue(`${API}/orders/${orderId}/status`, 'PATCH', {
      next: 'DELIVERED',
      itemId,
      actorId: this.auth.profile()?.displayName ?? 'mozo',
    });
    if (this.pending() === 0) await this.refresh();
  }
}
