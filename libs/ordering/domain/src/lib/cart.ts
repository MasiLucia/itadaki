import { type CurrencyCode, Money, type MoneyError, type Result, ok } from '@itadaki/shared/domain';
import { type ModifierSnapshot, type ProductSnapshot } from './order-item';

/**
 * A line the diner is still editing. It carries the same frozen snapshot an
 * OrderItem will carry, so the price the diner saw is the price that ships.
 */
export interface CartLine {
  readonly id: string;
  readonly dinerId: string;
  readonly product: ProductSnapshot;
  readonly modifiers: readonly ModifierSnapshot[];
  readonly quantity: number;
  readonly notes: string;
}

export interface Cart {
  readonly currency: CurrencyCode;
  readonly lines: readonly CartLine[];
}

export function emptyCart(currency: CurrencyCode): Cart {
  return { currency, lines: [] };
}

/** Two lines merge only when the product, modifiers, and notes all match. */
function isSameConfiguration(left: CartLine, right: Omit<CartLine, 'id' | 'quantity'>): boolean {
  if (left.product.productId !== right.product.productId) return false;
  if (left.notes !== right.notes) return false;
  if (left.dinerId !== right.dinerId) return false;
  if (left.modifiers.length !== right.modifiers.length) return false;

  const leftIds = [...left.modifiers].map((m) => m.modifierId).sort();
  const rightIds = [...right.modifiers].map((m) => m.modifierId).sort();
  return leftIds.every((id, index) => id === rightIds[index]);
}

export function addLine(
  cart: Cart,
  line: Omit<CartLine, 'id' | 'quantity'>,
  quantity: number,
  newId: string,
): Cart {
  const existing = cart.lines.findIndex((candidate) => isSameConfiguration(candidate, line));

  if (existing >= 0) {
    return {
      ...cart,
      lines: cart.lines.map((candidate, index) =>
        index === existing ? { ...candidate, quantity: candidate.quantity + quantity } : candidate,
      ),
    };
  }

  return { ...cart, lines: [...cart.lines, { ...line, id: newId, quantity }] };
}

/** Setting a quantity to zero or below removes the line. */
export function setQuantity(cart: Cart, lineId: string, quantity: number): Cart {
  if (quantity <= 0) {
    return removeLine(cart, lineId);
  }
  return {
    ...cart,
    lines: cart.lines.map((line) => (line.id === lineId ? { ...line, quantity } : line)),
  };
}

export function removeLine(cart: Cart, lineId: string): Cart {
  return { ...cart, lines: cart.lines.filter((line) => line.id !== lineId) };
}

export function itemCount(cart: Cart): number {
  return cart.lines.reduce((total, line) => total + line.quantity, 0);
}

export function lineTotal(line: CartLine): Result<Money, MoneyError> {
  return line.modifiers
    .reduce<Result<Money, MoneyError>>(
      (acc, modifier) => acc.flatMap((unit) => unit.add(modifier.priceDelta)),
      ok(line.product.unitPrice),
    )
    .flatMap((unit) => unit.multiply(line.quantity));
}

export function cartTotal(cart: Cart): Result<Money, MoneyError> {
  return cart.lines.reduce<Result<Money, MoneyError>>(
    (acc, line) => acc.flatMap((sum) => lineTotal(line).flatMap((amount) => sum.add(amount))),
    ok(Money.zero(cart.currency)),
  );
}
