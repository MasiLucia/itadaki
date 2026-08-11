import { Money } from '@itadaki/shared/domain';
import { addLine, cartTotal, emptyCart } from '@itadaki/ordering/domain';
import { InMemoryCategoryStore, InMemoryProductStore } from './in-memory-catalog';
import { TENANT_ID } from './menu-fixture';

/** Intl inserts U+00A0 after the symbol; normalise so assertions stay readable. */
const fmt = (m: Money): string =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: m.currency,
    maximumFractionDigits: 0,
  })
    .format(m.amountInMinorUnits / 100)
    .replace(/\u00a0/g, ' ');

describe('in-memory catalog wiring', () => {
  it('serves only available products', async () => {
    const store = new InMemoryProductStore();
    const all = await store.list(TENANT_ID, {});
    const open = await store.list(TENANT_ID, { onlyAvailable: true });

    if (all.isErr() || open.isErr()) throw new Error('expected ok');
    expect(all.value.length).toBe(7);
    expect(open.value.length).toBe(6);
  });

  it('honours the 86 toggle through the writer port', async () => {
    const store = new InMemoryProductStore();
    const before = await store.list(TENANT_ID, { onlyAvailable: true });
    if (before.isErr()) throw new Error('expected ok');

    // Guards against pointing at an id the fixture no longer has: a missing
    // product would silently change nothing and still satisfy the count.
    const toggled = await store.setAvailability(TENANT_ID, 'a1', false);
    expect(toggled.isOk()).toBe(true);

    const after = await store.list(TENANT_ID, { onlyAvailable: true });
    if (after.isErr()) throw new Error('expected ok');
    expect(after.value.length).toBe(before.value.length - 1);
    expect(after.value.map((p) => p.id)).not.toContain('a1');
  });

  it('filters by diet', async () => {
    const store = new InMemoryProductStore();
    const vegan = await store.list(TENANT_ID, { requireDiets: ['VEGAN'], onlyAvailable: true });
    if (vegan.isErr()) throw new Error('expected ok');
    expect(vegan.value.map((p) => p.name)).toEqual(['limonada con menta']);
  });

  it('sorts categories by sortOrder', async () => {
    const store = new InMemoryCategoryStore();
    const list = await store.list(TENANT_ID);
    if (list.isErr()) throw new Error('expected ok');
    expect(list.value.map((c) => c.id)).toEqual([
      'entradas',
      'parrilla',
      'milanesas',
      'bebidas',
      'postres',
    ]);
  });

  it('prices a real cart through the domain', async () => {
    const store = new InMemoryProductStore();
    const found = await store.findById(TENANT_ID, 'a1');
    if (found.isErr()) throw new Error('expected ok');

    const steak = found.value;
    expect(fmt(steak.price)).toBe('$ 8.200');

    const fries = Money.of(80_000, 'ARS');
    if (fries.isErr()) throw new Error('expected ok');

    const cart = addLine(
      emptyCart('ARS'),
      {
        dinerId: 'me',
        product: { productId: steak.id, name: steak.name, unitPrice: steak.price, capturedAt: new Date() },
        modifiers: [{ modifierId: 'm4', name: 'papas fritas', priceDelta: fries.value }],
        notes: '',
      },
      2,
      'l1',
    );

    const total = cartTotal(cart);
    if (total.isErr()) throw new Error('expected ok');
    // (8200 + 800) * 2
    expect(total.value.amountInMinorUnits).toBe(1_800_000);
    expect(fmt(total.value)).toBe('$ 18.000');
  });
});
