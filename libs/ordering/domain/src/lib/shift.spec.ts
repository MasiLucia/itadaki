import { SHIFT_IDLE_MS, type Shift, activeShifts, filtersBySector, hiddenFrom, isActive } from './shift';

const AHORA = new Date('2026-08-19T22:00:00Z');
const haceMinutos = (m: number): Date => new Date(AHORA.getTime() - m * 60_000);
const enTurno = (staffId: string, minutosQuieto = 0): Shift => ({
  staffId,
  lastSeen: haceMinutos(minutosQuieto),
});

describe('quién está trabajando ahora', () => {
  it('el que acaba de entrar está en turno', () => {
    expect(isActive(enTurno('ana'), AHORA)).toBe(true);
  });

  it('sigue en turno después de dos horas de servicio', () => {
    // Un mozo puede pasar un rato largo sin tocar el teléfono en una mesa
    // difícil; sacarlo del turno ahí le escondería su propio sector.
    expect(isActive(enTurno('ana', 120), AHORA)).toBe(true);
  });

  it('el que se fue sin salir cae solo', () => {
    // Si no, sus mesas quedan invisibles para todos hasta el día siguiente.
    expect(isActive(enTurno('ana', 60 * 4), AHORA)).toBe(false);
  });

  it('el límite es de tres horas', () => {
    const justoAntes = { staffId: 'ana', lastSeen: new Date(AHORA.getTime() - SHIFT_IDLE_MS + 1000) };
    const justoDespues = { staffId: 'ana', lastSeen: new Date(AHORA.getTime() - SHIFT_IDLE_MS - 1000) };

    expect(isActive(justoAntes, AHORA)).toBe(true);
    expect(isActive(justoDespues, AHORA)).toBe(false);
  });

  it('lista solo a los que siguen', () => {
    const turnos = [enTurno('ana'), enTurno('beto', 60 * 5), enTurno('caro', 30)];
    expect(activeShifts(turnos, AHORA).map((s) => s.staffId)).toEqual(['ana', 'caro']);
  });
});

describe('a quién se le filtra el salón', () => {
  it('al que entró en turno', () => {
    expect(filtersBySector('ana', [enTurno('ana')], AHORA)).toBe(true);
  });

  it('no al que todavía no entró', () => {
    // El encargado mirando desde el panel, o el mozo que abre la app antes de
    // arrancar: ven el salón entero, que es lo que necesitan.
    expect(filtersBySector('ana', [enTurno('beto')], AHORA)).toBe(false);
  });

  it('no al que se olvidó de salir ayer', () => {
    expect(filtersBySector('ana', [enTurno('ana', 60 * 8)], AHORA)).toBe(false);
  });

  it('sin nadie en turno, nadie filtra', () => {
    expect(filtersBySector('ana', [], AHORA)).toBe(false);
  });
});

describe('qué mesa se le esconde a quién', () => {
  const turnos = [enTurno('ana'), enTurno('beto')];

  it('esconde la mesa de un compañero en turno', () => {
    // Es el motivo de todo esto: veinte mesas mezcladas en la pantalla de
    // quien atiende seis.
    expect(hiddenFrom('ana', 'beto', turnos, AHORA)).toBe(true);
  });

  it('nunca esconde las propias', () => {
    expect(hiddenFrom('ana', 'ana', turnos, AHORA)).toBe(false);
  });

  it('no esconde una mesa sin dueño', () => {
    // Nadie la reclamó: esconderla la dejaría sin nadie encima.
    expect(hiddenFrom('ana', null, turnos, AHORA)).toBe(false);
  });

  it('no esconde la mesa de alguien que no entró en turno', () => {
    // Este es el caso que hace innecesario rehacer el reparto: el sector de
    // quien hoy no vino queda a la vista de todos, sin que nadie haga nada.
    expect(hiddenFrom('ana', 'caro', [enTurno('ana')], AHORA)).toBe(false);
  });

  it('no esconde la mesa del que se fue a mitad de turno', () => {
    const conIdo = [enTurno('ana'), enTurno('beto', 60 * 5)];
    expect(hiddenFrom('ana', 'beto', conIdo, AHORA)).toBe(false);
  });

  it('no esconde nada al que no está en turno', () => {
    expect(hiddenFrom('caro', 'beto', turnos, AHORA)).toBe(false);
  });
});
