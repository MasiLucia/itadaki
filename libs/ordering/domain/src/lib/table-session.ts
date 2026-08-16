import { type CurrencyCode, type Result, err, ok } from '@itadaki/shared/domain';

/** An anonymous participant. No account, no email — a nickname and a colour. */
export interface Diner {
  readonly id: string;
  readonly nickname: string;
  readonly colorIndex: number;
  readonly joinedAt: Date;
}

export type SessionStatus = 'OPEN' | 'CLOSED';

export interface TableSession {
  readonly id: string;
  readonly tenantId: string;
  readonly tableId: string;
  readonly status: SessionStatus;
  readonly currency: CurrencyCode;
  readonly diners: readonly Diner[];
  readonly openedAt: Date;
}

export type SessionError =
  | { readonly kind: 'SESSION_CLOSED'; readonly sessionId: string }
  | { readonly kind: 'NICKNAME_TAKEN'; readonly nickname: string }
  | { readonly kind: 'INVALID_NICKNAME'; readonly nickname: string }
  | { readonly kind: 'TABLE_FULL'; readonly limit: number }
  | { readonly kind: 'DINER_NOT_FOUND'; readonly dinerId: string };

/**
 * Cuánta gente puede sentarse en una misma sesión.
 *
 * Veinte cubre una mesa larga de cumpleaños, que es un caso real y no un
 * abuso. Sigue siendo un techo y no una comodidad: el QR impreso no vence
 * nunca, así que quien le sacó una foto puede sumarse desde su casa, y este
 * número es lo único que limita cuántos entren por esa foto.
 */
export const MAX_DINERS = 20;

const NICKNAME_PATTERN = /^[\p{L}\p{N} _'-]{1,20}$/u;

export function openSession(params: {
  id: string;
  tenantId: string;
  tableId: string;
  currency: CurrencyCode;
  at: Date;
}): TableSession {
  return {
    id: params.id,
    tenantId: params.tenantId,
    tableId: params.tableId,
    status: 'OPEN',
    currency: params.currency,
    diners: [],
    openedAt: params.at,
  };
}

export function normaliseNickname(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Suma a alguien a la mesa, o lo reconoce si ya estaba.
 *
 * Los apodos son únicos por mesa, sin distinguir mayúsculas: dos "Ana" en la
 * misma mesa harían ilegible el carrito compartido.
 *
 * Pero quien vuelve no es alguien nuevo. Cerrar la pestaña, quedarse sin
 * batería o volver del baño mandaba a la misma persona contra un
 * "ese nombre ya está en la mesa", sin forma de entrar a su propio pedido:
 * el único nombre que quería usar era justamente el que ya estaba ocupado.
 */
export function joinSession(
  session: TableSession,
  params: { id: string; nickname: string; at: Date },
): Result<TableSession, SessionError> {
  if (session.status === 'CLOSED') {
    return err({ kind: 'SESSION_CLOSED', sessionId: session.id });
  }

  const nickname = normaliseNickname(params.nickname);
  if (!NICKNAME_PATTERN.test(nickname)) {
    return err({ kind: 'INVALID_NICKNAME', nickname: params.nickname });
  }

  // Ya está sentada: la mesa queda igual y sigue con su mismo id, así que
  // sus platos y su parte de la cuenta la siguen esperando.
  const yaEsta = session.diners.some((diner) => diner.id === params.id);
  if (yaEsta) {
    return ok(session);
  }

  if (session.diners.length >= MAX_DINERS) {
    return err({ kind: 'TABLE_FULL', limit: MAX_DINERS });
  }

  const taken = session.diners.some(
    (diner) => diner.nickname.toLowerCase() === nickname.toLowerCase(),
  );
  if (taken) {
    return err({ kind: 'NICKNAME_TAKEN', nickname });
  }

  // Colours are handed out in join order and reused once the palette wraps.
  const diner: Diner = {
    id: params.id,
    nickname,
    colorIndex: session.diners.length,
    joinedAt: params.at,
  };

  return ok({ ...session, diners: [...session.diners, diner] });
}

export function leaveSession(
  session: TableSession,
  dinerId: string,
): Result<TableSession, SessionError> {
  if (!session.diners.some((diner) => diner.id === dinerId)) {
    return err({ kind: 'DINER_NOT_FOUND', dinerId });
  }
  return ok({ ...session, diners: session.diners.filter((diner) => diner.id !== dinerId) });
}

export function closeSession(session: TableSession): TableSession {
  return { ...session, status: 'CLOSED' };
}

export function findDiner(session: TableSession, dinerId: string): Diner | null {
  return session.diners.find((diner) => diner.id === dinerId) ?? null;
}

/** Suggests a free nickname so a diner can join with one tap. */
export function suggestNickname(session: TableSession, pool: readonly string[]): string {
  const taken = new Set(session.diners.map((diner) => diner.nickname.toLowerCase()));
  const free = pool.find((candidate) => !taken.has(candidate.toLowerCase()));
  return free ?? `comensal ${session.diners.length + 1}`;
}
