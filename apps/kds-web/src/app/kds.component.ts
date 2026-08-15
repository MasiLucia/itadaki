import { apiUrl } from '@itadaki/shared/domain';
import {
  ChangeDetectionStrategy,
  Component,
  type OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AuthStore, LoginComponent } from '@itadaki/shared/ui-auth';
import { type TableCard, groupByTable } from '@itadaki/ordering/domain';
import { KdsStore, type TicketDto } from './kds.store';

interface Column {
  readonly status: string;
  readonly label: string;
  readonly next: string | null;
  readonly action: string;
}

const COLUMNS: readonly Column[] = [
  { status: 'SENT', label: 'nuevo', next: 'ACCEPTED', action: 'aceptar' },
  { status: 'ACCEPTED', label: 'aceptado', next: 'IN_PREP', action: 'empezar' },
  { status: 'IN_PREP', label: 'en preparación', next: 'READY', action: 'marcar listo' },
  { status: 'READY', label: 'listo para servir', next: 'DELIVERED', action: 'entregado' },
];

const STATIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'ALL', label: 'todas' },
  { id: 'GRILL', label: 'parrilla' },
  { id: 'COLD', label: 'fríos' },
  { id: 'BAR', label: 'barra' },
  { id: 'DESSERT', label: 'postres' },
];

/** Minutes a ticket may wait before the board flags it. */
const API_URL = apiUrl();

const SLA_WARNING = 8;
const SLA_LATE = 15;

@Component({
  selector: 'itd-kds',
  standalone: true,
  imports: [LoginComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './kds.component.css',
  template: `
    @if (!auth.ready()) {
      <p class="booting">Cargando…</p>
    } @else if (!auth.signedIn()) {
      <!-- Kitchen staff are created by the owner; signing up here would make
           a second restaurant by mistake. -->
      <itd-login context="Cocina" [allowSignUp]="false" />
    } @else {
    <header class="head">
      <div class="head-left">
        <p class="eyebrow">KDS · cocina en vivo</p>
        <h1 class="title">Pedidos entrando ahora</h1>
      </div>

      <nav class="stations" aria-label="Estación">
        @for (station of stations; track station.id) {
          <button
            type="button"
            class="station"
            [attr.aria-pressed]="activeStation() === station.id"
            (click)="selectStation(station.id)"
          >
            {{ station.label }}
          </button>
        }
      </nav>

      <div class="head-right">
        <p class="live" [class.off]="!store.connected()">
          <span class="dot" aria-hidden="true"></span>
          {{ store.connected() ? 'En vivo' : 'Reconectando…' }}
        </p>
        @if (store.pending(); as pending) {
          <!-- Says the taps are safe, not that something broke: they go out
               on their own as soon as there is signal again. -->
          <p class="queued" role="status">
            {{ pending }} sin enviar · se mandan solos
          </p>
        }
        <button type="button" class="signout" (click)="auth.signOut()">Salir</button>
      </div>
    </header>

    <div class="board">
      @for (column of columns; track column.status) {
        <section class="col" [attr.data-status]="column.status">
          <header class="col-head">
            <h2 class="col-name">{{ column.label }}</h2>
            <span class="col-count">{{ ticketsFor(column.status).length }}</span>
          </header>

          <div class="tickets">
            @for (ticket of ticketsFor(column.status); track ticket.key) {
              <article class="ticket" [attr.data-sla]="slaOf(ticket)">
                <header class="ticket-head">
                  <span class="ticket-table">
                    <span class="table-word">mesa</span>
                    <span class="table-number">{{ tableNumber(ticket) }}</span>
                  </span>
                  <span class="ticket-time">{{ waited(ticket) }}</span>
                </header>

                @if (ticket.ticketCount > 1) {
                  <!-- La mesa agregó algo después del primer envío. Sin esto,
                       los platos nuevos aparecerían mezclados sin aviso. -->
                  <p class="ticket-added">agregó · {{ ticket.ticketCount }} envíos</p>
                }

                <ul class="ticket-items">
                  @for (item of visibleItems(ticket); track item.orderId + item.id) {
                    <li class="ticket-item" [attr.data-item-status]="item.status">
                      <span class="qty">{{ item.quantity }}</span>
                      <span class="item-body">
                        <span class="item-name">{{ item.name }}</span>
                        @if (item.notes !== '') {
                          <span class="item-note">{{ item.notes }}</span>
                        }
                        <!-- Each dish carries its own stage: a cook can send the
                             empanadas out while the roast is still cooking. -->
                        @if (nextFor(item.status); as step) {
                          <button
                            type="button"
                            class="item-btn"
                            (click)="advanceItem(item.orderId, item.id, step.next)"
                          >
                            {{ step.action }}
                          </button>
                        } @else {
                          <span class="item-done">entregado</span>
                        }
                      </span>
                      <span class="item-station" [attr.data-station]="item.station">
                        {{ stationLabel(item.station) }}
                      </span>
                    </li>
                  }
                </ul>

                @if (column.next !== null) {
                  <button type="button" class="ticket-btn" (click)="advanceCard(ticket, column.next)">
                    {{ column.action }} · todo →
                  </button>
                }
              </article>
            } @empty {
              <p class="empty">sin pedidos</p>
            }
          </div>
        </section>
      }
    </div>
    }
  `,
})
export class KdsComponent implements OnDestroy {
  protected readonly auth = inject(AuthStore);
  protected readonly store = inject(KdsStore);
  protected readonly columns = COLUMNS;
  protected readonly stations = STATIONS;

  protected readonly activeStation = signal('ALL');
  private readonly tick = signal(Date.now());
  private readonly timer: ReturnType<typeof setInterval>;

  /**
   * Only tickets with at least one item for the active station. A grill screen
   * showing drinks is noise the cook has to filter by eye.
   */
  private readonly visible = computed<readonly TicketDto[]>(() => {
    const station = this.activeStation();
    if (station === 'ALL') return this.store.tickets();

    return this.store
      .tickets()
      .filter((ticket) => ticket.items.some((item) => item.station === station));
  });

  /**
   * Una tarjeta por mesa, no por envío.
   *
   * Una mesa que agrega el postre aparecía dos veces en la pantalla, a veces
   * en columnas distintas, y el cocinero tenía que reconstruirla a ojo.
   */
  private readonly cards = computed(() => groupByTable(this.visible()));

  private readonly byStatus = computed(() => {
    const grouped = new Map<string, TableCard[]>();
    for (const card of this.cards()) {
      const bucket = grouped.get(card.status) ?? [];
      bucket.push(card);
      grouped.set(card.status, bucket);
    }
    return grouped;
  });

  constructor() {
    this.auth.configure(API_URL);
    void this.auth.restore().then(() => {
      if (this.auth.signedIn()) this.store.connect();
    });

    // Connect once a sign-in completes.
    effect(() => {
      if (this.auth.signedIn()) this.store.connect();
    });
    // Elapsed time drives the SLA colour, so the board has to re-read the
    // clock even when no event arrives.
    this.timer = setInterval(() => this.tick.set(Date.now()), 20_000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    this.store.disconnect();
  }

  protected selectStation(id: string): void {
    this.activeStation.set(id);
  }

  protected ticketsFor(status: string): readonly TableCard[] {
    return this.byStatus().get(status) ?? [];
  }

  /**
   * Avanza todos los platos de la mesa que todavía no llegaron a ese estado.
   *
   * Recorre plato por plato porque una tarjeta puede juntar varios envíos, y
   * cada uno es una comanda distinta del lado del servidor.
   */
  protected async advanceCard(card: TableCard, next: string): Promise<void> {
    for (const item of card.items) {
      if (item.status !== next) {
        await this.store.advanceItem(item.orderId, item.id, next);
      }
    }
  }

  /** On a station screen, hide the lines that belong to another station. */
  protected visibleItems(card: TableCard): TableCard['items'] {
    const station = this.activeStation();
    if (station === 'ALL') return card.items;
    return card.items.filter((item) => item.station === station);
  }

  protected stationLabel(station: string): string {
    return STATIONS.find((entry) => entry.id === station)?.label ?? station.toLowerCase();
  }

  /**
   * The number alone, rendered large — it is what a cook scans the board for.
   * A readable table id ('mesa-7') gives up its number; a generated session id
   * falls back to a short prefix so the ticket is still identifiable.
   */
  /** The one step a dish can take from where it is, or null once delivered. */
  protected nextFor(status: string): { next: string; action: string } | null {
    const step = COLUMNS.find((column) => column.status === status);
    return step?.next === null || step === undefined
      ? null
      : { next: step.next, action: step.action };
  }

  protected async advanceItem(orderId: string, itemId: string, next: string): Promise<void> {
    await this.store.advanceItem(orderId, itemId, next);
  }

  protected tableNumber(card: TableCard): string {
    // `key` ya trae la sesión cuando la comanda no dice de qué mesa es.
    const source = card.tableId ?? card.key;
    const digits = /(\d+)\s*$/.exec(source);
    if (digits !== null) return digits[1] ?? source;
    return source.length > 12 ? source.slice(0, 4) : source;
  }

  private minutesWaiting(card: TableCard): number {
    if (card.placedAt === null) return 0;
    return (this.tick() - new Date(card.placedAt).getTime()) / 60_000;
  }

  protected slaOf(card: TableCard): 'ok' | 'warning' | 'late' {
    const minutes = this.minutesWaiting(card);
    if (minutes >= SLA_LATE) return 'late';
    if (minutes >= SLA_WARNING) return 'warning';
    return 'ok';
  }

  protected waited(card: TableCard): string {
    if (card.placedAt === null) return 'ahora';
    const minutes = Math.floor(this.minutesWaiting(card));
    if (minutes < 1) return 'recién';
    return `${minutes} min`;
  }

  protected advance(orderId: string, next: string): void {
    void this.store.advance(orderId, next);
  }
}
