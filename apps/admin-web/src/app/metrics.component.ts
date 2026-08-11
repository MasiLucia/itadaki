import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { AuthStore } from '@itadaki/shared/ui-auth';

interface MoneyDto {
  readonly amountInMinorUnits: number;
  readonly currency: string;
}

interface ProductStat {
  readonly productId: string;
  readonly name: string;
  readonly unitsSold: number;
  readonly revenue: MoneyDto;
}

export interface MetricsDto {
  readonly windowDays: number;
  readonly orders: number;
  readonly averageTicket: MoneyDto | null;
  readonly medianPrepMinutes: number | null;
  readonly ordersByHour: readonly number[];
  readonly cancelled: number;
  readonly topProducts: readonly ProductStat[];
  readonly bottomProducts: readonly ProductStat[];
}

const WINDOWS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
];

/**
 * What sold, for the person who runs the place.
 *
 * Headline numbers first and one chart, rather than a wall of plots: this is
 * read on a phone between services, and the questions are "how fue" and "qué se
 * vende" — not exploratory analysis.
 */
@Component({
  selector: 'itd-metrics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './metrics.component.css',
  template: `
    <section class="panel">
      <header class="head">
        <h2 class="title">Cómo viene el negocio</h2>
        <div class="windows" role="group" aria-label="Período">
          @for (option of windows; track option.days) {
            <button
              type="button"
              class="window"
              [attr.aria-pressed]="days() === option.days"
              (click)="setWindow(option.days)"
            >
              {{ option.label }}
            </button>
          }
        </div>
      </header>

      @if (data(); as m) {
        @if (m.orders === 0) {
          <p class="empty">
            Todavía no hay pedidos en este período. Cuando empiecen a llegar,
            vas a ver acá cuánto vendiste y qué se pide más.
          </p>
        } @else {
          <!-- Headline numbers, not one-bar charts. -->
          <div class="tiles">
            <div class="tile">
              <span class="tile-label">Pedidos</span>
              <span class="tile-value">{{ m.orders }}</span>
            </div>
            <div class="tile">
              <span class="tile-label">Ticket promedio</span>
              <span class="tile-value">{{ money(m.averageTicket) }}</span>
            </div>
            <div class="tile">
              <span class="tile-label">Facturado</span>
              <span class="tile-value">{{ money(totalRevenue()) }}</span>
            </div>
            <div class="tile">
              <span class="tile-label">Cocina</span>
              <span class="tile-value">{{ prepLabel(m.medianPrepMinutes) }}</span>
            </div>
          </div>

          @if (m.cancelled > 0) {
            <p class="cancelled">
              {{ m.cancelled }} pedido{{ m.cancelled > 1 ? 's' : '' }} cancelado{{
                m.cancelled > 1 ? 's' : ''
              }}
              en el período.
            </p>
          }

          <h3 class="section-title">Lo que más se vende</h3>
          <!-- One hue, length carries the value: the bars rank magnitude, they
               do not identify series, so a categorical palette would be wrong. -->
          <ul class="bars">
            @for (product of m.topProducts; track product.productId) {
              <li class="bar-row">
                <span class="bar-name">{{ product.name }}</span>
                <span class="bar-track">
                  <span
                    class="bar-fill"
                    [style.width.%]="share(product.unitsSold)"
                    [attr.aria-hidden]="true"
                  ></span>
                </span>
                <span class="bar-value">{{ product.unitsSold }}</span>
              </li>
            }
          </ul>

          @if (m.bottomProducts.length > 0 && m.topProducts.length > 3) {
            <h3 class="section-title quiet">Lo que menos sale</h3>
            <ul class="bars">
              @for (product of m.bottomProducts; track product.productId) {
                <li class="bar-row">
                  <span class="bar-name">{{ product.name }}</span>
                  <span class="bar-track">
                    <span
                      class="bar-fill quiet"
                      [style.width.%]="share(product.unitsSold)"
                      [attr.aria-hidden]="true"
                    ></span>
                  </span>
                  <span class="bar-value">{{ product.unitsSold }}</span>
                </li>
              }
            </ul>
          }

          @if (busiestHour() !== null) {
            <p class="hour-note">
              La hora más movida es alrededor de las <strong>{{ busiestHour() }}:00</strong>.
            </p>
          }

          <!-- Identity never rests on colour alone: the same numbers, readable. -->
          <details class="table-view">
            <summary>Ver como tabla</summary>
            <table>
              <caption class="itd-visually-hidden">
                Productos vendidos en los últimos {{ m.windowDays }} días
              </caption>
              <thead>
                <tr><th scope="col">Plato</th><th scope="col">Unidades</th><th scope="col">Facturado</th></tr>
              </thead>
              <tbody>
                @for (product of allProducts(); track product.productId) {
                  <tr>
                    <td>{{ product.name }}</td>
                    <td>{{ product.unitsSold }}</td>
                    <td>{{ money(product.revenue) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </details>
        }
      } @else {
        <p class="empty">Cargando…</p>
      }
    </section>
  `,
})
export class MetricsComponent {
  readonly apiUrl = input.required<string>();

  private readonly auth = inject(AuthStore);

  protected readonly windows = WINDOWS;
  protected readonly days = signal(30);
  protected readonly data = signal<MetricsDto | null>(null);

  /** Scales bars against the best seller, so the top bar always fills the track. */
  private readonly peak = computed(() =>
    Math.max(1, ...(this.data()?.topProducts ?? []).map((product) => product.unitsSold)),
  );

  protected readonly totalRevenue = computed<MoneyDto | null>(() => {
    const current = this.data();
    if (current === null) return null;

    const all = [...current.topProducts, ...current.bottomProducts];
    // Top and bottom can overlap when there are few products; count each once.
    const seen = new Map(all.map((product) => [product.productId, product]));
    const total = [...seen.values()].reduce(
      (sum, product) => sum + product.revenue.amountInMinorUnits,
      0,
    );
    return { amountInMinorUnits: total, currency: current.averageTicket?.currency ?? 'ARS' };
  });

  protected readonly allProducts = computed<readonly ProductStat[]>(() => {
    const current = this.data();
    if (current === null) return [];

    const seen = new Map(
      [...current.topProducts, ...current.bottomProducts].map((product) => [
        product.productId,
        product,
      ]),
    );
    return [...seen.values()].sort((a, b) => b.unitsSold - a.unitsSold);
  });

  protected readonly busiestHour = computed<number | null>(() => {
    const hours = this.data()?.ordersByHour ?? [];
    const best = hours.reduce((top, count, hour) => (count > (hours[top] ?? 0) ? hour : top), 0);
    return (hours[best] ?? 0) > 0 ? best : null;
  });

  constructor() {
    void this.load();
  }

  protected setWindow(days: number): void {
    this.days.set(days);
    void this.load();
  }

  private async load(): Promise<void> {
    const response = await fetch(`${this.apiUrl()}/metrics?days=${this.days()}`, {
      headers: this.auth.headers(),
    });
    if (response.ok) {
      this.data.set((await response.json()) as MetricsDto);
    }
  }

  protected share(units: number): number {
    return Math.max(4, Math.round((units / this.peak()) * 100));
  }

  protected money(amount: MoneyDto | null): string {
    if (amount === null) return '—';
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: amount.currency,
      maximumFractionDigits: 0,
    }).format(amount.amountInMinorUnits / 100);
  }

  /** Sub-minute values are noise from a fast test kitchen, not a real figure. */
  protected prepLabel(minutes: number | null): string {
    if (minutes === null) return '—';
    return minutes < 1 ? '<1 min' : `${Math.round(minutes)} min`;
  }
}
