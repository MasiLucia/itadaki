import { Injectable, inject, signal } from '@angular/core';
import { type Cart } from '@itadaki/ordering/domain';
import { ApiClient } from './api-client';
import { OfflineStore } from './offline.store';

export type SubmitState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'sent'; readonly orderId: string; readonly status: string }
  /** Accepted but not delivered: it is in the outbox and goes out on reconnect. */
  | { readonly kind: 'queued' }
  | { readonly kind: 'failed'; readonly message: string };

@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly api = inject(ApiClient);
  private readonly offline = inject(OfflineStore);
  private readonly state = signal<SubmitState>({ kind: 'idle' });

  readonly submitState = this.state.asReadonly();

  /**
   * The client request id is generated once per attempt and reused on retry,
   * so a network failure mid-flight can never produce two kitchen tickets.
   */
  async submit(cart: Cart, sessionId: string, dinerId: string): Promise<void> {
    await this.submitLines(
      cart.lines.map((line) => ({
        productId: line.product.productId,
        quantity: line.quantity,
        notes: line.notes,
        modifierIds: line.modifiers.map((modifier) => modifier.modifierId),
      })),
      sessionId,
      dinerId,
    );
  }

  /**
   * Sends already-priced lines, as the shared table cart holds them.
   *
   * The server re-prices from the catalog either way, so what travels here is
   * only what was chosen — never an amount the client made up.
   */
  async submitLines(
    lines: ReadonlyArray<{
      productId: string;
      quantity: number;
      notes: string;
      modifierIds: readonly string[];
    }>,
    sessionId: string,
    dinerId: string,
    lineIds: readonly string[] = [],
  ): Promise<void> {
    if (lines.length === 0) return;

    this.state.set({ kind: 'sending' });
    const clientRequestId = crypto.randomUUID();

    // `lineIds` viaja con el pedido para que el servidor vacíe el carrito
    // compartido en la misma operación: si lo hiciera este teléfono, las
    // líneas de los demás no se irían y la mesa las enviaría de nuevo.
    const payload = { sessionId, dinerId, clientRequestId, lines, lineIds };

    // Already offline: queue without attempting, so the diner is told the
    // truth immediately instead of watching a request time out.
    if (!this.offline.online()) {
      await this.queue(payload, clientRequestId);
      return;
    }

    try {
      const response = await this.api.send('/orders', 'POST', payload, {
        'Idempotency-Key': clientRequestId,
      });

      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { kind?: string } | null;
        this.state.set({
          kind: 'failed',
          message:
            detail?.kind === 'PRODUCT_UNAVAILABLE'
              ? 'uno de los platos se quedó sin stock'
              : 'no pudimos enviar el pedido',
        });
        return;
      }

      const order = (await response.json()) as { id: string; status: string };
      this.state.set({ kind: 'sent', orderId: order.id, status: order.status });
    } catch {
      // The network dropped mid-flight. The request may or may not have
      // reached the kitchen, which is exactly what the idempotency key is
      // for: replaying it is safe and cannot produce a second ticket.
      await this.queue(payload, clientRequestId);
    }
  }

  /**
   * Hands the order to the outbox, which retries on reconnect.
   *
   * Losing a sent order is the worst failure this app has — the table waits
   * for food the kitchen never heard about.
   */
  private async queue(payload: unknown, clientRequestId: string): Promise<void> {
    try {
      await this.offline.enqueue('/orders', 'POST', payload, clientRequestId);
      this.state.set({ kind: 'queued' });
    } catch {
      this.state.set({ kind: 'failed', message: 'no pudimos guardar el pedido' });
    }
  }

  reset(): void {
    this.state.set({ kind: 'idle' });
  }

  /**
   * No hay mesa a la que mandarle el pedido.
   *
   * Pasa con el carrito local de quien miró la carta sin escanear el QR: el
   * pedido está armado pero no pertenece a ninguna sesión, y la cocina no
   * tendría a qué mesa llevarlo.
   */
  needsTable(): void {
    this.state.set({
      kind: 'failed',
      message: 'escaneá el QR de tu mesa para enviar el pedido',
    });
  }
}
