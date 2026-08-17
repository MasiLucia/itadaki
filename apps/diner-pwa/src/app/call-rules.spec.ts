import { type CallReason } from '@itadaki/ordering/domain';

/**
 * Qué se puede pedir con el timbre, y cuándo.
 *
 * Las dos reglas nacen del mismo lugar: el mozo camina. Un llamado que no
 * tiene sentido — la cuenta de una mesa que no consumió, tres avisos juntos
 * que no dicen cuál atender — le cuesta un viaje al salón.
 *
 * Se prueban acá, sobre la decisión sola, porque es la que tiene que valer
 * igual en la hoja, en el paso de la forma de pago y en cualquier camino que
 * se agregue después.
 */

/** Lo mismo que decide el componente, extraído para poder probarlo. */
function blocked(
  reason: CallReason,
  { hasOrdered, waiting }: { hasOrdered: boolean; waiting: ReadonlySet<CallReason> },
): boolean {
  if (reason === 'BILL' && !hasOrdered) return true;
  return waiting.size > 0 && !waiting.has(reason);
}

const nada = new Set<CallReason>();
const esperando = (...reasons: CallReason[]) => new Set(reasons);

describe('pedir la cuenta sin haber pedido nada', () => {
  it('no deja pedir la cuenta si la mesa no consumió', () => {
    // El mozo llegaba con la cuenta de una mesa que recién se sentaba.
    expect(blocked('BILL', { hasOrdered: false, waiting: nada })).toBe(true);
  });

  it('la habilita en cuanto hay algo pedido', () => {
    expect(blocked('BILL', { hasOrdered: true, waiting: nada })).toBe(false);
  });

  it('deja llamar al mozo aunque no hayan pedido nada', () => {
    // Preguntar algo antes de pedir es lo que hace cualquiera que se sienta.
    expect(blocked('WAITER', { hasOrdered: false, waiting: nada })).toBe(false);
    expect(blocked('QUESTION', { hasOrdered: false, waiting: nada })).toBe(false);
  });
});

describe('un llamado a la vez', () => {
  it('bloquea los demás mientras hay uno pedido', () => {
    // Tres avisos juntos de la misma mesa no dicen qué necesita ahora.
    const waiting = esperando('WAITER');

    expect(blocked('BILL', { hasOrdered: true, waiting })).toBe(true);
    expect(blocked('QUESTION', { hasOrdered: true, waiting })).toBe(true);
  });

  it('deja tocar el que ya está pedido, que es cómo se cancela', () => {
    // Si también se bloqueara, quien tocó por error quedaría trabado hasta
    // que llegue el mozo a quien no quería llamar.
    const waiting = esperando('WAITER');
    expect(blocked('WAITER', { hasOrdered: true, waiting })).toBe(false);
  });

  it('libera todo al cancelar', () => {
    expect(blocked('BILL', { hasOrdered: true, waiting: nada })).toBe(false);
    expect(blocked('QUESTION', { hasOrdered: true, waiting: nada })).toBe(false);
  });

  it('la cuenta sigue bloqueada sin consumo aunque no haya otro llamado', () => {
    // Las dos reglas son independientes: destildar no habilita la cuenta.
    expect(blocked('BILL', { hasOrdered: false, waiting: nada })).toBe(true);
  });

  it('con la cuenta pedida no deja llamar al mozo por otra cosa', () => {
    const waiting = esperando('BILL');
    expect(blocked('WAITER', { hasOrdered: true, waiting })).toBe(true);
    expect(blocked('BILL', { hasOrdered: true, waiting })).toBe(false);
  });
});
