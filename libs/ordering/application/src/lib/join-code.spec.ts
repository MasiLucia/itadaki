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
 * alcance para sentarse.
 *
 * El código es de la mesa y no de la sesión, y eso es lo que prueban estos
 * casos: atado a la sesión, el primero en escanear entraba sin código —la
 * sesión nacía con él— y desde afuera se podía abrir la mesa una y otra vez,
 * dejando a los comensales reales sin poder sentarse en la suya.
 */

const AT = new Date('2026-08-16T21:00:00Z');
const CODE = '424242';

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

const seated = (): SessionState => {
  const session: TableSession = {
    id: 's1',
    tenantId: 't1',
    tableId: 'mesa-01',
    status: 'OPEN',
    currency: 'ARS',
    openedAt: AT,
    diners: [{ id: 'd1', nickname: 'Esteban', colorIndex: 0, joinedAt: AT }],
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
  });
};

/**
 * `expectedCode` es lo que la mesa tiene puesto; lo pone el mozo, no la app.
 *
 * `null` significa "mesa sin código". No `undefined`: pasarlo explícito activa
 * el valor por defecto del parámetro y el caso terminaba probando lo contrario
 * de lo que dice su nombre.
 */
const command = (nickname: string, joinCode?: string, expectedCode: string | null = CODE) => ({
  tenantId: 't1',
  tableId: 'mesa-01',
  nickname,
  currency: 'ARS' as const,
  ...(joinCode === undefined ? {} : { joinCode }),
  ...(expectedCode === null ? {} : { expectedCode }),
});

describe('código de mesa', () => {
  it('el primero también necesita el código: es el caso que el mozo cubre', async () => {
    const { store, current } = storeWith(null);

    const result = await joinerFor(store)(command('Intruso'));

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe('WRONG_JOIN_CODE');
    // Y no dejó una sesión abierta a medias: la mesa sigue libre.
    expect(current()).toBeNull();
  });

  it('el primero abre la mesa cuando dice el código correcto', async () => {
    const { store, current } = storeWith(null);

    const result = await joinerFor(store)(command('Esteban', CODE));

    expect(result.isOk()).toBe(true);
    expect(current()?.session.diners.map((d) => d.nickname)).toEqual(['Esteban']);
  });

  it('rechaza al que llega con el QR pero sin el código', async () => {
    const { store } = storeWith(seated());

    const result = await joinerFor(store)(command('Intruso'));

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe('WRONG_JOIN_CODE');
  });

  it('rechaza el código equivocado', async () => {
    const { store } = storeWith(seated());

    const result = await joinerFor(store)(command('Intruso', '424243'));

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe('WRONG_JOIN_CODE');
  });

  it('deja entrar con el código correcto', async () => {
    const { store, current } = storeWith(seated());

    const result = await joinerFor(store)(command('Lucía', CODE));

    expect(result.isOk()).toBe(true);
    expect(current()?.session.diners.map((d) => d.nickname)).toEqual(['Esteban', 'Lucía']);
  });

  it('quien vuelve del baño no necesita el código', async () => {
    const { store } = storeWith(seated());

    // Mismo id que el comensal ya sentado: cerró la pestaña y volvió.
    const result = await joinerFor(store)({ ...command('Esteban'), dinerId: 'd1' });

    expect(result.isOk()).toBe(true);
  });

  it('un id ajeno no sirve de atajo para saltear el código', async () => {
    const { store } = storeWith(seated());

    // Nadie con ese id está sentado, así que sigue siendo alguien que llega.
    const result = await joinerFor(store)({ ...command('Intruso'), dinerId: 'inventado' });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe('WRONG_JOIN_CODE');
  });

  it('una mesa sin código puesto sigue aceptando gente', async () => {
    const { store } = storeWith(seated());

    const result = await joinerFor(store)(command('Lucía', undefined, null));

    expect(result.isOk()).toBe(true);
  });
});

describe('joinCodeAccepted', () => {
  it('no acepta un código más corto que el de la mesa', () => {
    expect(joinCodeAccepted(CODE, '4242')).toBe(false);
  });

  it('no acepta uno más largo', () => {
    expect(joinCodeAccepted(CODE, '4242420')).toBe(false);
  });

  it('acepta el exacto', () => {
    expect(joinCodeAccepted(CODE, CODE)).toBe(true);
  });

  it('una mesa sin código no pide ninguno', () => {
    expect(joinCodeAccepted(undefined, undefined)).toBe(true);
    expect(joinCodeAccepted('', '000000')).toBe(true);
  });
});
