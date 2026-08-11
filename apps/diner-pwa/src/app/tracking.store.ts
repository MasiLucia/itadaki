import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClient } from './api-client';

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

@Injectable({ providedIn: 'root' })
export class TrackingStore {
  private readonly api = inject(ApiClient);

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
