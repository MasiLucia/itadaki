import { Injectable, computed, signal } from '@angular/core';
import { type Product } from '@itadaki/catalog/domain';
import {
  type Cart,
  type CartLine,
  addLine,
  cartTotal,
  emptyCart,
  itemCount,
  removeLine,
  setQuantity,
} from '@itadaki/ordering/domain';
import { type ModifierSnapshot } from '@itadaki/ordering/domain';
import { Money } from '@itadaki/shared/domain';

/**
 * Thin signal wrapper over the pure cart functions. All rules live in the
 * domain; this only holds the current value and exposes derived views.
 */
@Injectable({ providedIn: 'root' })
export class CartStore {
  private readonly state = signal<Cart>(emptyCart('ARS'));

  readonly cart = this.state.asReadonly();
  readonly lines = computed<readonly CartLine[]>(() => this.state().lines);
  readonly count = computed(() => itemCount(this.state()));

  readonly total = computed<Money>(() => {
    const result = cartTotal(this.state());
    // A mixed-currency cart cannot happen: every line is added in the cart's
    // own currency. Falling back to zero keeps the view total rather than
    // throwing inside change detection.
    return result.isOk() ? result.value : Money.zero(this.state().currency);
  });

  add(
    product: Product,
    quantity: number,
    modifiers: readonly ModifierSnapshot[],
    notes: string,
    dinerId = 'me',
  ): void {
    const snapshot = {
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      capturedAt: new Date(),
    };

    this.state.update((cart) =>
      addLine(
        cart,
        { dinerId, product: snapshot, modifiers, notes },
        quantity,
        `line-${crypto.randomUUID()}`,
      ),
    );
  }

  setQuantity(lineId: string, quantity: number): void {
    this.state.update((cart) => setQuantity(cart, lineId, quantity));
  }

  remove(lineId: string): void {
    this.state.update((cart) => removeLine(cart, lineId));
  }

  clear(): void {
    this.state.set(emptyCart('ARS'));
  }
}
