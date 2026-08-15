import { Money } from '@itadaki/shared/domain';
import { addLine, emptyCart } from './cart';
import { type ProductSnapshot } from './order-item';
import { canModify, groupByDiner, orphanedLines } from './shared-cart';
import {
  MAX_DINERS,
  closeSession,
  findDiner,
  joinSession,
  leaveSession,
  normaliseNickname,
  openSession,
  suggestNickname,
  type TableSession,
} from './table-session';

const AT = new Date('2026-01-01T20:00:00Z');

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

const session = (): TableSession =>
  openSession({ id: 's1', tenantId: 'itadaki', tableId: 'mesa-07', currency: 'ARS', at: AT });

const join = (base: TableSession, id: string, nickname: string): TableSession => {
  const result = joinSession(base, { id, nickname, at: AT });
  if (result.isErr()) throw new Error(`join failed: ${result.error.kind}`);
  return result.value;
};

describe('table session', () => {
  it('opens empty and open', () => {
    const table = session();
    expect(table.status).toBe('OPEN');
    expect(table.diners).toHaveLength(0);
  });

  it('admits a diner with a nickname and a colour', () => {
    const table = join(session(), 'd1', 'Ana');
    expect(table.diners).toHaveLength(1);
    expect(table.diners[0]?.nickname).toBe('Ana');
    expect(table.diners[0]?.colorIndex).toBe(0);
  });

  it('hands out a distinct colour per diner in join order', () => {
    let table = join(session(), 'd1', 'Ana');
    table = join(table, 'd2', 'Beto');
    table = join(table, 'd3', 'Cami');

    expect(table.diners.map((diner) => diner.colorIndex)).toEqual([0, 1, 2]);
  });

  it('rejects a duplicate nickname regardless of case', () => {
    const table = join(session(), 'd1', 'Ana');
    const result = joinSession(table, { id: 'd2', nickname: 'ANA', at: AT });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('NICKNAME_TAKEN');
  });

  it('rejects a duplicate that differs only in spacing', () => {
    const table = join(session(), 'd1', 'Ana Maria');
    const result = joinSession(table, { id: 'd2', nickname: '  Ana   Maria  ', at: AT });

    expect(result.isErr()).toBe(true);
  });

  it('normalises surrounding and repeated whitespace', () => {
    expect(normaliseNickname('  Ana   Maria ')).toBe('Ana Maria');
  });

  it('accepts accents and ñ', () => {
    const table = join(session(), 'd1', 'Iñaki');
    expect(table.diners[0]?.nickname).toBe('Iñaki');
  });

  it('rejects an empty nickname', () => {
    const result = joinSession(session(), { id: 'd1', nickname: '   ', at: AT });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('INVALID_NICKNAME');
  });

  it('rejects a nickname over twenty characters', () => {
    const result = joinSession(session(), { id: 'd1', nickname: 'a'.repeat(21), at: AT });
    expect(result.isErr()).toBe(true);
  });

  it('rejects markup in a nickname', () => {
    const result = joinSession(session(), { id: 'd1', nickname: '<script>x</script>', at: AT });
    expect(result.isErr()).toBe(true);
  });

  it('caps the table', () => {
    let table = session();
    for (let index = 0; index < MAX_DINERS; index += 1) {
      table = join(table, `d${index}`, `comensal ${index}`);
    }

    const result = joinSession(table, { id: 'extra', nickname: 'tarde', at: AT });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('TABLE_FULL');
  });

  it('refuses joins once the session is closed', () => {
    const closed = closeSession(join(session(), 'd1', 'Ana'));
    const result = joinSession(closed, { id: 'd2', nickname: 'Beto', at: AT });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('SESSION_CLOSED');
  });

  it('removes a diner on leave', () => {
    const table = join(join(session(), 'd1', 'Ana'), 'd2', 'Beto');
    const result = leaveSession(table, 'd1');

    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.diners.map((diner) => diner.id)).toEqual(['d2']);
  });

  it('reports an unknown diner on leave', () => {
    const result = leaveSession(session(), 'nope');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('DINER_NOT_FOUND');
  });

  it('does not mutate the session it was given', () => {
    const original = session();
    join(original, 'd1', 'Ana');
    expect(original.diners).toHaveLength(0);
  });

  it('finds a diner by id', () => {
    const table = join(session(), 'd1', 'Ana');
    expect(findDiner(table, 'd1')?.nickname).toBe('Ana');
    expect(findDiner(table, 'nope')).toBeNull();
  });

  it('suggests a nickname that is still free', () => {
    const table = join(session(), 'd1', 'Ana');
    expect(suggestNickname(table, ['Ana', 'Beto'])).toBe('Beto');
  });

  it('falls back to a numbered nickname when the pool is exhausted', () => {
    const table = join(session(), 'd1', 'Ana');
    expect(suggestNickname(table, ['Ana'])).toBe('comensal 2');
  });
});

describe('shared cart', () => {
  const product = (id: string, price: number): ProductSnapshot => ({
    productId: id,
    name: `plato ${id}`,
    unitPrice: ars(price),
    capturedAt: AT,
  });

  const line = (dinerId: string, id: string, price: number) => ({
    dinerId,
    product: product(id, price),
    modifiers: [],
    notes: '',
  });

  it('groups lines by who added them', () => {
    const table = join(join(session(), 'd1', 'Ana'), 'd2', 'Beto');

    let cart = emptyCart('ARS');
    cart = addLine(cart, line('d1', 'p1', 10_000), 2, 'l1');
    cart = addLine(cart, line('d2', 'p2', 5_000), 1, 'l2');

    const groups = groupByDiner(table, cart);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.diner.nickname).toBe('Ana');
    expect(groups[0]?.subtotal.amountInMinorUnits).toBe(20_000);
    expect(groups[1]?.subtotal.amountInMinorUnits).toBe(5_000);
  });

  it('shows a zero subtotal for a diner who has not ordered', () => {
    const table = join(join(session(), 'd1', 'Ana'), 'd2', 'Beto');
    const cart = addLine(emptyCart('ARS'), line('d1', 'p1', 10_000), 1, 'l1');

    const groups = groupByDiner(table, cart);
    expect(groups[1]?.lines).toHaveLength(0);
    expect(groups[1]?.subtotal.isZero()).toBe(true);
  });

  it('subtotals across the table sum to the cart total', () => {
    const table = join(join(session(), 'd1', 'Ana'), 'd2', 'Beto');

    let cart = emptyCart('ARS');
    cart = addLine(cart, line('d1', 'p1', 8_200), 2, 'l1');
    cart = addLine(cart, line('d2', 'p2', 3_400), 3, 'l2');

    const groups = groupByDiner(table, cart);
    const summed = groups.reduce((total, group) => total + group.subtotal.amountInMinorUnits, 0);
    expect(summed).toBe(8_200 * 2 + 3_400 * 3);
  });

  it('surfaces lines left behind by a diner who left', () => {
    let table = join(join(session(), 'd1', 'Ana'), 'd2', 'Beto');
    const cart = addLine(emptyCart('ARS'), line('d2', 'p1', 10_000), 1, 'l1');

    const afterLeave = leaveSession(table, 'd2');
    if (afterLeave.isErr()) throw new Error('expected ok');
    table = afterLeave.value;

    expect(orphanedLines(table, cart)).toHaveLength(1);
  });

  it('lets only the owner modify a line', () => {
    const cart = addLine(emptyCart('ARS'), line('d1', 'p1', 10_000), 1, 'l1');
    const first = cart.lines[0];
    if (first === undefined) throw new Error('expected a line');

    expect(canModify(first, 'd1')).toBe(true);
    expect(canModify(first, 'd2')).toBe(false);
  });
});

describe('alguien que vuelve a su propia mesa', () => {
  const mesa = () => {
    const abierta = openSession({
      id: 's1', tenantId: 't1', tableId: 'mesa-1', currency: 'ARS', at: AT,
    });
    const con = joinSession(abierta, { id: 'd1', nickname: 'Cami', at: AT });
    if (con.isErr()) throw new Error('no pudo entrar');
    return con.value;
  };

  it('la reconoce en vez de pedirle otro nombre', () => {
    // Cerrar la pestaña o quedarse sin batería la mandaba contra "ese nombre
    // ya está en la mesa", sin forma de volver a su propio pedido.
    const vuelve = joinSession(mesa(), { id: 'd1', nickname: 'Cami', at: AT });

    expect(vuelve.isOk()).toBe(true);
    expect(vuelve.isOk() && vuelve.value.diners).toHaveLength(1);
  });

  it('la deja volver aunque escriba el nombre distinto', () => {
    // Es la misma persona: lo que la identifica es su id, no cómo lo tipeó.
    const vuelve = joinSession(mesa(), { id: 'd1', nickname: 'cami', at: AT });
    expect(vuelve.isOk()).toBe(true);
  });

  it('no la duplica en la mesa', () => {
    const vuelve = joinSession(mesa(), { id: 'd1', nickname: 'Cami', at: AT });
    const ids = vuelve.isOk() ? vuelve.value.diners.map((d) => d.id) : [];
    expect(ids).toEqual(['d1']);
  });

  it('sigue rechazando a alguien distinto con el mismo nombre', () => {
    // Dos "Cami" en la misma mesa harían ilegible el carrito compartido.
    const otra = joinSession(mesa(), { id: 'd2', nickname: 'Cami', at: AT });

    expect(otra.isErr()).toBe(true);
    expect(otra.isErr() && otra.error.kind).toBe('NICKNAME_TAKEN');
  });

  it('no deja entrar a una mesa cerrada por más que ya haya estado', () => {
    const cerrada = closeSession(mesa());
    const vuelve = joinSession(cerrada, { id: 'd1', nickname: 'Cami', at: AT });

    expect(vuelve.isErr() && vuelve.error.kind).toBe('SESSION_CLOSED');
  });
});
