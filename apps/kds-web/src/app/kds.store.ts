import { apiUrl, socketUrl } from '@itadaki/shared/domain';
import { Injectable, inject, signal } from '@angular/core';
import { AuthStore } from '@itadaki/shared/ui-auth';
import { OutboxDb } from '@itadaki/shared/offline';
import { io, type Socket } from 'socket.io-client';

export interface CallDto {
  readonly id: string;
  readonly tableId: string;
  readonly reason: 'WAITER' | 'BILL' | 'QUESTION';
  readonly note: string;
  readonly raisedAt: string;
}

export interface TicketDto {
  readonly id: string;
  readonly sessionId: string;
  /** Null when the session predates table tracking; the UI falls back. */
  readonly tableId: string | null;
  readonly status: string;
  readonly total: { readonly amountInMinorUnits: number; readonly currency: string };
  readonly items: ReadonlyArray<{
    readonly id: string;
    /** This dish's own stage, which may differ from the ticket's. */
    readonly status: string;
    readonly name: string;
    readonly quantity: number;
    readonly notes: string;
    readonly station: string;
  }>;
  readonly placedAt: string | null;
}

const API = apiUrl();
const WS = socketUrl();

@Injectable({ providedIn: 'root' })
export class KdsStore {
  private readonly auth = inject(AuthStore);
  private socket: Socket | null = null;

  readonly tickets = signal<readonly TicketDto[]>([]);
  readonly connected = signal(false);

  /** Advances made with no signal, still waiting to reach the API. */
  readonly pending = signal(0);

  /**
   * Kitchen taps survive a dropped connection.
   *
   * A cook marking a dish ready and seeing nothing happen will tap again, or
   * carry the plate out with the board still saying it is cooking. Queueing
   * the write locally and replaying it keeps the board honest: the state
   * machine rejects an advance that arrived late, so a stale replay can never
   * drag a ticket backwards.
   */
  private readonly outbox = new OutboxDb({
    dbName: 'itadaki-kds',
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
   * Live updates come over the socket; the initial list and every reconnect
   * come from a refetch, so a missed event can never leave the board stale.
   */
  connect(): void {
    void this.refresh();
    void this.outbox.start();

    // A tablet that regains wifi without the socket noticing still drains.
    globalThis.addEventListener('online', () => void this.outbox.flush());

    this.socket = io(WS, { transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      this.connected.set(true);
      this.socket?.emit('join', { tenantId: this.auth.profile()?.tenantId ?? '' });
      // Anything tapped during the outage goes out before the board reloads,
      // so the refresh does not paint over it with the server's older view.
      void this.outbox.flush().then(() => {
        void this.refresh();
        void this.refreshCalls();
      });
    });

    this.socket.on('disconnect', () => this.connected.set(false));
    this.socket.on('order.changed', () => {
      if (this.pending() === 0) void this.refresh();
    });
    this.socket.on('call.changed', () => void this.refreshCalls());
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
  }

  readonly calls = signal<readonly CallDto[]>([]);

  /** Tables waiting on a waiter, the bill, or an answer. */
  async refreshCalls(): Promise<void> {
    try {
      const response = await fetch(`${API}/calls`, { headers: this.auth.headers() });
      if (this.auth.expired(response)) return;
      if (response.ok) this.calls.set((await response.json()) as CallDto[]);
    } catch {
      // Leave the last known list; the next event or reconnect retries.
    }
  }

  async acknowledgeCall(callId: string): Promise<void> {
    const response = await fetch(`${API}/calls/${callId}/acknowledge`, {
      method: 'PATCH',
      headers: this.auth.headers(),
    });
    if (this.auth.expired(response)) return;
    if (response.ok) await this.refreshCalls();
  }

  async refresh(): Promise<void> {
    try {
      const response = await fetch(`${API}/orders`, { headers: this.auth.headers() });
      // A night shift outlives the session; the board must say so rather than
      // sit frozen on the last tickets it managed to load.
      if (this.auth.expired(response)) return;
      if (!response.ok) return;
      this.tickets.set((await response.json()) as TicketDto[]);
    } catch {
      // Leave the last known board up; the next event or reconnect retries.
    }
  }

  /** Moves one dish; the ticket follows its slowest. */
  async advanceItem(orderId: string, itemId: string, next: string): Promise<void> {
    // Painted immediately: a cook who taps "Listo" and sees nothing move will
    // tap again, or walk the plate out believing the board is wrong.
    this.paintItem(orderId, itemId, next);

    await this.outbox.enqueue(`${API}/orders/${orderId}/status`, 'PATCH', {
      next,
      itemId,
      actorId: this.auth.profile()?.displayName ?? 'staff',
    });
    // Only once the queue drained: refetching while the move is still pending
    // would paint the server's older view over what the cook just did.
    if (this.pending() === 0) await this.refresh();
  }

  async advance(orderId: string, next: string): Promise<void> {
    this.paintTicket(orderId, next);

    await this.outbox.enqueue(`${API}/orders/${orderId}/status`, 'PATCH', {
      next,
      actorId: 'kds',
    });
    if (this.pending() === 0) await this.refresh();
  }

  /**
   * Shows the move on the board before the server has confirmed it.
   *
   * Overwritten by the next refresh, which is the point: if the API rejected
   * the advance the board goes back to the truth on its own.
   */
  private paintItem(orderId: string, itemId: string, next: string): void {
    this.tickets.update((tickets) =>
      tickets.map((ticket) =>
        ticket.id !== orderId
          ? ticket
          : {
              ...ticket,
              items: ticket.items.map((item) =>
                item.id === itemId ? { ...item, status: next } : item,
              ),
            },
      ),
    );
  }

  private paintTicket(orderId: string, next: string): void {
    this.tickets.update((tickets) =>
      tickets.map((ticket) =>
        ticket.id !== orderId
          ? ticket
          : {
              ...ticket,
              status: next,
              items: ticket.items.map((item) => ({ ...item, status: next })),
            },
      ),
    );
  }
}
