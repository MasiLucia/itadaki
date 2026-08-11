import { Money } from '@itadaki/shared/domain';
import { Order, OrderItem, type ProductSnapshot } from '@itadaki/ordering/domain';
import { InMemoryOrderStore } from './in-memory-orders';

const AT = new Date('2026-01-01T20:00:00Z');

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

const snapshot = (): ProductSnapshot => ({
  productId: 'p1',
  name: 'Gyoza',
  unitPrice: ars(10_000),
  capturedAt: AT,
});

const orderIn = (id: string, sessionId: string): Order => {
  const item = OrderItem.create({
    id: `${id}-i1`,
    dinerId: 'd1',
    product: snapshot(),
    quantity: 1,
  });
  if (item.isErr()) throw new Error('fixture must be valid');

  return Order.restore({
    id,
    clientRequestId: `req-${id}`,
    sessionId,
    currency: 'ARS',
    status: 'SENT',
    items: [item.value],
    history: [{ status: 'SENT', at: AT, actor: 'd1' }],
  });
};

describe('InMemoryOrderStore.listBySession', () => {
  it('returns only the orders belonging to that session', async () => {
    const store = new InMemoryOrderStore();
    await store.save('t1', orderIn('o1', 's1'));
    await store.save('t1', orderIn('o2', 's1'));
    await store.save('t1', orderIn('o3', 's2'));

    const result = await store.listBySession('t1', 's1');
    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.map((order) => order.id).sort()).toEqual(['o1', 'o2']);
  });

  it('never reaches across tenants', async () => {
    const store = new InMemoryOrderStore();
    await store.save('t1', orderIn('o1', 's1'));

    const result = await store.listBySession('t2', 's1');
    if (result.isErr()) throw new Error('expected ok');
    expect(result.value).toEqual([]);
  });

  it('keeps terminal orders — the diner still sees a delivered dish', async () => {
    const store = new InMemoryOrderStore();
    const delivered = Order.restore({
      ...orderIn('o1', 's1'),
      id: 'o1',
      clientRequestId: 'req-o1',
      sessionId: 's1',
      currency: 'ARS',
      status: 'DELIVERED',
      items: orderIn('o1', 's1').items,
      history: [{ status: 'DELIVERED', at: AT, actor: 'staff' }],
    });
    await store.save('t1', delivered);

    const active = await store.listActive('t1');
    if (active.isErr()) throw new Error('expected ok');
    expect(active.value).toEqual([]);

    const bySession = await store.listBySession('t1', 's1');
    if (bySession.isErr()) throw new Error('expected ok');
    expect(bySession.value.map((order) => order.id)).toEqual(['o1']);
  });
});
