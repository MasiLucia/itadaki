import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthStore } from '@itadaki/shared/ui-auth';
import { io, type Socket } from 'socket.io-client';

const API = 'http://localhost:3100/api';
const WS = 'http://localhost:3100';

export interface CallDto {
  readonly id: string;
  readonly sessionId: string;
  readonly tableId: string;
  readonly reason: 'WAITER' | 'BILL' | 'QUESTION';
  readonly note: string;
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
  readonly tickets = signal<readonly TicketDto[]>([]);
  readonly connected = signal(false);

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
    this.socket = io(WS, { transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      this.connected.set(true);
      this.socket?.emit('join', { tenantId: this.auth.profile()?.tenantId ?? '' });
      void this.refresh();
    });
    this.socket.on('disconnect', () => this.connected.set(false));
    this.socket.on('order.changed', () => void this.refresh());
    this.socket.on('call.changed', () => void this.refresh());
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
  }

  async refresh(): Promise<void> {
    try {
      const [calls, orders] = await Promise.all([
        fetch(`${API}/calls`, { headers: this.auth.headers() }),
        fetch(`${API}/orders`, { headers: this.auth.headers() }),
      ]);

      if (calls.ok) this.calls.set((await calls.json()) as CallDto[]);
      if (orders.ok) this.tickets.set((await orders.json()) as TicketDto[]);
    } catch {
      // Keep the last known room; the next event or reconnect retries.
    }
  }

  /** Clears a call once the waiter is on their way. */
  async attend(callId: string): Promise<void> {
    const response = await fetch(`${API}/calls/${callId}/acknowledge`, {
      method: 'PATCH',
      headers: this.auth.headers(),
    });
    if (response.ok) await this.refresh();
  }

  /** Marks a dish as carried out to the table. */
  async deliver(orderId: string, itemId: string): Promise<void> {
    const response = await fetch(`${API}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { ...this.auth.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        next: 'DELIVERED',
        itemId,
        actorId: this.auth.profile()?.displayName ?? 'mozo',
      }),
    });
    if (response.ok) await this.refresh();
  }
}
