/**
 * Qué mesas ve cada mozo.
 *
 * Un salón de veinte mesas le llenaba la pantalla al mozo que atiende seis:
 * los pedidos de todas mezclados, y los suyos había que buscarlos entre los
 * del resto. Con el reparto cargado cada uno ve su sector.
 *
 * La regla está acá y no en la pantalla porque la aplican dos apps distintas
 * —el salón filtra su tablero, la API filtra lo que responde— y dos copias de
 * la misma regla se separan el día que una cambia.
 */

export interface TableAssignment {
  readonly tableId: string;
  readonly staffId: string;
}

/**
 * Sin reparto cargado, todos ven todo.
 *
 * Es el caso de un salón chico, y también el del primer día: nadie configuró
 * nada todavía y esconder las mesas dejaría al mozo con la pantalla vacía sin
 * entender por qué.
 */
export function seesEveryTable(assignments: readonly TableAssignment[]): boolean {
  return assignments.length === 0;
}

/** Las mesas de este mozo, o todas si nadie repartió nada. */
export function tablesFor(
  staffId: string,
  assignments: readonly TableAssignment[],
): { readonly all: boolean; readonly tableIds: ReadonlySet<string> } {
  if (seesEveryTable(assignments)) return { all: true, tableIds: new Set() };

  return {
    all: false,
    tableIds: new Set(
      assignments.filter((a) => a.staffId === staffId).map((a) => a.tableId),
    ),
  };
}

/**
 * Si a este mozo le toca esta mesa.
 *
 * Un mozo sin ninguna mesa asignada, en un salón que sí reparte, ve todas: es
 * el que entra a cubrir un turno y todavía no está en el reparto. Dejarlo con
 * la pantalla vacía sería peor que mostrarle de más — no podría trabajar.
 */
export function canSeeTable(
  staffId: string,
  tableId: string,
  assignments: readonly TableAssignment[],
): boolean {
  const mine = tablesFor(staffId, assignments);
  if (mine.all) return true;
  if (mine.tableIds.size === 0) return true;
  return mine.tableIds.has(tableId);
}

/** El reparto completo, para dibujarlo en el panel del dueño. */
export function assignmentsByStaff(
  assignments: readonly TableAssignment[],
): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const { staffId, tableId } of assignments) {
    const current = grouped.get(staffId);
    if (current === undefined) grouped.set(staffId, [tableId]);
    else current.push(tableId);
  }
  return grouped;
}

/**
 * Las mesas que quedan sin quien las atienda.
 *
 * Dar de baja a un mozo no borra su ficha —se desactiva, para poder
 * reactivarlo— así que sus mesas siguen asignadas a alguien que ya no puede
 * entrar. Nadie las ve en su app y nadie se entera: quedan huérfanas en
 * silencio hasta que un cliente reclama.
 */
export function orphanedTables(
  assignments: readonly TableAssignment[],
  activeStaffIds: readonly string[],
): readonly string[] {
  const activos = new Set(activeStaffIds);
  return assignments.filter((a) => !activos.has(a.staffId)).map((a) => a.tableId);
}
