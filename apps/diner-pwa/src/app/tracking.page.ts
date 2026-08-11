import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TRACKING_STEPS, trackingStepOf, type OrderStatus } from '@itadaki/ordering/domain';
import { SessionStore } from './session.store';
import { TrackingStore, type TrackedOrder } from './tracking.store';

const STEP_LABELS: Record<string, { title: string; hint: string }> = {
  SENT: { title: 'pedido enviado', hint: 'la cocina ya lo recibió' },
  ACCEPTED: { title: 'confirmado', hint: 'lo tienen anotado' },
  IN_PREP: { title: 'en cocina', hint: 'lo están preparando' },
  READY: { title: 'listo', hint: 'sale para tu mesa' },
};

@Component({
  selector: 'itd-tracking',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './tracking.page.css',
  template: `
    <header class="pad">
      <p class="eyebrow">
        mesa 07 · estado
        @if (session.connected()) {
          <span class="live"><span class="live-dot" aria-hidden="true"></span>en vivo</span>
        }
      </p>
      <h1 class="title">itadakimasu!</h1>
    </header>

    @if (store.hasOrders()) {
      <main class="body">
        <!-- One card per dish, not per order. The kitchen finishes dishes at
             different times, and a shared card made a served plate look done
             while another was still cooking. -->
        @for (dish of dishes(); track dish.key) {
          <section class="card">
            <div class="card-head">
              <h2 class="card-title">
                {{ dish.quantity }}× {{ dish.name }}
                @if (dish.placedAt; as time) {
                  <span class="placed">· {{ time }}</span>
                }
              </h2>
            </div>

            <ol class="timeline">
              @for (step of steps; track step; let index = $index) {
                <li
                  class="rung"
                  [class.done]="index < dish.step"
                  [class.active]="index === dish.step"
                  [attr.aria-current]="index === dish.step ? 'step' : null"
                >
                  <span class="dot" aria-hidden="true"></span>
                  <span class="rung-text">
                    <span class="rung-title">{{ label(step).title }}</span>
                    <span class="rung-hint">{{ label(step).hint }}</span>
                  </span>
                </li>
              }
            </ol>

            @if (dish.status === 'DELIVERED') {
              <p class="delivered" role="status">servido · buen provecho</p>
            }
          </section>
        }

        @for (order of store.cancelled(); track order.id) {
          <section class="card cancelled">
            <h2 class="card-title">pedido cancelado</h2>
            <p class="items">{{ itemSummary(order) }}</p>
            <p class="cancel-note">hablá con el mozo si fue un error</p>
          </section>
        }

        @if (!store.allDelivered() && store.minutesRemaining() > 0) {
          <section class="card eta">
            <span class="eta-label">llega en aproximadamente</span>
            <span class="eta-value">{{ store.minutesRemaining() }} min</span>
          </section>
        }
      </main>

      <footer class="foot">
        <a class="cta cta-link" routerLink="/carta">seguir pidiendo</a>
        <a class="link" routerLink="/cuenta">ver la cuenta →</a>
      </footer>
    } @else {
      <main class="body empty">
        @if (store.busy()) {
          <p class="muted">buscando tu pedido…</p>
        } @else {
          <p class="muted">todavía no mandaste ningún pedido.</p>
          <a class="cta cta-link" routerLink="/carta">ver la carta →</a>
        }
      </main>
    }
  `,
})
export class TrackingPage {
  protected readonly store = inject(TrackingStore);
  protected readonly session = inject(SessionStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly steps = TRACKING_STEPS;

  protected readonly sessionId = computed(() => this.session.session()?.id ?? null);

  constructor() {
    const id = this.sessionId();
    if (id !== null) {
      void this.store.load(id);
    }

    // Kitchen advances the ticket; this screen follows the same socket the
    // session already holds open rather than polling.
    const stop = this.session.onOrderChanged(() => {
      const current = this.sessionId();
      if (current !== null) void this.store.load(current);
    });
    this.destroyRef.onDestroy(stop);
  }

  /**
   * Every dish the table is waiting on, each with its own progress.
   *
   * Flattened across orders: a diner thinks in dishes, not in the batches they
   * happened to be sent in.
   */
  protected readonly dishes = computed(() =>
    this.store.active().flatMap((order) =>
      order.items.map((item) => ({
        key: `${order.id}:${item.id}`,
        name: item.name,
        quantity: item.quantity,
        status: item.status,
        step: trackingStepOf(item.status as OrderStatus),
        placedAt: this.placedAt(order),
      })),
    ),
  );

  protected label(step: string): { title: string; hint: string } {
    return STEP_LABELS[step] ?? { title: step, hint: '' };
  }

  protected itemSummary(order: TrackedOrder): string {
    return order.items.map((item) => `${item.quantity}× ${item.name}`).join(' · ');
  }

  protected placedAt(order: TrackedOrder): string | null {
    if (order.placedAt === null) return null;
    return new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(order.placedAt));
  }
}
