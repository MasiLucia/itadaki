import { Money } from '@itadaki/shared/domain';
import { addLine, cartTotal, emptyCart, itemCount, removeLine, setQuantity } from './cart';
import { type ProductSnapshot } from './order-item';

const AT = new Date('2026-01-01T20:00:00Z');

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

const product = (id: string, price: number): ProductSnapshot => ({
  productId: id,
  name: `producto ${id}`,
  unitPrice: ars(price),
  capturedAt: AT,
});

const base = (id: string, price: number) => ({
  dinerId: 'd1',
  product: product(id, price),
  modifiers: [],
  notes: '',
});

describe('cart', () => {
  it('starts empty', () => {
    const cart = emptyCart('ARS');
    expect(cart.lines).toHaveLength(0);
    expect(itemCount(cart)).toBe(0);
  });

  it('merges an identical configuration instead of duplicating it', () => {
    let cart = emptyCart('ARS');
    cart = addLine(cart, base('p1', 10_000), 1, 'l1');
    cart = addLine(cart, base('p1', 10_000), 2, 'l2');

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity).toBe(3);
  });

  it('keeps lines separate when notes differ', () => {
    let cart = emptyCart('ARS');
    cart = addLine(cart, base('p1', 10_000), 1, 'l1');
    cart = addLine(cart, { ...base('p1', 10_000), notes: 'sin cebolla' }, 1, 'l2');

    expect(cart.lines).toHaveLength(2);
  });

  it('keeps lines separate when modifiers differ', () => {
    let cart = emptyCart('ARS');
    cart = addLine(cart, base('p1', 10_000), 1, 'l1');
    cart = addLine(
      cart,
      { ...base('p1', 10_000), modifiers: [{ modifierId: 'm1', name: 'extra', priceDelta: ars(500) }] },
      1,
      'l2',
    );

    expect(cart.lines).toHaveLength(2);
  });

  it('merges regardless of modifier order', () => {
    const mods = [
      { modifierId: 'm1', name: 'a', priceDelta: ars(100) },
      { modifierId: 'm2', name: 'b', priceDelta: ars(200) },
    ];
    let cart = emptyCart('ARS');
    cart = addLine(cart, { ...base('p1', 10_000), modifiers: mods }, 1, 'l1');
    cart = addLine(cart, { ...base('p1', 10_000), modifiers: [...mods].reverse() }, 1, 'l2');

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity).toBe(2);
  });

  it('removes a line when quantity drops to zero', () => {
    let cart = addLine(emptyCart('ARS'), base('p1', 10_000), 2, 'l1');
    cart = setQuantity(cart, 'l1', 0);
    expect(cart.lines).toHaveLength(0);
  });

  it('removes a line explicitly', () => {
    let cart = addLine(emptyCart('ARS'), base('p1', 10_000), 1, 'l1');
    cart = removeLine(cart, 'l1');
    expect(cart.lines).toHaveLength(0);
  });

  it('totals lines including modifier deltas', () => {
    let cart = emptyCart('ARS');
    cart = addLine(
      cart,
      { ...base('p1', 10_000), modifiers: [{ modifierId: 'm1', name: 'extra', priceDelta: ars(1500) }] },
      2,
      'l1',
    );
    cart = addLine(cart, base('p2', 3_000), 1, 'l2');

    const total = cartTotal(cart);
    if (total.isErr()) throw new Error('expected ok');
    expect(total.value.amountInMinorUnits).toBe(26_000);
  });

  it('totals an empty cart to zero in its own currency', () => {
    const total = cartTotal(emptyCart('ARS'));
    if (total.isErr()) throw new Error('expected ok');
    expect(total.value.isZero()).toBe(true);
    expect(total.value.currency).toBe('ARS');
  });

  it('does not mutate the cart it was given', () => {
    const original = emptyCart('ARS');
    addLine(original, base('p1', 10_000), 1, 'l1');
    expect(original.lines).toHaveLength(0);
  });
});
