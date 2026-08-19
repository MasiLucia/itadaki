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

      <!-- Qué está viendo y por qué.
           Sin esto el salón filtraba en silencio: "nadie está llamando" no
           distinguía entre un salón tranquilo y una pantalla recortada. -->
      @if (store.misMesas().length > 0 || store.enTurno()) {
        <section class="shift" [class.on]="store.enTurno()">
          <div class="shift-info">
            @if (store.enTurno()) {
              <span class="shift-state">En turno</span>
              @if (store.viendoTodo()) {
                <span class="shift-tables">Estás viendo todo el salón</span>
              } @else if (store.misMesas().length > 0) {
                <span class="shift-tables">
                  Tus mesas:
                  @for (id of store.misMesas(); track id) {
                    <span class="shift-table">{{ tableNumber(id) }}</span>
                  }
                </span>
              } @else {
                <span class="shift-tables">Todavía no te asignaron mesas</span>
              }
            } @else {
              <span class="shift-state off">Estás viendo todo el salón</span>
              <span class="shift-tables">
                Tu sector:
                @for (id of store.misMesas(); track id) {
                  <span class="shift-table">{{ tableNumber(id) }}</span>
                }
              </span>
            }
          </div>

          <div class="shift-actions">
            @if (store.enTurno()) {
              <button type="button" class="shift-toggle" (click)="store.viendoTodo.set(!store.viendoTodo())">
                {{ store.viendoTodo() ? 'Ver solo lo mío' : 'Ver todo el salón' }}
              </button>
            }
            <button type="button" class="shift-btn" (click)="toggleShift()">
              {{ store.enTurno() ? 'Salgo' : 'Entro al turno' }}
            </button>
          </div>
        </section>
      }

      <!-- Cobrar y liberar se hacían en silencio si el servidor rechazaba: el
           mozo tocaba, no pasaba nada, y no sabía si el toque había entrado. -->
      @if (store.actionError(); as problema) {
        <p class="action-error" role="alert">
          {{ problema }}
          <button type="button" class="dismiss" (click)="store.actionError.set(null)">
            Entendido
          </button>
        </p>
      }

      <!-- Calls first: a person is waiting, which outranks a plate on the pass. -->
      <section class="block" aria-labelledby="calls-title">
        <h2 class="block-title" id="calls-title">
          Te están llamando
          @if (store.misLlamados().length > 0) {
            <span class="count">{{ store.misLlamados().length }}</span>
          }
        </h2>

        @for (call of store.misLlamados(); track call.id) {
          <article class="card call">
            <div class="card-main">
              <span class="table">Mesa {{ tableNumber(call.tableId) }}</span>
              <span class="reason">{{ label(call.reason) }}</span>
              @if (call.needsCardReader) {
                <span class="posnet">Llevá el posnet</span>
              } @else if (call.paysAtCounter) {
                <!-- El caso que más se escapa: nadie cobra en la mesa, así que
                     el sistema no se entera de si pagaron. Sin este aviso la
                     mesa queda ocupada por gente que ya se fue, o se libera
                     una que todavía no pasó por la caja. -->
                <span class="counter">Pagan en caja · confirmá antes de liberar</span>
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

      <!-- Mesas que ya comieron todo y no pagaron. Sólo aparece cuando hay:
           es una alerta, no una vista. Sin esto la mesa salía del tablero al
           entregarse el último plato y el mozo no tenía dónde verla. -->
      @if (store.misImpagas().length > 0) {
        <section class="block owing" aria-labelledby="owing-title">
          <h2 class="block-title" id="owing-title">
            Pendiente de cobro
            <span class="count owed">{{ store.misImpagas().length }}</span>
          </h2>

          @for (mesa of store.misImpagas(); track mesa.sessionId) {
            <article class="card owing-card">
              <div class="card-main">
                <span class="table">Mesa {{ tableNumber(mesa.tableId) }}</span>
                <span class="amount">{{ money(mesa.owed) }}</span>
                <span class="note">{{ mesa.diners }} en la mesa</span>
                @if (store.payingAtCounter().has(mesa.sessionId)) {
                  <!-- Acá se decide liberar, así que el aviso tiene que estar
                       acá: en la lista de llamados se pierde entre los otros. -->
                  <span class="counter">Dijeron que pagan en la caja</span>
                }
              </div>
              <div class="card-side">
                @if (mesa.since !== null) {
                  <span class="waited">comieron {{ waitedSince(mesa.since) }}</span>
                }
                <!-- Cobrar es la acción normal y cierra la cuenta; liberar sin
                     cobrar existe para la mesa que pagó por fuera del sistema,
                     y dice cuánto debe antes de hacerlo. -->
                <button type="button" class="action" (click)="charge(mesa.sessionId)">
                  Cobré {{ money(mesa.owed) }}
                </button>

                @if (confirming() === mesa.sessionId) {
                  <!-- La confirmación es una pregunta con dos salidas. Un solo
                       botón que cambiaba de texto a "Debe $X · liberar igual"
                       se leía como un cartel sobre la deuda y no como algo que
                       había que volver a tocar: parecía que el primer toque no
                       había hecho nada. -->
                  <p class="release-ask">¿Liberar sin cobrar los {{ money(mesa.owed) }}?</p>
                  <div class="release-row">
                    <button
                      type="button"
                      class="release confirm"
                      (click)="release(mesa.sessionId)"
                    >
                      Sí, liberar
                    </button>
                    <button type="button" class="release" (click)="confirming.set(null)">
                      No
                    </button>
                  </div>
                } @else {
                  <button
                    type="button"
                    class="release"
                    (click)="confirming.set(mesa.sessionId)"
                  >
                    Liberar sin cobrar
                  </button>
                }
              </div>
            </article>
          }
        </section>
      }

      <!-- El código que el mozo le dice a la mesa al sentarla. Todas las mesas,
           no sólo las ocupadas: hace falta justo antes de que la mesa exista.
           Plegado, porque se consulta al sentar y no durante todo el turno. -->
      @if (store.tableCodes().length > 0) {
        <section class="block" aria-labelledby="codes-title">
          <button
            type="button"
            class="cooking-toggle"
            id="codes-title"
            [attr.aria-expanded]="showCodes()"
            (click)="showCodes.set(!showCodes())"
          >
            <span class="quiet-title">Códigos de mesa</span>
            <span class="cooking-count">{{ store.tableCodes().length }} mesas</span>
            <span class="cooking-chevron">{{ showCodes() ? '−' : '+' }}</span>
          </button>

          @if (showCodes()) {
            <p class="quiet">
              Decíselo a la mesa al sentarla. Se renueva solo cuando la liberás.
            </p>
            @for (mesa of store.tableCodes(); track mesa.tableId) {
              <p class="cooking-row">
                <span class="table small">Mesa {{ tableNumber(mesa.tableId) }}</span>
                <span class="cooking-items">
                  {{ mesa.diners > 0 ? mesa.diners + ' sentados' : 'libre' }}
                </span>
                <span class="join-code">{{ mesa.joinCode ?? 'sin código' }}</span>
                <!-- Para cuando se filtró: lo escucharon de la mesa de al lado
                     o quedó anotado en una servilleta que se llevaron. -->
                <button type="button" class="release" (click)="rotate(mesa.tableId)">
                  Renovar
                </button>
              </p>
            }
          }
        </section>
      }

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
                <!-- Para la mesa que pagó en la caja y se fue: sin esto queda
                     ocupada hasta el barrido, y el grupo siguiente escanea el
                     QR y cae en el pedido de los anteriores. -->
                @if (confirming() === ticket.sessionId) {
                  <button
                    type="button"
                    class="release confirm"
                    (click)="release(ticket.sessionId)"
                  >
                    ¿Seguro? Sí, liberar
                  </button>
                } @else {
                  <button
                    type="button"
                    class="release"
                    (click)="confirming.set(ticket.sessionId)"
                  >
                    Liberar
                  </button>
                }
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

  /** Los códigos también: se miran cuando alguien los pide, no todo el turno. */
  protected readonly showCodes = signal(false);

  /**
   * Qué mesa está esperando confirmación para liberarse.
   *
   * Un toque de más borra el pedido de gente que todavía está comiendo, así
   * que el botón pregunta antes — pero en dos toques, no con un diálogo que
   * hay que leer con la bandeja en la mano.
   */
  protected readonly confirming = signal<string | null>(null);

  protected async toggleShift(): Promise<void> {
    await this.store.toggleShift();
  }

  protected async release(sessionId: string): Promise<void> {
    this.confirming.set(null);
    await this.store.releaseTable(sessionId);
  }

  protected async rotate(tableId: string): Promise<void> {
    await this.store.rotateCode(tableId);
  }

  /** Un solo toque: cobrar es lo que pasa en casi todas las mesas. */
  protected async charge(sessionId: string): Promise<void> {
    this.confirming.set(null);
    await this.store.chargeTable(sessionId);
  }

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

  /** El monto como lo lee un mozo cruzando el salón: sin centavos. */
  protected money(amount: { amountInMinorUnits: number; currency: string }): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: amount.currency,
      maximumFractionDigits: 0,
    }).format(amount.amountInMinorUnits / 100);
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
