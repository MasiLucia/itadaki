import { type Order } from '@itadaki/ordering/domain';
import { Money, type Result, err, ok } from '@itadaki/shared/domain';
import {
  type OrderEvent,
  type OrderEventPublisher,
  type OrderReader,
  type OrderRepositoryError,
  type OrderWriter,
} from './ports';
import {
  type LinePricer,
  type PricedLine,
  type SubmitOrderCommand,
  type SubmitOrderError,
  type SubmitOrderLine,
  submitOrder,
} from './submit-order';
import { advanceOrder } from './advance-order';

const AT = new Date('2026-01-01T20:00:00Z');

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

class FakeOrderStore implements OrderReader, OrderWriter {
  private readonly rows = new Map<string, Order>();

  async findById(_tenantId: string, orderId: string): Promise<Result<Order, OrderRepositoryError>> {
    const found = this.rows.get(orderId);
    return found === undefined ? err({ kind: 'NOT_FOUND', id: orderId }) : ok(found);
  }

  async listActive(_tenantId: string): Promise<Result<readonly Order[], OrderRepositoryError>> {
    return ok([...this.rows.values()].filter((o) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED'));
  }

  async listBySession(
    _tenantId: string,
    sessionId: string,
  ): Promise<Result<readonly Order[], OrderRepositoryError>> {
    return ok([...this.rows.values()].filter((o) => o.sessionId === sessionId));
  }

  async listPlacedBetween(): Promise<Result<readonly Order[], OrderRepositoryError>> {
    return ok([...this.rows.values()]);
  }

  async findByClientRequestId(
    _tenantId: string,
    clientRequestId: string,
  ): Promise<Result<Order | null, OrderRepositoryError>> {
    const found = [...this.rows.values()].find((o) => o.clientRequestId === clientRequestId);
    return ok(found ?? null);
  }

  async save(_tenantId: string, order: Order): Promise<Result<Order, OrderRepositoryError>> {
    this.rows.set(order.id, order);
    return ok(order);
  }

  get size(): number {
    return this.rows.size;
  }
}

class FakePublisher implements OrderEventPublisher {
  readonly published: OrderEvent[] = [];
  async orderChanged(event: OrderEvent): Promise<void> {
    this.published.push(event);
  }
}

class FakePricer implements LinePricer {
  constructor(private readonly unavailable: readonly string[] = []) {}

  async price(_tenantId: string, line: SubmitOrderLine): Promise<Result<PricedLine, SubmitOrderError>> {
    if (this.unavailable.includes(line.productId)) {
      return err({ kind: 'PRODUCT_UNAVAILABLE', productId: line.productId });
    }
    return ok({
      product: {
        productId: line.productId,
        name: `producto ${line.productId}`,
        unitPrice: ars(10_000),
        capturedAt: AT,
      },
      modifiers: line.modifierIds.map((id) => ({
        modifierId: id,
        name: `mod ${id}`,
        priceDelta: ars(1_000),
      })),
    });
  }
}

const command = (overrides: Partial<SubmitOrderCommand> = {}): SubmitOrderCommand => ({
  tenantId: 'itadaki',
  sessionId: 's1',
  dinerId: 'd1',
  clientRequestId: 'req-1',
  currency: 'ARS',
  lines: [{ productId: 'p1', quantity: 2, notes: '', modifierIds: [] }],
  ...overrides,
});

function makeSubmit(store = new FakeOrderStore(), pricer: LinePricer = new FakePricer()) {
  const events = new FakePublisher();
  let counter = 0;
  const submit = submitOrder({
    orders: store,
    pricer,
    events,
    newId: () => `id-${(counter += 1)}`,
    now: () => AT,
  });
  return { submit, store, events };
}

describe('submitOrder', () => {
  it('creates an order in SENT and publishes it', async () => {
    const { submit, events } = makeSubmit();
    const result = await submit(command());

    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.status).toBe('SENT');
    expect(events.published).toHaveLength(1);
    expect(events.published[0]?.status).toBe('SENT');
  });

  it('freezes the catalog price into the order', async () => {
    const { submit } = makeSubmit();
    const result = await submit(command());

    if (result.isErr()) throw new Error('expected ok');
    const total = result.value.total();
    if (total.isErr()) throw new Error('expected ok');
    expect(total.value.amountInMinorUnits).toBe(20_000);
  });

  it('includes modifier deltas in the frozen price', async () => {
    const { submit } = makeSubmit();
    const result = await submit(
      command({ lines: [{ productId: 'p1', quantity: 1, notes: '', modifierIds: ['m1', 'm2'] }] }),
    );

    if (result.isErr()) throw new Error('expected ok');
    const total = result.value.total();
    if (total.isErr()) throw new Error('expected ok');
    expect(total.value.amountInMinorUnits).toBe(12_000);
  });

  it('returns the original order when the same request is retried', async () => {
    const { submit, store, events } = makeSubmit();

    const first = await submit(command());
    const second = await submit(command());

    if (first.isErr() || second.isErr()) throw new Error('expected ok');
    expect(second.value.id).toBe(first.value.id);
    expect(store.size).toBe(1);
    // The retry must not re-notify the kitchen.
    expect(events.published).toHaveLength(1);
  });

  it('creates separate orders for different request ids', async () => {
    const { submit, store } = makeSubmit();
    await submit(command({ clientRequestId: 'req-1' }));
    await submit(command({ clientRequestId: 'req-2' }));
    expect(store.size).toBe(2);
  });

  it('rejects an empty submission', async () => {
    const { submit } = makeSubmit();
    const result = await submit(command({ lines: [] }));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('EMPTY_SUBMISSION');
  });

  it('fails when a product is unavailable and saves nothing', async () => {
    const { submit, store } = makeSubmit(new FakeOrderStore(), new FakePricer(['p1']));
    const result = await submit(command());

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('PRODUCT_UNAVAILABLE');
    expect(store.size).toBe(0);
  });

  it('rejects a zero quantity line', async () => {
    const { submit } = makeSubmit();
    const result = await submit(
      command({ lines: [{ productId: 'p1', quantity: 0, notes: '', modifierIds: [] }] }),
    );
    expect(result.isErr()).toBe(true);
  });
});

describe('advanceOrder', () => {
  async function seeded() {
    const { submit, store, events } = makeSubmit();
    const created = await submit(command());
    if (created.isErr()) throw new Error('expected ok');
    const advance = advanceOrder({ orders: store, events, now: () => AT });
    return { advance, order: created.value, store, events };
  }

  it('moves SENT to ACCEPTED and publishes', async () => {
    const { advance, order, events } = await seeded();
    const result = await advance({
      tenantId: 'itadaki',
      orderId: order.id,
      next: 'ACCEPTED',
      actorId: 'cocina',
    });

    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.status).toBe('ACCEPTED');
    expect(events.published.at(-1)?.status).toBe('ACCEPTED');
  });

  it('refuses to skip a state', async () => {
    const { advance, order } = await seeded();
    const result = await advance({
      tenantId: 'itadaki',
      orderId: order.id,
      next: 'DELIVERED',
      actorId: 'cocina',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('ILLEGAL_TRANSITION');
  });

  it('reports a missing order', async () => {
    const { advance } = await seeded();
    const result = await advance({
      tenantId: 'itadaki',
      orderId: 'nope',
      next: 'ACCEPTED',
      actorId: 'cocina',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('NOT_FOUND');
  });

  it('walks the full path to DELIVERED', async () => {
    const { advance, order } = await seeded();
    for (const next of ['ACCEPTED', 'IN_PREP', 'READY', 'DELIVERED'] as const) {
      const result = await advance({
        tenantId: 'itadaki',
        orderId: order.id,
        next,
        actorId: 'cocina',
      });
      if (result.isErr()) throw new Error(`failed at ${next}`);
      expect(result.value.status).toBe(next);
    }
  });
});
