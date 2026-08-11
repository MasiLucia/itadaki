import { Money } from '@itadaki/shared/domain';
import { Order } from './order';
import { OrderItem, type ProductSnapshot } from './order-item';
import {
  ORDER_STATUSES,
  type OrderStatus,
  TRACKING_STEPS,
  canTransition,
  isTerminal,
  trackingStepOf,
} from './order-status';

const AT = new Date('2026-01-01T20:00:00Z');

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

const snapshot = (price: number): ProductSnapshot => ({
  productId: 'p1',
  name: 'Milanesa napolitana',
  unitPrice: ars(price),
  capturedAt: AT,
});

const item = (quantity = 1, price = 10_000): OrderItem => {
  const result = OrderItem.create({
    id: 'i1',
    dinerId: 'd1',
    product: snapshot(price),
    quantity,
  });
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

const draft = (items = [item()]): Order => {
  const result = Order.draft({
    id: 'o1',
    clientRequestId: 'c-uuid-1',
    sessionId: 's1',
    currency: 'ARS',
    items,
  });
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

describe('Order state machine', () => {
  it('walks the happy path to DELIVERED', () => {
    const path: OrderStatus[] = ['SENT', 'ACCEPTED', 'IN_PREP', 'READY', 'DELIVERED'];
    let order = draft();

    for (const next of path) {
      const result = order.transitionTo(next, 'staff-1', AT);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) throw new Error('expected ok');
      order = result.value;
      expect(order.status).toBe(next);
    }

    expect(order.history).toHaveLength(path.length);
  });

  it('rejects skipping a state', () => {
    const result = draft().transitionTo('READY', 'staff-1', AT);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('ILLEGAL_TRANSITION');
  });

  it('refuses to send an empty order', () => {
    const result = draft([]).transitionTo('SENT', 'staff-1', AT);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('EMPTY_ORDER');
  });

  it('treats DELIVERED and CANCELLED as terminal', () => {
    expect(isTerminal('DELIVERED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    for (const status of ORDER_STATUSES) {
      expect(canTransition('DELIVERED', status)).toBe(false);
      expect(canTransition('CANCELLED', status)).toBe(false);
    }
  });

  it('cannot cancel once READY', () => {
    expect(canTransition('READY', 'CANCELLED')).toBe(false);
  });

  it('does not mutate the original order on transition', () => {
    const original = draft();
    const result = original.transitionTo('SENT', 'staff-1', AT);
    if (result.isErr()) throw new Error('expected ok');
    expect(original.status).toBe('DRAFT');
    expect(result.value.status).toBe('SENT');
  });

  it('locks items once the order has left DRAFT', () => {
    const sent = draft().transitionTo('SENT', 'staff-1', AT);
    if (sent.isErr()) throw new Error('expected ok');
    const result = sent.value.withItems([item(5)]);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('NOT_A_DRAFT');
  });
});

describe('price snapshot immutability', () => {
  it('keeps the sent price even if the catalog changes later', () => {
    const sent = draft([item(2, 10_000)]).transitionTo('SENT', 'staff-1', AT);
    if (sent.isErr()) throw new Error('expected ok');

    const total = sent.value.total();
    if (total.isErr()) throw new Error('expected ok');
    expect(total.value.amountInMinorUnits).toBe(20_000);

    // The snapshot is frozen, so a later catalog edit cannot reach into it.
    const captured = sent.value.items[0]?.product;
    expect(Object.isFrozen(captured)).toBe(true);
  });

  it('carries the client request id for idempotent replay', () => {
    expect(draft().clientRequestId).toBe('c-uuid-1');
  });
});

describe('OrderItem', () => {
  it('rejects a quantity below one', () => {
    const result = OrderItem.create({
      id: 'i1',
      dinerId: 'd1',
      product: snapshot(1000),
      quantity: 0,
    });
    expect(result.isErr()).toBe(true);
  });

  it('adds modifier deltas into the line total', () => {
    const result = OrderItem.create({
      id: 'i1',
      dinerId: 'd1',
      product: snapshot(10_000),
      modifiers: [{ modifierId: 'm1', name: 'Extra queso', priceDelta: ars(1500) }],
      quantity: 2,
    });
    if (result.isErr()) throw new Error('expected ok');
    const line = result.value.lineTotal();
    if (line.isErr()) throw new Error('expected ok');
    expect(line.value.amountInMinorUnits).toBe(23_000);
  });
});

describe('diner tracking timeline', () => {
  it('maps each rung to its own index in order', () => {
    expect(TRACKING_STEPS.map((step) => trackingStepOf(step))).toEqual([0, 1, 2, 3]);
  });

  it('never advances the timeline backwards along a legal path', () => {
    const path: OrderStatus[] = ['SENT', 'ACCEPTED', 'IN_PREP', 'READY', 'DELIVERED'];
    const indices = path.map((status) => trackingStepOf(status));
    const ascending = indices.every(
      (value, position) => position === 0 || value >= (indices[position - 1] ?? 0),
    );
    expect(ascending).toBe(true);
  });

  it('puts DELIVERED past the last rung so every rung reads as done', () => {
    expect(trackingStepOf('DELIVERED')).toBe(TRACKING_STEPS.length);
  });

  it('leaves DRAFT on the first rung — it has not reached the kitchen', () => {
    expect(trackingStepOf('DRAFT')).toBe(0);
  });

  it('returns a defined index for every status the domain allows', () => {
    for (const status of ORDER_STATUSES) {
      expect(Number.isInteger(trackingStepOf(status))).toBe(true);
    }
  });
});

describe('advancing one dish at a time', () => {
  async function twoDishOrder(): Promise<Order> {
    const empanadas = OrderItem.create({
      id: 'i1',
      dinerId: 'd1',
      product: { ...snapshot(340_000), productId: 'e1', name: 'empanadas' },
      quantity: 1,
    });
    const roast = OrderItem.create({
      id: 'i2',
      dinerId: 'd1',
      product: { ...snapshot(790_000), productId: 'a2', name: 'vacío' },
      quantity: 1,
    });
    if (empanadas.isErr() || roast.isErr()) throw new Error('fixture must be valid');

    const draft = Order.draft({
      id: 'o1',
      clientRequestId: 'req-1',
      sessionId: 's1',
      currency: 'ARS',
      items: [empanadas.value, roast.value],
    });
    if (draft.isErr()) throw new Error('expected ok');

    const sent = draft.value.transitionTo('SENT', 'diner', AT);
    if (sent.isErr()) throw new Error('expected ok');
    return sent.value;
  }

  it('moves the fast dish without touching the slow one', async () => {
    const order = await twoDishOrder();
    const accepted = order.transitionItem('i1', 'ACCEPTED', 'cocina', AT);
    if (accepted.isErr()) throw new Error('expected ok');

    expect(accepted.value.statusOf('i1')).toBe('ACCEPTED');
    expect(accepted.value.statusOf('i2')).toBe('SENT');
  });

  it('keeps the ticket at its slowest dish', async () => {
    let order = await twoDishOrder();
    for (const next of ['ACCEPTED', 'IN_PREP', 'READY'] as const) {
      const moved = order.transitionItem('i1', next, 'cocina', AT);
      if (moved.isErr()) throw new Error('expected ok');
      order = moved.value;
    }

    // The empanadas are ready; the roast has not been started. The board must
    // not claim the table's food is ready.
    expect(order.statusOf('i1')).toBe('READY');
    expect(order.status).toBe('SENT');
  });

  it('only reads as ready once every dish is', async () => {
    let order = await twoDishOrder();
    for (const itemId of ['i1', 'i2']) {
      for (const next of ['ACCEPTED', 'IN_PREP', 'READY'] as const) {
        const moved = order.transitionItem(itemId, next, 'cocina', AT);
        if (moved.isErr()) throw new Error('expected ok');
        order = moved.value;
      }
    }
    expect(order.status).toBe('READY');
  });

  it('refuses to skip a stage on one dish', async () => {
    const order = await twoDishOrder();
    const result = order.transitionItem('i1', 'READY', 'cocina', AT);
    expect(result.isErr()).toBe(true);
  });

  it('refuses a dish that is not on the order', async () => {
    const order = await twoDishOrder();
    const result = order.transitionItem('nope', 'ACCEPTED', 'cocina', AT);
    if (result.isOk()) throw new Error('expected err');
    expect(result.error.kind).toBe('ITEM_NOT_FOUND');
  });

  it('still advances every dish when the whole ticket moves', async () => {
    const order = await twoDishOrder();
    const accepted = order.transitionTo('ACCEPTED', 'cocina', AT);
    if (accepted.isErr()) throw new Error('expected ok');

    expect(accepted.value.statusOf('i1')).toBe('ACCEPTED');
    expect(accepted.value.statusOf('i2')).toBe('ACCEPTED');
  });
});
