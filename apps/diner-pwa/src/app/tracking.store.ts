import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { ApiClient } from './api-client';
import { SessionStore } from './session.store';

export interface TrackedItem {
  readonly id: string;
  readonly dinerId: string;
  readonly name: string;
  readonly quantity: number;
  /** This dish's own stage — dishes finish at different times. */
  readonly status: string;
}

export interface TrackedOrder {
  readonly id: string;
  readonly status: string;
  readonly total: { amountInMinorUnits: number; currency: string };
  readonly placedAt: string | null;
  readonly items: readonly TrackedItem[];
}

/** Rough per-status guess; the kitchen does not publish a real ETA yet. */
const MINUTES_REMAINING: Record<string, number> = {
  SENT: 20,
  ACCEPTED: 18,
  IN_PREP: 12,
  READY: 0,
};

/**
 * Lo que la mesa tiene en cocina.
 *
 * Se carga sola en cuanto hay sesión, y no cuando alguien abre la pantalla de
 * estado: antes sólo la conocía quien había tocado "enviar" desde su propio
 * teléfono — el resto de la mesa veía el carrito vaciarse y no tenía por dónde
 * entrar a mirar el pedido. El pedido es de la mesa, no del que lo mandó.
 */
@Injectable({ providedIn: 'root' })
export class TrackingStore {
  private readonly api = inject(ApiClient);
  private readonly session = inject(SessionStore);

  readonly orders = signal<readonly TrackedOrder[]>([]);
  readonly busy = signal(false);
  readonly loaded = signal(false);

  /** Cancelled orders are shown separately, never as an in-flight ticket. */
  readonly active = computed(() =>
    this.orders().filter((order) => order.status !== 'CANCELLED'),
  );

  readonly cancelled = computed(() =>
    this.orders().filter((order) => order.status === 'CANCELLED'),
  );

  readonly hasOrders = computed(() => this.orders().length > 0);

  /** The whole table is done once every order has been handed over. */
  readonly allDelivered = computed(() => {
    const active = this.active();
    return active.length > 0 && active.every((order) => order.status === 'DELIVERED');
  });

  /** The least-advanced order drives the headline ETA. */
  readonly minutesRemaining = computed(() => {
    const pending = this.active().filter((order) => order.status !== 'DELIVERED');
    if (pending.length === 0) return 0;

    return Math.max(...pending.map((order) => MINUTES_REMAINING[order.status] ?? 0));
  });

  /** La sesión de la que son los pedidos que están en memoria. */
  private loadedFor: string | null = null;

  constructor() {
    // La sesión aparece al entrar a la mesa y al recuperarla tras un reload.
    //
    // Lo cargado se tira al cambiar de sesión: este servicio vive mientras la
    // pestaña esté abierta, y sin esto la mesa siguiente empezaba viendo los
    // pedidos de la anterior hasta que llegara la respuesta.
    effect(() => {
      const sessionId = this.session.session()?.id ?? null;
      if (sessionId === this.loadedFor) return;

      this.loadedFor = sessionId;
      this.clear();
      if (sessionId !== null) void this.load(sessionId);
    });

    // La cocina avanza el pedido por el mismo socket que la sesión ya tiene
    // abierto: cada teléfono de la mesa se entera, no sólo el que envió.
    this.session.onOrderChanged(() => {
      const sessionId = this.session.session()?.id;
      if (sessionId !== undefined) void this.load(sessionId);
    });
  }

  async load(sessionId: string): Promise<void> {
    if (this.api.tableToken() === null) return;

    this.busy.set(true);
    try {
      const response = await this.api.fetch(`/sessions/${sessionId}/orders`);
      if (!response.ok) return;
      this.orders.set((await response.json()) as TrackedOrder[]);
      this.loaded.set(true);
    } catch {
      // Keep the last known board; the socket reconnect retries.
    } finally {
      this.busy.set(false);
    }
  }

  clear(): void {
    this.orders.set([]);
    this.loaded.set(false);
  }
}
