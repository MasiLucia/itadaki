import { type Cart, type TableSession, joinCodeAccepted } from '@itadaki/ordering/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';
import { type OrderRepositoryError } from './ports';
import {
  type SessionEvent,
  type SessionEventPublisher,
  type SessionReader,
  type SessionState,
  type SessionWriter,
} from './session-ports';
import { joinTable } from './session-use-cases';

/**
 * El QR impreso no vence nunca, así que una foto suya sirve para siempre y
 * desde cualquier lado. El código de mesa es lo que hace que esa foto sola no
 * alcance para sentarse en una mesa que ya está en curso.
 */

const AT = new Date('2026-08-16T21:00:00Z');

const emptyCart: Cart = { currency: 'ARS', lines: [] };

const storeWith = (initial: SessionState | null) => {
  let state = initial;

  const store: SessionReader & SessionWriter = {
    findById: async (_tenantId, id) =>
      state === null ? err({ kind: 'NOT_FOUND', id }) : ok(state),
    findOpenForTable: async () => ok(state),
    listOpen: async () => ok(state === null ? [] : [state]),
    save: async (_tenantId, next) => {
      state = next;
      return ok(next);
    },
    mutate: async (_tenantId, _sessionId, change) => {
      if (state === null) return err({ kind: 'NOT_FOUND', id: 'sin sesión' });
      const changed: Result<SessionState, OrderRepositoryError> = change(state);
      if (changed.isErr()) return changed;
      state = changed.value;
      return ok(state);
    },
  };

  return { store, current: () => state };
};

const publisher = (): SessionEventPublisher => ({
  async sessionChanged(_event: SessionEvent): Promise<void> {
    /* el tablero no importa acá */
  },
});

const seated = (joinCode: string | undefined): SessionState => {
  const session: TableSession = {
    id: 's1',
    tenantId: 't1',
    tableId: 'mesa-01',
    status: 'OPEN',
    currency: 'ARS',
    openedAt: AT,
    diners: [{ id: 'd1', nickname: 'Esteban', colorIndex: 0, joinedAt: AT }],
    ...(joinCode === undefined ? {} : { joinCode }),
  };
  return { session, cart: emptyCart };
};

const joinerFor = (store: SessionReader & SessionWriter) => {
  let counter = 0;
  return joinTable({
    sessions: store,
    events: publisher(),
    newId: () => `id-${(counter += 1)}`,
    now: () => AT,
    newJoinCode: () => '424242',
  });
};

const command = (nickname: string, joinCode?: string) => ({
  tenantId: 't1',
  tableId: 'mesa-01',
  nickname,
  currency: 'ARS' as const,
  ...(joinCode === undefined ? {} : { joinCode }),
});

describe('código de mesa', () => {
  it('el primero abre la mesa sin código: no tiene a quién pedírselo', async () => {
    const { store, current } = storeWith(null);

    const result = await joinerFor(store)(command('Esteban'));

    expect(result.isOk()).toBe(true);
    expect(current()?.session.joinCode).toBe('424242');
  });

  it('rechaza al que llega con el QR pero sin el código', async () => {
    const { store } = storeWith(seated('424242'));

    const result = await joinerFor(store)(command('Intruso'));

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe('WRONG_JOIN_CODE');
  });

  it('rechaza el código equivocado', async () => {
    const { store } = storeWith(seated('424242'));

    const result = await joinerFor(store)(command('Intruso', '424243'));

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe('WRONG_JOIN_CODE');
  });

  it('deja entrar con el código correcto', async () => {
    const { store, current } = storeWith(seated('424242'));

    const result = await joinerFor(store)(command('Lucía', '424242'));

    expect(result.isOk()).toBe(true);
    expect(current()?.session.diners.map((d) => d.nickname)).toEqual(['Esteban', 'Lucía']);
  });

  it('quien vuelve del baño no necesita el código', async () => {
    const { store } = storeWith(seated('424242'));

    // Mismo id que el comensal ya sentado: cerró la pestaña y volvió.
    const result = await joinerFor(store)({ ...command('Esteban'), dinerId: 'd1' });

    expect(result.isOk()).toBe(true);
  });

  it('una mesa vieja, sin código, sigue aceptando gente', async () => {
    const { store } = storeWith(seated(undefined));

    const result = await joinerFor(store)(command('Lucía'));

    expect(result.isOk()).toBe(true);
  });
});

describe('joinCodeAccepted', () => {
  it('no acepta un código más corto que el de la mesa', () => {
    const session = seated('424242').session;
    expect(joinCodeAccepted(session, '4242')).toBe(false);
  });
});
