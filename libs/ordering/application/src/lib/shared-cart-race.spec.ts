import { type CartLine, type TableSession } from '@itadaki/ordering/domain';
import { Money, type Result, err, ok } from '@itadaki/shared/domain';
import { type OrderRepositoryError } from './ports';
import {
  type SessionEvent,
  type SessionEventPublisher,
  type SessionReader,
  type SessionState,
  type SessionWriter,
} from './session-ports';
import { addToSharedCart } from './session-use-cases';

const AT = new Date('2026-08-08T20:00:00Z');

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

const session: TableSession = {
  id: 's1',
  tenantId: 't1',
  tableId: 'mesa-7',
  status: 'OPEN',
  currency: 'ARS',
  openedAt: AT,
  diners: [
    { id: 'd1', nickname: 'Ana', colorIndex: 0, joinedAt: AT },
    { id: 'd2', nickname: 'Beto', colorIndex: 1, joinedAt: AT },
  ],
};

/**
 * A distinct dish per call. `addLine` merges identical configurations by
 * design — two of the same bife become one line of quantity 2 — so a race
 * test has to order different things for lost writes to be visible at all.
 */
const dish = (dinerId: string, productId: string): Omit<CartLine, 'id' | 'quantity'> => ({
  dinerId,
  notes: '',
  modifiers: [],
  product: { productId, name: productId, unitPrice: ars(800_000), capturedAt: AT },
});

/**
 * Store whose reads and writes interleave the way two phones would.
 *
 * `mutate` is serialised through a promise chain, standing in for the row lock
 * Postgres takes; `save` is left unserialised so the difference is visible.
 */
class InterleavingStore implements SessionReader, SessionWriter {
  private state: SessionState = { session, cart: { currency: 'ARS', lines: [] } };
  private queue: Promise<unknown> = Promise.resolve();

  async findById(): Promise<Result<SessionState, OrderRepositoryError>> {
    return ok(this.state);
  }

  async findOpenForTable(): Promise<Result<SessionState | null, OrderRepositoryError>> {
    return ok(this.state);
  }

  async listOpen(): Promise<Result<readonly SessionState[], OrderRepositoryError>> {
    return ok([this.state]);
  }

  async save(
    _tenantId: string,
    next: SessionState,
  ): Promise<Result<SessionState, OrderRepositoryError>> {
    // A tick between read and write is exactly where the lost update happened.
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.state = next;
    return ok(next);
  }

  async mutate(
    _tenantId: string,
    sessionId: string,
    change: (state: SessionState) => Result<SessionState, OrderRepositoryError>,
  ): Promise<Result<SessionState, OrderRepositoryError>> {
    const run = this.queue.then(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const changed = change(this.state);
      if (changed.isErr()) return err(changed.error);
      this.state = changed.value;
      return ok(changed.value);
    });

    this.queue = run.catch(() => undefined);
    return run as Promise<Result<SessionState, OrderRepositoryError>>;
  }

  get lineCount(): number {
    return this.state.cart.lines.length;
  }
}

class SilentEvents implements SessionEventPublisher {
  async sessionChanged(_event: SessionEvent): Promise<void> {
    // Nothing to assert here; the cart is the subject.
  }
}

describe('the shared cart under concurrent writes', () => {
  it('keeps every dish when a whole table orders at once', async () => {
    const sessions = new InterleavingStore();
    const add = addToSharedCart({
      sessions,
      events: new SilentEvents(),
      newId: () => crypto.randomUUID(),
    });

    // Ten taps landing together is a normal table, not a stress test. Before
    // the row lock this lost seven of them.
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        add({
          tenantId: 't1',
          sessionId: 's1',
          dinerId: index % 2 === 0 ? 'd1' : 'd2',
          line: dish(index % 2 === 0 ? 'd1' : 'd2', `plato-${index}`),
          quantity: 1,
        }),
      ),
    );

    expect(sessions.lineCount).toBe(10);
  });

  it('gives every line its own id', async () => {
    const sessions = new InterleavingStore();
    const add = addToSharedCart({
      sessions,
      events: new SilentEvents(),
      newId: () => crypto.randomUUID(),
    });

    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        add({
          tenantId: 't1',
          sessionId: 's1',
          dinerId: 'd1',
          line: dish('d1', `plato-${index}`),
          quantity: 1,
        }),
      ),
    );

    const found = await sessions.findById();
    if (found.isErr()) throw new Error('expected ok');
    const ids = new Set(found.value.cart.lines.map((line) => line.id));
    expect(ids.size).toBe(6);
  });

  it('attributes each line to the diner who added it', async () => {
    const sessions = new InterleavingStore();
    const add = addToSharedCart({
      sessions,
      events: new SilentEvents(),
      newId: () => crypto.randomUUID(),
    });

    await Promise.all([
      add({ tenantId: 't1', sessionId: 's1', dinerId: 'd1', line: dish('d1', 'bife'), quantity: 1 }),
      add({ tenantId: 't1', sessionId: 's1', dinerId: 'd2', line: dish('d2', 'milanesa'), quantity: 1 }),
    ]);

    const found = await sessions.findById();
    if (found.isErr()) throw new Error('expected ok');
    // Splitting the bill by diner depends on this staying right.
    expect(found.value.cart.lines.map((line) => line.dinerId).sort()).toEqual(['d1', 'd2']);
  });
});
