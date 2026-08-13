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
      const [calls, orders] = await Promise.all([
        fetch(`${API}/calls`, { headers: this.auth.headers() }),
        fetch(`${API}/orders`, { headers: this.auth.headers() }),
      ]);

      // A shift long enough to outlive the session ends here rather than
      // leaving the board frozen on its last good data.
      if (this.auth.expired(calls) || this.auth.expired(orders)) return;

      if (calls.ok) this.calls.set((await calls.json()) as CallDto[]);
      if (orders.ok) this.tickets.set((await orders.json()) as TicketDto[]);
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
