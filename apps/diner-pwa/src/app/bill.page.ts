import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DINER_PALETTE } from '@itadaki/shared/ui-tokens';
import { BillStore, type MoneyDto, type SplitKind, type TipChoice } from './bill.store';
import { SessionStore } from './session.store';

const SPLIT_LABELS: ReadonlyArray<{ kind: SplitKind; label: string; hint: string }> = [
  { kind: 'BY_DINER', label: 'cada uno lo suyo', hint: 'pagás lo que pediste' },
  { kind: 'EQUAL', label: 'partes iguales', hint: 'el total dividido' },
  { kind: 'BY_ITEM', label: 'por plato', hint: 'elegís quién paga qué' },
];

const TIP_OPTIONS: ReadonlyArray<{ label: string; choice: TipChoice }> = [
  { label: 'sin propina', choice: { kind: 'NONE' } },
  { label: '5%', choice: { kind: 'PERCENTAGE', percent: 0.05 } },
  { label: '10%', choice: { kind: 'PERCENTAGE', percent: 0.1 } },
  { label: '15%', choice: { kind: 'PERCENTAGE', percent: 0.15 } },
  { label: '20%', choice: { kind: 'PERCENTAGE', percent: 0.2 } },
];

const CURRENCIES = ['ARS', 'USD', 'EUR', 'BRL'] as const;

@Component({
  selector: 'itd-bill',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bill.page.css',
  template: `
    <header class="pad">
      <p class="eyebrow">mesa 07 · cuenta</p>
      <h1 class="title">gochisousama!</h1>
    </header>

    @if (store.bill(); as bill) {
      <main class="body">
        <section class="card">
          @for (line of bill.lines; track line.id) {
            <div class="line">
              <span>{{ line.quantity }}× {{ line.name }}</span>
              <span class="amount">{{ format(line.unitTotal, line.quantity) }}</span>
            </div>
          }
          <div class="line total">
            <span>total {{ bill.currency }}</span>
            <span class="amount">{{ money(bill.subtotal) }}</span>
          </div>

          @if (displayCurrency() !== bill.currency && bill.display) {
            <p class="converted">
              ≈ {{ money(bill.display) }} · cotización del momento del pedido
            </p>
          }
        </section>

        <section class="card">
          <h2 class="card-title">ver en</h2>
          <div class="chips">
            @for (code of currencies; track code) {
              <button
                type="button"
                class="chip"
                [attr.aria-pressed]="displayCurrency() === code"
                (click)="setCurrency(code)"
              >
                {{ code }}
              </button>
            }
          </div>
        </section>

        <section class="card">
          <h2 class="card-title">cómo dividimos</h2>
          <div class="options">
            @for (option of splitOptions; track option.kind) {
              <button
                type="button"
                class="option"
                [attr.aria-pressed]="splitKind() === option.kind"
                (click)="chooseSplit(option.kind)"
              >
                <span class="option-label">{{ option.label }}</span>
                <span class="option-hint">{{ option.hint }}</span>
              </button>
            }
          </div>

          @if (splitKind() === 'EQUAL') {
            <div class="stepper-row">
              <span class="stepper-label">entre</span>
              <div class="stepper" role="group" aria-label="Cantidad de personas">
                <button type="button" class="step" (click)="changeParts(-1)" aria-label="Menos personas">–</button>
                <span class="qty">{{ parts() }}</span>
                <button type="button" class="step" (click)="changeParts(1)" aria-label="Más personas">+</button>
              </div>
              <span class="stepper-label">persona{{ parts() > 1 ? 's' : '' }}</span>
            </div>
          }

          @if (splitKind() === 'BY_ITEM') {
            <p class="assign-hint">tocá un nombre para asignarle cada plato</p>
            @for (line of bill.lines; track line.id) {
              <div class="assign">
                <span class="assign-name">{{ line.quantity }}× {{ line.name }}</span>
                <div class="assign-people">
                  @for (person of bill.participants; track person.id) {
                    <button
                      type="button"
                      class="person"
                      [style.background]="isAssigned(line.id, person.id) ? color(person.colorIndex) : 'transparent'"
                      [style.color]="isAssigned(line.id, person.id) ? 'white' : 'inherit'"
                      [attr.aria-pressed]="isAssigned(line.id, person.id)"
                      (click)="toggleAssign(line.id, person.id)"
                    >
                      {{ person.nickname }}
                    </button>
                  }
                </div>
              </div>
            }
          }
        </section>

        <section class="card">
          <h2 class="card-title">propina <em>(opcional)</em></h2>
          <div class="chips">
            @for (option of tipOptions; track option.label) {
              <button
                type="button"
                class="chip"
                [attr.aria-pressed]="tipLabel() === option.label"
                (click)="chooseTip(option)"
              >
                {{ option.label }}
              </button>
            }
          </div>
        </section>

        @if (store.error(); as error) {
          <p class="error" role="alert">{{ error }}</p>
        }

        @if (store.split(); as split) {
          <section class="card result">
            <h2 class="card-title">quién paga qué</h2>
            @for (share of split.shares; track share.payerId) {
              <div class="share">
                <span class="share-name">{{ share.label }}</span>
                <span class="share-amount">{{ money(share.amountWithTip) }}</span>
              </div>
            }

            @if (split.tip.amountInMinorUnits > 0) {
              <div class="line sub">
                <span>propina incluida</span>
                <span class="amount">{{ money(split.tip) }}</span>
              </div>
            }
            <div class="line total">
              <span>total</span>
              <span class="amount">{{ money(split.total) }}</span>
            </div>
          </section>
        }
      </main>

      <footer class="foot">
        @if (bill.status === 'SETTLED') {
          <p class="settled" role="status">cuenta cerrada · gracias!</p>
        } @else if (confirming()) {
          <!-- Settling is one-way: anything ordered afterwards is not on it. -->
          <p class="confirm-note">¿ya pagaron? la cuenta se cierra y no se puede reabrir</p>
          <div class="confirm-row">
            <button type="button" class="cta ghost" (click)="confirming.set(false)">
              todavía no
            </button>
            <button type="button" class="cta" [disabled]="store.busy()" (click)="settle()">
              {{ store.busy() ? 'cerrando…' : 'sí, cerrar' }}
            </button>
          </div>
        } @else {
          <button type="button" class="cta" (click)="confirming.set(true)">pagar en caja</button>
        }
      </footer>
    } @else {
      <main class="body empty">
        @if (store.busy()) {
          <p>abriendo la cuenta…</p>
        } @else if (!session.isJoined()) {
          <p class="muted">Unite a la mesa para ver la cuenta.</p>
          <a class="link" routerLink="/unirse">Unirme a la mesa</a>
        } @else {
          <!-- A bill needs something to bill: an empty table has no total. -->
          <p class="muted">Todavía no pidieron nada en esta mesa.</p>
          <a class="link" routerLink="/carta">Ver la carta</a>
        }
      </main>
    }
  `,
})
export class BillPage {
  protected readonly store = inject(BillStore);
  protected readonly session = inject(SessionStore);

  protected readonly splitOptions = SPLIT_LABELS;
  protected readonly tipOptions = TIP_OPTIONS;
  protected readonly currencies = CURRENCIES;

  protected readonly splitKind = signal<SplitKind>('BY_DINER');
  protected readonly parts = signal(2);
  protected readonly tipLabel = signal('sin propina');
  protected readonly displayCurrency = signal<string>('ARS');
  private readonly assignments = signal<ReadonlyMap<string, readonly string[]>>(new Map());

  private tip: TipChoice = { kind: 'NONE' };

  protected readonly sessionId = computed(() => this.session.session()?.id ?? null);

  constructor() {
    const id = this.session.session()?.id;
    if (id === undefined) return;

    // Opening this screen *is* asking for the bill — a diner who tapped "ver la
    // cuenta" should not land on a second button that says the same thing.
    // Raising one is idempotent server-side, so an existing bill comes back
    // unchanged rather than being reissued.
    void this.store.close(id).then(() => {
      this.parts.set(this.store.bill()?.participants.length ?? 2);
      this.recompute();
    });
  }

  protected readonly confirming = signal(false);

  protected async settle(): Promise<void> {
    const id = this.sessionId();
    if (id === null) return;

    const done = await this.store.settle(id);
    if (done) this.confirming.set(false);
  }

  protected async openBill(): Promise<void> {
    const id = this.sessionId();
    if (id === null) return;

    await this.store.close(id);
    this.parts.set(this.store.bill()?.participants.length ?? 2);
    this.recompute();
  }

  protected chooseSplit(kind: SplitKind): void {
    this.splitKind.set(kind);
    this.recompute();
  }

  protected changeParts(delta: number): void {
    this.parts.update((current) => Math.max(1, current + delta));
    this.recompute();
  }

  protected chooseTip(option: { label: string; choice: TipChoice }): void {
    this.tipLabel.set(option.label);
    this.tip = option.choice;
    this.recompute();
  }

  protected setCurrency(code: string): void {
    this.displayCurrency.set(code);
    const id = this.sessionId();
    if (id !== null) void this.store.load(id, code);
  }

  protected isAssigned(lineId: string, payerId: string): boolean {
    return (this.assignments().get(lineId) ?? []).includes(payerId);
  }

  protected toggleAssign(lineId: string, payerId: string): void {
    this.assignments.update((current) => {
      const next = new Map(current);
      const existing = next.get(lineId) ?? [];
      next.set(
        lineId,
        existing.includes(payerId)
          ? existing.filter((id) => id !== payerId)
          : [...existing, payerId],
      );
      return next;
    });
    this.recompute();
  }

  private recompute(): void {
    const id = this.sessionId();
    if (id === null || this.store.bill() === null) return;

    const assignments =
      this.splitKind() === 'BY_ITEM'
        ? [...this.assignments().entries()]
            .filter(([, payerIds]) => payerIds.length > 0)
            .map(([lineId, payerIds]) => ({ lineId, payerIds }))
        : undefined;

    void this.store.computeSplit(id, this.splitKind(), this.tip, this.parts(), assignments);
  }

  protected money(amount: MoneyDto): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: amount.currency,
      maximumFractionDigits: amount.currency === 'ARS' ? 0 : 2,
    }).format(amount.amountInMinorUnits / 100);
  }

  protected format(unit: MoneyDto, quantity: number): string {
    return this.money({ ...unit, amountInMinorUnits: unit.amountInMinorUnits * quantity });
  }

  protected color(index: number): string {
    return DINER_PALETTE[index % DINER_PALETTE.length] ?? DINER_PALETTE[0];
  }
}
