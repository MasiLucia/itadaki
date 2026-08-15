import { type Cart, type CartLine, type TableSession } from '@itadaki/ordering/domain';
import { Money, type Result, ok } from '@itadaki/shared/domain';
import { type OrderRepositoryError } from './ports';
import {
  type SessionEvent,
  type SessionEventPublisher,
  type SessionReader,
  type SessionState,
  type SessionWriter,
} from './session-ports';
import { clearSubmittedLines } from './session-use-cases';

/**
 * Antes esto lo hacía el teléfono que enviaba, borrando línea por línea. Sólo
 * podía borrar las propias: las de los demás quedaban en el carrito, la otra
 * persona veía sus platos sin enviar, tocaba enviar, y la cocina recibía la
 * comanda entera duplicada.
 */

const AT = new Date('2026-08-15T20:00:00Z');

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

const session: TableSession = {
  id: 's1',
  tenantId: 't1',
  tableId: 'mesa-01',
  status: 'OPEN',
  currency: 'ARS',
  openedAt: AT,
  diners: [
    { id: 'd1', nickname: 'Esteban', colorIndex: 0, joinedAt: AT },
    { id: 'd2', nickname: 'Lucía', colorIndex: 1, joinedAt: AT },
  ],
};

const line = (id: string, dinerId: string, productId: string): CartLine => ({
  id,
  dinerId,
  product: { productId, name: productId, unitPrice: ars(1000), capturedAt: AT },
  modifiers: [],
  quantity: 1,
  notes: '',
});

const storeWith = (cart: Cart) => {
  let state: SessionState = { session, cart };

  const store: SessionReader & SessionWriter = {
    findById: async () => ok(state),
    findOpenForTable: async () => ok(state),
    save: async (_tenantId, next) => {
      state = next;
      return ok(state);
    },
    mutate: async (_tenantId, _sessionId, change) => {
      const changed: Result<SessionState, OrderRepositoryError> = change(state);
      if (changed.isErr()) return changed;
      state = changed.value;
      return ok(state);
    },
  };

  return { store, current: () => state };
};

const publisherWith = (sink: SessionEvent[]): SessionEventPublisher => ({
  sessionChanged: async (event) => {
    sink.push(event);
  },
});

describe('clearSubmittedLines', () => {
  it('saca las líneas de toda la mesa, no sólo las de quien envió', async () => {
    const mine = line('l1', 'd1', 'gyoza');
    const hers = line('l2', 'd2', 'ramen');
    const { store, current } = storeWith({ currency: 'ARS', lines: [mine, hers] });
    const events: SessionEvent[] = [];

    const run = clearSubmittedLines({ sessions: store, events: publisherWith(events) });
    const result = await run({ tenantId: 't1', sessionId: 's1', lineIds: ['l1', 'l2'] });

    expect(result.isOk()).toBe(true);
    expect(current().cart.lines).toHaveLength(0);
    expect(events).toEqual([{ tenantId: 't1', sessionId: 's1', reason: 'cart-changed' }]);
  });

  it('deja el plato que entró mientras el envío viajaba', async () => {
    const sent = line('l1', 'd1', 'gyoza');
    const late = line('l3', 'd2', 'mochi');
    const { store, current } = storeWith({ currency: 'ARS', lines: [sent, late] });

    const run = clearSubmittedLines({ sessions: store, events: publisherWith([]) });
    await run({ tenantId: 't1', sessionId: 's1', lineIds: ['l1'] });

    expect(current().cart.lines.map((l) => l.id)).toEqual(['l3']);
  });

  it('reenviar el mismo pedido no rompe: las líneas ya no están', async () => {
    const mine = line('l1', 'd1', 'gyoza');
    const { store, current } = storeWith({ currency: 'ARS', lines: [mine] });

    const run = clearSubmittedLines({ sessions: store, events: publisherWith([]) });
    await run({ tenantId: 't1', sessionId: 's1', lineIds: ['l1'] });
    const again = await run({ tenantId: 't1', sessionId: 's1', lineIds: ['l1'] });

    expect(again.isOk()).toBe(true);
    expect(current().cart.lines).toHaveLength(0);
  });
});
