import {
  type TableAssignment,
  assignmentsByStaff,
  canSeeTable,
  orphanedTables,
  seesEveryTable,
  tablesFor,
} from './table-assignment';

const asignar = (tableId: string, staffId: string): TableAssignment => ({ tableId, staffId });

describe('qué mesas ve cada mozo', () => {
  it('sin reparto cargado, ve todas', () => {
    // Salón chico, o el primer día: nadie configuró nada todavía y esconder
    // las mesas dejaría al mozo con la pantalla vacía sin entender por qué.
    expect(seesEveryTable([])).toBe(true);
    expect(canSeeTable('ana', 'mesa-1', [])).toBe(true);
  });

  it('con reparto, ve las suyas', () => {
    const reparto = [asignar('mesa-1', 'ana'), asignar('mesa-2', 'ana'), asignar('mesa-3', 'beto')];

    expect(canSeeTable('ana', 'mesa-1', reparto)).toBe(true);
    expect(canSeeTable('ana', 'mesa-2', reparto)).toBe(true);
  });

  it('no ve las de otro mozo', () => {
    // Es el motivo de todo esto: veinte mesas mezcladas en la pantalla de
    // quien atiende seis.
    const reparto = [asignar('mesa-1', 'ana'), asignar('mesa-3', 'beto')];
    expect(canSeeTable('ana', 'mesa-3', reparto)).toBe(false);
  });

  it('el que no está en el reparto ve todas', () => {
    // El que entra a cubrir un turno y todavía nadie lo repartió. Dejarlo con
    // la pantalla vacía sería peor que mostrarle de más: no podría trabajar.
    const reparto = [asignar('mesa-1', 'ana'), asignar('mesa-2', 'beto')];
    expect(canSeeTable('caro', 'mesa-1', reparto)).toBe(true);
    expect(canSeeTable('caro', 'mesa-2', reparto)).toBe(true);
  });

  it('una mesa sin asignar la ve cualquiera', () => {
    // Nadie la reclamó, así que no es de nadie: peor sería que el cliente
    // espere porque la mesa no figura en la pantalla de ninguno.
    const reparto = [asignar('mesa-1', 'ana')];
    expect(canSeeTable('ana', 'mesa-9', reparto)).toBe(false);
    expect(tablesFor('ana', reparto).tableIds.has('mesa-9')).toBe(false);
  });

  it('devuelve el conjunto de mesas de un mozo', () => {
    const reparto = [asignar('mesa-1', 'ana'), asignar('mesa-2', 'ana'), asignar('mesa-3', 'beto')];
    const mias = tablesFor('ana', reparto);

    expect(mias.all).toBe(false);
    expect([...mias.tableIds].sort()).toEqual(['mesa-1', 'mesa-2']);
  });

  it('marca "todas" cuando no hay reparto', () => {
    const mias = tablesFor('ana', []);
    expect(mias.all).toBe(true);
    expect(mias.tableIds.size).toBe(0);
  });

  it('agrupa el reparto por mozo para mostrarlo', () => {
    const reparto = [asignar('mesa-1', 'ana'), asignar('mesa-3', 'beto'), asignar('mesa-2', 'ana')];
    const porMozo = assignmentsByStaff(reparto);

    expect(porMozo.get('ana')).toEqual(['mesa-1', 'mesa-2']);
    expect(porMozo.get('beto')).toEqual(['mesa-3']);
  });

  it('no inventa mozos que no reparten nada', () => {
    expect(assignmentsByStaff([]).size).toBe(0);
  });
});

describe('mesas que quedan sin mozo', () => {
  it('marca las del mozo dado de baja', () => {
    // Dar de baja no borra la ficha, se desactiva: la mesa sigue asignada a
    // alguien que ya no puede entrar, así que nadie la ve en su app.
    const reparto = [asignar('mesa-1', 'ana'), asignar('mesa-2', 'beto')];
    expect(orphanedTables(reparto, ['ana'])).toEqual(['mesa-2']);
  });

  it('no marca nada si están todos activos', () => {
    const reparto = [asignar('mesa-1', 'ana'), asignar('mesa-2', 'beto')];
    expect(orphanedTables(reparto, ['ana', 'beto'])).toEqual([]);
  });

  it('las lista todas si se fue el único mozo del reparto', () => {
    const reparto = [asignar('mesa-1', 'ana'), asignar('mesa-2', 'ana')];
    expect(orphanedTables(reparto, [])).toEqual(['mesa-1', 'mesa-2']);
  });

  it('sin reparto no hay nada que quede huérfano', () => {
    expect(orphanedTables([], ['ana'])).toEqual([]);
  });
});
