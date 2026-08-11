import { Injectable, inject, signal } from '@angular/core';
import { AuthStore } from '@itadaki/shared/ui-auth';
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

const API = 'http://localhost:3100/api';
const WS = 'http://localhost:3100';

@Injectable({ providedIn: 'root' })
export class KdsStore {
  private readonly auth = inject(AuthStore);
  private socket: Socket | null = null;

  readonly tickets = signal<readonly TicketDto[]>([]);
  readonly connected = signal(false);

  /**
   * Live updates come over the socket; the initial list and every reconnect
   * come from a refetch, so a missed event can never leave the board stale.
   */
  connect(): void {
    void this.refresh();

    this.socket = io(WS, { transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      this.connected.set(true);
      this.socket?.emit('join', { tenantId: this.auth.profile()?.tenantId ?? '' });
      void this.refresh();
      void this.refreshCalls();
    });

    this.socket.on('disconnect', () => this.connected.set(false));
    this.socket.on('order.changed', () => void this.refresh());
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
    if (response.ok) await this.refreshCalls();
  }

  async refresh(): Promise<void> {
    try {
      const response = await fetch(`${API}/orders`, { headers: this.auth.headers() });
      if (!response.ok) return;
      this.tickets.set((await response.json()) as TicketDto[]);
    } catch {
      // Leave the last known board up; the next event or reconnect retries.
    }
  }

  /** Moves one dish; the ticket follows its slowest. */
  async advanceItem(orderId: string, itemId: string, next: string): Promise<void> {
    const response = await fetch(`${API}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { ...this.auth.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ next, itemId, actorId: this.auth.profile()?.displayName ?? 'staff' }),
    });
    if (response.ok) await this.refresh();
  }

  async advance(orderId: string, next: string): Promise<void> {
    await fetch(`${API}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers() },
      body: JSON.stringify({ next, actorId: 'kds' }),
    });
    await this.refresh();
  }
}
