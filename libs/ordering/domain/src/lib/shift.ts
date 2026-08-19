/**
 * Quién está trabajando ahora.
 *
 * El reparto de mesas solo, sin esto, obligaba a que alguien lo rehiciera en
 * cada cambio de turno — y quien sabe qué mozos entraron hoy es el mozo, no
 * el encargado, que puede no estar. Pedirle al admin que cargue eso es
 * pedirle que copie algo que ya sabe otro.
 *
 * Con el turno, el sector guardado es el habitual de cada uno y se carga una
 * vez. Las mesas de quien no entró quedan a la vista de todos, sin que nadie
 * haga nada.
 */

export interface Shift {
  readonly staffId: string;
  /** Última señal de vida: cada acción en el salón la corre hacia adelante. */
  readonly lastSeen: Date;
}

/**
 * Cuánto puede estar quieto alguien antes de darlo por ido.
 *
 * Tres horas: un turno de noche entero sin tocar nada no existe —el mozo
 * marca platos, atiende llamados, cobra— y en cambio el que se fue olvidándose
 * de salir no debe dejar sus mesas invisibles hasta el día siguiente.
 */
export const SHIFT_IDLE_MS = 3 * 60 * 60 * 1000;

/** Si este turno sigue vigente, o quedó abierto de alguien que ya se fue. */
export function isActive(shift: Shift, now: Date): boolean {
  return now.getTime() - shift.lastSeen.getTime() < SHIFT_IDLE_MS;
}

/** Los que están trabajando ahora, descartando los turnos olvidados. */
export function activeShifts(shifts: readonly Shift[], now: Date): readonly Shift[] {
  return shifts.filter((shift) => isActive(shift, now));
}

/**
 * Si a este mozo le toca esconder las mesas de los demás.
 *
 * Solo cuando él mismo está en turno: quien no entró ve el salón entero, que
 * es lo que necesita el encargado mirando desde el panel, o el mozo que abre
 * la app antes de arrancar.
 */
export function filtersBySector(
  staffId: string,
  shifts: readonly Shift[],
  now: Date,
): boolean {
  return activeShifts(shifts, now).some((shift) => shift.staffId === staffId);
}

/**
 * Si esta mesa se le esconde a este mozo.
 *
 * Se esconde solo si es de un compañero **que está en turno**. La mesa de
 * alguien que todavía no entró —o que ya se fue— la ve todo el mundo: nadie
 * la está atendiendo, así que esconderla la dejaría sin nadie encima.
 */
export function hiddenFrom(
  staffId: string,
  tableOwnerId: string | null,
  shifts: readonly Shift[],
  now: Date,
): boolean {
  if (tableOwnerId === null) return false;
  if (tableOwnerId === staffId) return false;
  if (!filtersBySector(staffId, shifts, now)) return false;

  return activeShifts(shifts, now).some((shift) => shift.staffId === tableOwnerId);
}
