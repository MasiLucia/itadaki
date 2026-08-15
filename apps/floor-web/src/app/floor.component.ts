import { apiUrl } from '@itadaki/shared/domain';
import {
  ChangeDetectionStrategy,
  Component,
  type OnDestroy,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AuthStore, LoginComponent } from '@itadaki/shared/ui-auth';
import { FloorStore, type CallDto, type Pickup } from './floor.store';

const API_URL = apiUrl();

/** What the table asked for, in the words a waiter would use. */
const CALL_LABELS: Record<string, string> = {
  WAITER: 'Necesita al mozo',
  BILL: 'Pide la cuenta',
  QUESTION: 'Tiene una duda',
};

/**
 * The waiter's screen.
 *
 * Separate from the kitchen display because the jobs are different: a cook
 * stands at a station watching tickets, a waiter walks the room with a phone
 * answering people. Calls used to land on the kitchen board, where nobody was
 * going to walk over to the table.
 */
@Component({
  selector: 'itd-floor',
  standalone: true,
  imports: [LoginComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './floor.component.css',
  template: `
    @if (!auth.ready()) {
      <p class="booting">Cargando…</p>
    } @else if (!auth.signedIn()) {
      <itd-login context="Salón" [allowSignUp]="false" />
    } @else {
      <header class="head">
        <div>
          <p class="eyebrow">Salón · en vivo</p>
          <h1 class="title">Tu turno en el salón</h1>
        </div>
        <div class="head-right">
          <p class="live" [class.off]="!store.connected()">
            <span class="dot" aria-hidden="true"></span>
            {{ store.connected() ? 'En vivo' : 'Reconectando…' }}
          </p>
          @if (store.pending(); as pending) {
            <!-- The taps are saved; they leave on their own with signal. -->
            <p class="queued" role="status">{{ pending }} sin enviar</p>
          }
          <button type="button" class="signout" (click)="auth.signOut()">Salir</button>
        </div>
      </header>

      <!-- Calls first: a person is waiting, which outranks a plate on the pass. -->
      <section class="block" aria-labelledby="calls-title">
        <h2 class="block-title" id="calls-title">
          Te están llamando
          @if (store.calls().length > 0) {
            <span class="count">{{ store.calls().length }}</span>
          }
        </h2>

        @for (call of store.calls(); track call.id) {
          <article class="card call">
            <div class="card-main">
              <span class="table">Mesa {{ tableNumber(call.tableId) }}</span>
              <span class="reason">{{ label(call.reason) }}</span>
              @if (call.needsCardReader) {
                <span class="posnet">Llevá el posnet</span>
              } @else if (call.paymentMethod === 'CASH') {
                <span class="paying">Pagan en efectivo</span>
              }
              @if (call.note !== '') {
                <span class="note">"{{ call.note }}"</span>
              }
            </div>
            <div class="card-side">
              <span class="waited">{{ waitedSince(call.raisedAt) }}</span>
              <button type="button" class="action" (click)="attend(call)">Voy</button>
            </div>
          </article>
        } @empty {
          <p class="quiet">Nadie está llamando ahora.</p>
        }
      </section>

      <!-- Then the pass: dishes the kitchen has finished and nobody has carried. -->
      <section class="block" aria-labelledby="pickup-title">
        <h2 class="block-title" id="pickup-title">
          Listo para llevar
          @if (store.pickups().length > 0) {
            <span class="count ready">{{ store.pickups().length }}</span>
          }
        </h2>

        <!-- Una tarjeta por mesa, no por plato: es un viaje. Antes una mesa
             con cuatro platos listos ocupaba cuatro filas seguidas y el mozo
             tenía que darse cuenta solo de que era el mismo viaje. -->
        @for (mesa of store.pickupsByTable(); track mesa.tableId) {
          <article class="trip">
            <header class="trip-head">
              <span class="trip-table">Mesa {{ tableNumber(mesa.tableId) }}</span>
              <span class="trip-count">
                {{ mesa.dishes.length }} {{ mesa.dishes.length === 1 ? 'plato' : 'platos' }}
              </span>
            </header>

            <ul class="trip-dishes">
              @for (dish of mesa.dishes; track dish.itemId) {
                <li class="trip-dish">
                  <span class="trip-qty">{{ dish.quantity }}</span>
                  <span class="trip-name">{{ dish.name }}</span>
                  @if (dish.notes !== '') {
                    <span class="note">"{{ dish.notes }}"</span>
                  }
                </li>
              }
            </ul>

            <button type="button" class="trip-action" (click)="deliverTable(mesa.dishes)">
              Llevé la mesa {{ tableNumber(mesa.tableId) }} →
            </button>
          </article>
        } @empty {
          <p class="quiet">Nada esperando en la barra.</p>
        }
      </section>

      <!-- Contexto, no una tarea: sirve para contestar "¿falta mucho?".
           Plegado por defecto porque con trece mesas activas ocupaba media
           pantalla compitiendo con lo que sí hay que hacer. -->
      @if (store.cooking().length > 0) {
        <section class="block" aria-labelledby="cooking-title">
          <button
            type="button"
            class="cooking-toggle"
            id="cooking-title"
            [attr.aria-expanded]="showCooking()"
            (click)="showCooking.set(!showCooking())"
          >
            <span class="quiet-title">En cocina</span>
            <span class="cooking-count">{{ store.cooking().length }} mesas</span>
            <span class="cooking-chevron">{{ showCooking() ? '−' : '+' }}</span>
          </button>

          @if (showCooking()) {
            @for (ticket of store.cooking(); track ticket.id) {
              <p class="cooking-row">
                <span class="table small">Mesa {{ tableNumber(ticket.tableId ?? '') }}</span>
                <span class="cooking-items">{{ pending(ticket.items) }}</span>
              </p>
            }
          }
        </section>
      }
    }
  `,
})
export class FloorComponent implements OnDestroy {
  protected readonly auth = inject(AuthStore);
  protected readonly store = inject(FloorStore);

  /** "En cocina" arranca plegado: es contexto, no trabajo pendiente. */
  protected readonly showCooking = signal(false);

  private readonly tick = signal(Date.now());
  private readonly timer: ReturnType<typeof setInterval>;

  constructor() {
    this.auth.configure(API_URL);
    void this.auth.restore().then(() => {
      if (this.auth.signedIn()) this.store.connect();
    });

    effect(() => {
      if (this.auth.signedIn()) this.store.connect();
    });

    // Waiting times age on their own, with no event to trigger a redraw.
    this.timer = setInterval(() => this.tick.set(Date.now()), 20_000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    this.store.disconnect();
  }

  protected label(reason: string): string {
    return CALL_LABELS[reason] ?? reason;
  }

  /** Digits first, so "mesa-7" reads as "7" across a room. */
  protected tableNumber(tableId: string): string {
    const digits = /(\d+)\s*$/.exec(tableId);
    return digits?.[1] ?? tableId;
  }

  protected waitedSince(raisedAt: string): string {
    const minutes = Math.floor((this.tick() - new Date(raisedAt).getTime()) / 60_000);
    return minutes < 1 ? 'recién' : `hace ${minutes} min`;
  }

  protected pending(items: readonly { name: string; quantity: number; status: string }[]): string {
    return items
      .filter((item) => item.status !== 'READY' && item.status !== 'DELIVERED')
      .map((item) => `${item.quantity}× ${item.name}`)
      .join(' · ');
  }

  protected async attend(call: CallDto): Promise<void> {
    await this.store.attend(call.id);
  }

  /** Un viaje entero: la mesa completa de una vez. */
  protected async deliverTable(dishes: readonly Pickup[]): Promise<void> {
    await this.store.deliverTable(dishes);
  }

  protected async deliver(dish: Pickup): Promise<void> {
    await this.store.deliver(dish.orderId, dish.itemId);
  }
}
