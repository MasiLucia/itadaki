import { type ProductSnapshot, groupByDiner } from '@itadaki/ordering/domain';
import { Money } from '@itadaki/shared/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';
import { type OrderRepositoryError } from './ports';
import {
  type SessionEvent,
  type SessionEventPublisher,
  type SessionReader,
  type SessionState,
  type SessionWriter,
} from './session-ports';
import {
  addToSharedCart,
  changeSharedLine,
  joinTable,
  leaveTable,
} from './session-use-cases';

const AT = new Date('2026-01-01T20:00:00Z');

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

const snapshot = (id: string, price: number): ProductSnapshot => ({
  productId: id,
  name: `plato ${id}`,
  unitPrice: ars(price),
  capturedAt: AT,
});

/** In-memory double, kept local so `application` never imports `infra`. */
class FakeSessionStore implements SessionReader, SessionWriter {
  private readonly rows = new Map<string, SessionState>();

  async findById(
    _tenantId: string,
    sessionId: string,
  ): Promise<Result<SessionState, OrderRepositoryError>> {
    const found = this.rows.get(sessionId);
    return found === undefined ? err({ kind: 'NOT_FOUND', id: sessionId }) : ok(found);
  }

  async findOpenForTable(
    _tenantId: string,
    tableId: string,
  ): Promise<Result<SessionState | null, OrderRepositoryError>> {
    const found = [...this.rows.values()].find(
      (state) => state.session.tableId === tableId && state.session.status === 'OPEN',
    );
    return ok(found ?? null);
  }

  async listOpen(): Promise<Result<readonly SessionState[], OrderRepositoryError>> {
    return ok([...this.rows.values()].filter((state) => state.session.status === 'OPEN'));
  }

  async mutate(
    tenantId: string,
    sessionId: string,
    change: (state: SessionState) => Result<SessionState, OrderRepositoryError>,
  ): Promise<Result<SessionState, OrderRepositoryError>> {
    // Single-process and single-threaded: awaiting nothing between read and
    // write is already atomic here. The lock only matters against Postgres.
    const found = await this.findById(tenantId, sessionId);
    if (found.isErr()) return found;
    const changed = change(found.value);
    return changed.isErr() ? changed : this.save(tenantId, changed.value);
  }

  async save(
    _tenantId: string,
    state: SessionState,
  ): Promise<Result<SessionState, OrderRepositoryError>> {
    this.rows.set(state.session.id, state);
    return ok(state);
  }
}

class FakePublisher implements SessionEventPublisher {
  readonly published: SessionEvent[] = [];
  async sessionChanged(event: SessionEvent): Promise<void> {
    this.published.push(event);
  }
}

function makeDeps() {
  const sessions = new FakeSessionStore();
  const events = new FakePublisher();
  let counter = 0;
  const newId = () => `id-${(counter += 1)}`;
  return { sessions, events, newId, now: () => AT };
}

describe('collaborative table session', () => {
  it('opens a session for the first diner', async () => {
    const deps = makeDeps();
    const result = await joinTable(deps)({
      tenantId: 'itadaki',
      tableId: 'mesa-07',
      nickname: 'Ana',
      currency: 'ARS',
    });

    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.state.session.diners).toHaveLength(1);
    expect(deps.events.published[0]?.reason).toBe('joined');
  });

  it('puts a second diner in the same session, not a new one', async () => {
    const deps = makeDeps();
    const join = joinTable(deps);

    const first = await join({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'Ana', currency: 'ARS' });
    const second = await join({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'Beto', currency: 'ARS' });

    if (first.isErr() || second.isErr()) throw new Error('expected ok');
    expect(second.value.state.session.id).toBe(first.value.state.session.id);
    expect(second.value.state.session.diners).toHaveLength(2);
  });

  it('keeps separate tables separate', async () => {
    const deps = makeDeps();
    const join = joinTable(deps);

    const table7 = await join({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'Ana', currency: 'ARS' });
    const table9 = await join({ tenantId: 'itadaki', tableId: 'mesa-09', nickname: 'Beto', currency: 'ARS' });

    if (table7.isErr() || table9.isErr()) throw new Error('expected ok');
    expect(table9.value.state.session.id).not.toBe(table7.value.state.session.id);
  });

  it('rejects a nickname already at the table', async () => {
    const deps = makeDeps();
    const join = joinTable(deps);

    await join({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'Ana', currency: 'ARS' });
    const clash = await join({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'ana', currency: 'ARS' });

    expect(clash.isErr()).toBe(true);
    if (clash.isErr()) expect(clash.error.kind).toBe('NICKNAME_TAKEN');
  });

  it('shares one cart across both diners', async () => {
    const deps = makeDeps();
    const join = joinTable(deps);
    const add = addToSharedCart(deps);

    const ana = await join({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'Ana', currency: 'ARS' });
    const beto = await join({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'Beto', currency: 'ARS' });
    if (ana.isErr() || beto.isErr()) throw new Error('expected ok');

    const sessionId = ana.value.state.session.id;

    await add({
      tenantId: 'itadaki', sessionId, dinerId: ana.value.dinerId,
      line: { dinerId: ana.value.dinerId, product: snapshot('p1', 10_000), modifiers: [], notes: '' },
      quantity: 2,
    });
    const afterBeto = await add({
      tenantId: 'itadaki', sessionId, dinerId: beto.value.dinerId,
      line: { dinerId: beto.value.dinerId, product: snapshot('p2', 5_000), modifiers: [], notes: '' },
      quantity: 1,
    });

    if (afterBeto.isErr()) throw new Error('expected ok');
    expect(afterBeto.value.cart.lines).toHaveLength(2);

    const groups = groupByDiner(afterBeto.value.session, afterBeto.value.cart);
    expect(groups[0]?.subtotal.amountInMinorUnits).toBe(20_000);
    expect(groups[1]?.subtotal.amountInMinorUnits).toBe(5_000);
  });

  it('publishes an event on every cart change', async () => {
    const deps = makeDeps();
    const ana = await joinTable(deps)({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'Ana', currency: 'ARS' });
    if (ana.isErr()) throw new Error('expected ok');

    await addToSharedCart(deps)({
      tenantId: 'itadaki', sessionId: ana.value.state.session.id, dinerId: ana.value.dinerId,
      line: { dinerId: ana.value.dinerId, product: snapshot('p1', 10_000), modifiers: [], notes: '' },
      quantity: 1,
    });

    expect(deps.events.published.map((event) => event.reason)).toEqual(['joined', 'cart-changed']);
  });

  it('refuses to let a diner change someone else\'s line', async () => {
    const deps = makeDeps();
    const join = joinTable(deps);

    const ana = await join({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'Ana', currency: 'ARS' });
    const beto = await join({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'Beto', currency: 'ARS' });
    if (ana.isErr() || beto.isErr()) throw new Error('expected ok');

    const sessionId = ana.value.state.session.id;
    const added = await addToSharedCart(deps)({
      tenantId: 'itadaki', sessionId, dinerId: ana.value.dinerId,
      line: { dinerId: ana.value.dinerId, product: snapshot('p1', 10_000), modifiers: [], notes: '' },
      quantity: 1,
    });
    if (added.isErr()) throw new Error('expected ok');

    const lineId = added.value.cart.lines[0]?.id;
    if (lineId === undefined) throw new Error('expected a line');

    const result = await changeSharedLine(deps)({
      tenantId: 'itadaki', sessionId, dinerId: beto.value.dinerId, lineId, quantity: 99,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('NOT_YOUR_LINE');
  });

  it('lets the owner change their own line', async () => {
    const deps = makeDeps();
    const ana = await joinTable(deps)({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'Ana', currency: 'ARS' });
    if (ana.isErr()) throw new Error('expected ok');

    const sessionId = ana.value.state.session.id;
    const added = await addToSharedCart(deps)({
      tenantId: 'itadaki', sessionId, dinerId: ana.value.dinerId,
      line: { dinerId: ana.value.dinerId, product: snapshot('p1', 10_000), modifiers: [], notes: '' },
      quantity: 1,
    });
    if (added.isErr()) throw new Error('expected ok');

    const lineId = added.value.cart.lines[0]?.id ?? '';
    const changed = await changeSharedLine(deps)({
      tenantId: 'itadaki', sessionId, dinerId: ana.value.dinerId, lineId, quantity: 4,
    });

    if (changed.isErr()) throw new Error('expected ok');
    expect(changed.value.cart.lines[0]?.quantity).toBe(4);
  });

  it('removes a line when its quantity drops to zero', async () => {
    const deps = makeDeps();
    const ana = await joinTable(deps)({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'Ana', currency: 'ARS' });
    if (ana.isErr()) throw new Error('expected ok');

    const sessionId = ana.value.state.session.id;
    const added = await addToSharedCart(deps)({
      tenantId: 'itadaki', sessionId, dinerId: ana.value.dinerId,
      line: { dinerId: ana.value.dinerId, product: snapshot('p1', 10_000), modifiers: [], notes: '' },
      quantity: 1,
    });
    if (added.isErr()) throw new Error('expected ok');

    const lineId = added.value.cart.lines[0]?.id ?? '';
    const removed = await changeSharedLine(deps)({
      tenantId: 'itadaki', sessionId, dinerId: ana.value.dinerId, lineId, quantity: 0,
    });

    if (removed.isErr()) throw new Error('expected ok');
    expect(removed.value.cart.lines).toHaveLength(0);
  });

  it('keeps the cart intact when a diner leaves', async () => {
    const deps = makeDeps();
    const join = joinTable(deps);

    const ana = await join({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'Ana', currency: 'ARS' });
    const beto = await join({ tenantId: 'itadaki', tableId: 'mesa-07', nickname: 'Beto', currency: 'ARS' });
    if (ana.isErr() || beto.isErr()) throw new Error('expected ok');

    const sessionId = ana.value.state.session.id;
    await addToSharedCart(deps)({
      tenantId: 'itadaki', sessionId, dinerId: beto.value.dinerId,
      line: { dinerId: beto.value.dinerId, product: snapshot('p1', 10_000), modifiers: [], notes: '' },
      quantity: 1,
    });

    const left = await leaveTable(deps)({
      tenantId: 'itadaki', sessionId, dinerId: beto.value.dinerId,
    });

    if (left.isErr()) throw new Error('expected ok');
    expect(left.value.session.diners).toHaveLength(1);
    // The food was still ordered; the line must not vanish with the person.
    expect(left.value.cart.lines).toHaveLength(1);
  });

  it('reports a missing session', async () => {
    const deps = makeDeps();
    const result = await addToSharedCart(deps)({
      tenantId: 'itadaki', sessionId: 'nope', dinerId: 'd1',
      line: { dinerId: 'd1', product: snapshot('p1', 1000), modifiers: [], notes: '' },
      quantity: 1,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('NOT_FOUND');
  });
});
