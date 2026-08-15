/**
 * Why a diner can no longer use their table, decided from an API response.
 *
 * In the domain rather than the PWA because it is a rule about what the API
 * means, not about how a screen looks — and because rules that live in a
 * component tend to go untested.
 */
export type TableBlock = 'EXPIRED_TOKEN' | 'SESSION_CLOSED';

export interface FailedResponse {
  readonly status: number;
  /** Absent when the body was not JSON, or carried no `kind`. */
  readonly kind?: string | undefined;
  /**
   * Session status, when the body carries one.
   *
   * A settled table still answers 200 — the session is readable, just over —
   * so the block cannot be inferred from the status code alone.
   */
  readonly sessionStatus?: string | undefined;
  /**
   * Whether the request was for the session itself.
   *
   * Plenty of things answer NOT_FOUND without the meal being over: asking for
   * a bill before one is raised is the ordinary case, and treating that as a
   * closed table threw the diner out of their own order.
   */
  readonly aboutSession?: boolean | undefined;
}

/** Null for anything the diner can retry past. */
export function blockFrom(response: FailedResponse): TableBlock | null {
  if (response.kind === 'INVALID_TABLE_TOKEN') return 'EXPIRED_TOKEN';
  if (response.sessionStatus === 'CLOSED') return 'SESSION_CLOSED';

  // Alguien más de la mesa cerró la cuenta mientras esta persona seguía
  // eligiendo: la API rechaza el pedido y este es el aviso de que la comida
  // ya terminó, en vez de un error suelto sobre una pantalla que sigue viva.
  if (response.kind === 'SESSION_CLOSED') return 'SESSION_CLOSED';

  // Only the session's own disappearance ends the meal — never a missing bill,
  // dish, or order.
  if (response.aboutSession === true && response.status === 404) {
    return 'SESSION_CLOSED';
  }
  return null;
}
