import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { type CartLine, lineTotal } from '@itadaki/ordering/domain';
import { Money } from '@itadaki/shared/domain';
import { BackLinkComponent } from './back-link.component';
import { CartStore } from './cart.store';
import { DINER_PALETTE } from '@itadaki/shared/ui-tokens';
import { SessionStore, type SessionLine } from './session.store';
import { MoneyPipe } from './money.pipe';
import { OrderService } from './order.service';
import { TrackingStore } from './tracking.store';

@Component({
  selector: 'itd-cart',
  standalone: true,
  imports: [RouterLink, MoneyPipe, BackLinkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './cart.page.css',
  template: `
    <header class="pad">
      <itd-back to="/carta" label="la carta" />
      <p class="eyebrow">
        @if (session.tableLabel(); as mesa) {
          mesa {{ mesa }} · pedido compartido
        } @else {
          tu pedido
        }
      </p>
      <h1 class="title">carrito</h1>
      @if (session.isJoined() && session.connected()) {
        <p class="live"><span class="live-dot" aria-hidden="true"></span>se actualiza en vivo</p>
      }
    </header>

    @if (session.isJoined()) {
      <main class="list">
        @for (group of session.session()?.subtotals ?? []; track group.dinerId) {
          <section class="group">
            <header class="group-head">
              <span class="avatar" [style.background]="color(group.colorIndex)">
                {{ initials(group.nickname) }}
              </span>
              <span class="group-name">
                {{ group.nickname }}
                @if (group.dinerId === session.myDinerId()) { <em>(vos)</em> }
              </span>
              <span class="group-total">{{ formatMinor(group.subtotal.amountInMinorUnits) }}</span>
            </header>

            @for (line of linesOf(group.dinerId); track line.id) {
              <article class="row">
                <div class="row-main">
                  <p class="row-name">{{ line.quantity }}× {{ line.name }}</p>
                  @if (line.modifiers.length > 0) {
                    <p class="row-mods">{{ modNames(line) }}</p>
                  }
                  @if (line.notes !== '') {
                    <p class="row-note">“{{ line.notes }}”</p>
                  }
                </div>

                <div class="row-side">
                  <span class="row-total">{{ formatMinor(lineMinor(line)) }}</span>
                  @if (session.ownsLine(line)) {
                    <div class="line-actions">
                      <div class="stepper" role="group" [attr.aria-label]="'Cantidad de ' + line.name">
                        <button type="button" class="step" (click)="change(line, -1)" [attr.aria-label]="'Quitar uno de ' + line.name">–</button>
                        <span class="qty">{{ line.quantity }}</span>
                        <button type="button" class="step" (click)="change(line, 1)" [attr.aria-label]="'Agregar uno de ' + line.name">+</button>
                      </div>
                      <!-- Explicit removal: tapping "–" down to zero works but
                           is not something anyone discovers. -->
                      <button
                        type="button"
                        class="remove"
                        [attr.aria-label]="'Quitar ' + line.name + ' del pedido'"
                        (click)="remove(line)"
                      >
                        Quitar
                      </button>
                    </div>
                  }
                </div>
              </article>
            } @empty {
              <p class="group-empty">todavía no pidió nada</p>
            }
          </section>
        }
      </main>

      <footer class="foot">
        <!-- Lo que ya está en cocina no desaparece de la pantalla al enviar.
             Sin esta línea, la mesa que acababa de pedir veía "Total de la
             mesa $ 0" y parecía que se había perdido el pedido. -->
        @if (placedTotal() > 0) {
          <div class="total-line placed">
            <span>Ya en cocina</span>
            <span>{{ formatMinor(placedTotal()) }}</span>
          </div>
        }
        <div class="total-line">
          <span>{{ placedTotal() > 0 ? 'Sin enviar' : 'Total de la mesa' }}</span>
          <span>{{ formatMinor(tableTotal()) }}</span>
        </div>

        @if (orders.submitState(); as state) {
          @switch (state.kind) {
            @case ('sent') {
              <p class="sent-note" role="status">
                Pedido enviado · la cocina ya lo está viendo
              </p>
              <a class="cta cta-link" routerLink="/estado" (click)="afterSend()">
                Seguir mi pedido →
              </a>
            }
            @case ('queued') {
              <p class="queued-note" role="status">
                Sin señal · guardamos tu pedido y lo enviamos apenas vuelva
              </p>
              <a class="cta cta-link" routerLink="/estado" (click)="afterSend()">
                Entendido →
              </a>
            }
            @default {
              <!-- Sending is the point of the cart: without this the table
                   could build an order the kitchen never received. -->
              <button
                type="button"
                class="cta"
                [disabled]="state.kind === 'sending' || tableLineCount() === 0"
                (click)="sendShared()"
              >
                {{ sendLabel(state.kind) }}
              </button>
              @if (state.kind === 'failed') {
                <p class="error-note" role="alert">{{ state.message }} — probá de nuevo</p>
              }
              @if (sentByOther()) {
                <!-- El carrito se vació sin que esta persona tocara nada:
                     alguien más de la mesa envió mientras elegía. Sin esto,
                     los platos desaparecen de la pantalla sin explicación. -->
                <p class="sent-note" role="status">
                  Alguien de la mesa envió el pedido a la cocina
                </p>
              }
              @if (tracking.hasOrders()) {
                <!-- El pedido es de la mesa: seguirlo no puede depender de
                     quién apretó enviar. Antes, el que no lo mandó veía el
                     carrito vacío y ninguna puerta al estado. -->
                <a class="cta cta-link" routerLink="/estado">
                  Seguir el pedido de la mesa →
                </a>
              }
              <a class="link foot-link" routerLink="/cuenta">Ver la cuenta</a>
            }
          }
        }
      </footer>
    } @else {
    <main class="list">
      @for (line of cart.lines(); track line.id) {
        <article class="row">
          <div class="row-main">
            <p class="row-name">{{ line.quantity }}× {{ line.product.name }}</p>
            @if (line.modifiers.length > 0) {
              <p class="row-mods">{{ modifierNames(line) }}</p>
            }
            @if (line.notes !== '') {
              <p class="row-note">“{{ line.notes }}”</p>
            }
          </div>

          <div class="row-side">
            <span class="row-total">{{ total(line) | money }}</span>
            <div class="stepper" role="group" [attr.aria-label]="'Cantidad de ' + line.product.name">
              <button
                type="button"
                class="step"
                (click)="cart.setQuantity(line.id, line.quantity - 1)"
                [attr.aria-label]="'Quitar uno de ' + line.product.name"
              >
                –
              </button>
              <span class="qty">{{ line.quantity }}</span>
              <button
                type="button"
                class="step"
                (click)="cart.setQuantity(line.id, line.quantity + 1)"
                [attr.aria-label]="'Agregar uno de ' + line.product.name"
              >
                +
              </button>
            </div>
          </div>
        </article>
      } @empty {
        <div class="empty">
          <p>tu carrito está vacío.</p>
          <a class="link" routerLink="/carta">volver a la carta</a>
        </div>
      }
    </main>

    @if (cart.count() > 0) {
      <footer class="foot">
        <div class="totals">
          <span>subtotal</span>
          <span>{{ cart.total() | money }}</span>
        </div>
        <div class="total-line">
          <span>total</span>
          <span>{{ cart.total() | money }}</span>
        </div>
        @if (orders.submitState(); as state) {
          @switch (state.kind) {
            @case ('sent') {
              <p class="sent-note" role="status">
                pedido enviado · la cocina ya lo está viendo
              </p>
              <a class="cta cta-link" routerLink="/estado" (click)="startNew()">
                seguir mi pedido →
              </a>
            }
            @case ('queued') {
              <!-- Held, not lost: it goes out by itself when there is signal. -->
              <p class="queued-note" role="status">
                sin señal · guardamos tu pedido y lo enviamos apenas vuelva
              </p>
              <a class="cta cta-link" routerLink="/estado" (click)="startNew()">
                entendido →
              </a>
            }
            @default {
              <button
                type="button"
                class="cta"
                [disabled]="state.kind === 'sending'"
                (click)="send()"
              >
                {{ state.kind === 'sending' ? 'enviando…' : 'enviar pedido a cocina →' }}
              </button>
              @if (state.kind === 'failed') {
                <p class="error-note" role="alert">{{ state.message }} — probá de nuevo</p>
              }
            }
          }
        }
      </footer>
    }
    }
  `,
})
export class CartPage {
  protected readonly cart = inject(CartStore);
  protected readonly orders = inject(OrderService);
  protected readonly session = inject(SessionStore);
  protected readonly tracking = inject(TrackingStore);

  protected readonly tableTotal = computed(() =>
    (this.session.session()?.subtotals ?? []).reduce(
      (total, entry) => total + entry.subtotal.amountInMinorUnits,
      0,
    ),
  );

  /** Lo que la mesa ya mandó a cocina, que sigue siendo plata que va a pagar. */
  protected readonly placedTotal = computed(
    () => this.session.session()?.placedTotal?.amountInMinorUnits ?? 0,
  );

  protected linesOf(dinerId: string): readonly SessionLine[] {
    return (this.session.session()?.lines ?? []).filter((line) => line.dinerId === dinerId);
  }

  /** Unit price plus modifier deltas, times quantity — mirrors the domain. */
  protected lineMinor(line: SessionLine): number {
    const deltas = line.modifiers.reduce(
      (total, modifier) => total + modifier.priceDelta.amountInMinorUnits,
      0,
    );
    return (line.unitPrice.amountInMinorUnits + deltas) * line.quantity;
  }

  protected formatMinor(minor: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: this.session.session()?.currency ?? 'ARS',
      maximumFractionDigits: 0,
    }).format(minor / 100);
  }

  protected color(index: number): string {
    return DINER_PALETTE[index % DINER_PALETTE.length] ?? DINER_PALETTE[0];
  }

  protected initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
  }

  protected modNames(line: SessionLine): string {
    return line.modifiers.map((modifier) => modifier.name).join(' · ');
  }

  protected change(line: SessionLine, delta: number): void {
    void this.session.changeLine(line.id, line.quantity + delta);
  }

  /** Quantity zero removes the line; the API treats it as a delete. */
  protected remove(line: SessionLine): void {
    void this.session.changeLine(line.id, 0);
  }

  /**
   * Todo lo que la mesa tiene sin enviar, no sólo lo de este teléfono.
   *
   * Cada uno enviaba lo suyo, y una mesa de cuatro le dejaba a la cocina
   * cuatro comandas separadas de la misma mesa, llegando en momentos
   * distintos: la parrilla arrancaba sin saber que faltaban platos, y la
   * comida salía desparejada.
   */
  protected readonly tableLineCount = computed(() => this.session.session()?.lines.length ?? 0);

  /**
   * Si el carrito se vació sin que esta persona enviara nada.
   *
   * Pasa cuando otro de la mesa toca "enviar" mientras alguien todavía elige:
   * sus platos desaparecen de la pantalla, y sin este aviso parecería que la
   * app los perdió.
   */
  private readonly hadLines = signal(false);
  protected readonly sentByOther = computed(
    () => this.hadLines() && this.tableLineCount() === 0 && this.orders.submitState().kind === 'idle',
  );

  /** Recuerda que había platos, para notar cuándo desaparecieron. */
  private readonly watchCart = effect(() => {
    if (this.tableLineCount() > 0) this.hadLines.set(true);
  });

  protected sendLabel(kind: string): string {
    if (kind === 'sending') return 'Enviando…';
    const total = this.tableLineCount();
    if (total === 0) return 'Agregá algo para enviar';
    // Decir "de la mesa" es lo que evita la sorpresa: quien toca el botón
    // está enviando también lo que los demás eligieron.
    return total === 1 ? 'Enviar 1 plato a cocina →' : `Enviar los ${total} platos de la mesa →`;
  }

  /**
   * Sends this diner's lines to the kitchen.
   *
   * A shared table had no way to do this at all: the cart offered only "ver la
   * cuenta", so an order could be built and never reach the kitchen.
   */
  protected async sendShared(): Promise<void> {
    const session = this.session.session();
    const dinerId = this.session.myDinerId();
    if (session === null || dinerId === null) return;

    // El carrito entero de la mesa, en una sola comanda.
    const lines = this.session.session()?.lines ?? [];
    if (lines.length === 0) return;

    await this.orders.submitLines(
      lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        notes: line.notes,
        modifierIds: [],
      })),
      session.id,
      dinerId,
      lines.map((line) => line.id),
    );
  }

  /**
   * El carrito compartido lo vacía el servidor al crear la orden, y el evento
   * de sesión lo refleja en todos los teléfonos de la mesa. Acá sólo queda
   * soltar el estado del botón, y sin depender de que alguien toque el link:
   * antes, quien enviaba y cerraba la app dejaba el carrito lleno para el resto.
   */
  protected afterSend(): void {
    this.orders.reset();
  }

  /**
   * Envío desde el carrito local, el de quien todavía no se unió a la mesa.
   *
   * La sesión y el comensal salen del store: antes iban escritos a mano como
   * "mesa-07" / "me", que sólo funcionaba con la mesa de demostración — en
   * cualquier otra el servidor no encuentra esa sesión y el pedido se pierde.
   *
   * Sin sesión no hay a dónde mandarlo, y decirlo es mejor que un POST que la
   * API va a rechazar: el plato no llega a la cocina en ninguno de los dos
   * casos, pero así la persona se entera antes de quedarse esperando.
   */
  protected async send(): Promise<void> {
    const sessionId = this.session.session()?.id;
    const dinerId = this.session.myDinerId();
    if (sessionId === undefined || dinerId === null) {
      this.orders.needsTable();
      return;
    }

    await this.orders.submit(this.cart.cart(), sessionId, dinerId);
  }

  protected startNew(): void {
    this.cart.clear();
    this.orders.reset();
  }

  protected total(line: CartLine): Money {
    const result = lineTotal(line);
    return result.isOk() ? result.value : Money.zero(line.product.unitPrice.currency);
  }

  protected modifierNames(line: CartLine): string {
    return line.modifiers.map((modifier) => modifier.name).join(' · ');
  }
}
