import {
  type Cart,
  type CartLine,
  addLine,
  canModify,
  emptyCart,
  joinSession,
  leaveSession,
  openSession,
  removeLine,
  setQuantity,
} from '@itadaki/ordering/domain';
import { type CurrencyCode, type Result, err, ok } from '@itadaki/shared/domain';
import { type OrderRepositoryError } from './ports';
import {
  type SessionEventPublisher,
  type SessionReader,
  type SessionState,
  type SessionWriter,
} from './session-ports';

export type SessionFailure =
  | OrderRepositoryError
  | { readonly kind: 'SESSION_CLOSED'; readonly sessionId: string }
  | { readonly kind: 'NICKNAME_TAKEN'; readonly nickname: string }
  | { readonly kind: 'INVALID_NICKNAME'; readonly nickname: string }
  | { readonly kind: 'TABLE_FULL'; readonly limit: number }
  | { readonly kind: 'DINER_NOT_FOUND'; readonly dinerId: string }
  | { readonly kind: 'NOT_YOUR_LINE'; readonly lineId: string };

export interface JoinTableCommand {
  readonly tenantId: string;
  readonly tableId: string;
  readonly nickname: string;
  readonly currency: CurrencyCode;
}

export interface JoinResult {
  readonly state: SessionState;
  readonly dinerId: string;
}

/**
 * Joins a table, opening the session if this is the first diner.
 *
 * One session per table at a time: a second phone scanning the same QR must
 * land in the same cart, not start a parallel one.
 */
export function joinTable(deps: {
  sessions: SessionReader & SessionWriter;
  events: SessionEventPublisher;
  newId: () => string;
  now: () => Date;
}) {
  return async (command: JoinTableCommand): Promise<Result<JoinResult, SessionFailure>> => {
    const existing = await deps.sessions.findOpenForTable(command.tenantId, command.tableId);
    if (existing.isErr()) {
      return err(existing.error);
    }

    const state: SessionState =
      existing.value ??
      {
        session: openSession({
          id: deps.newId(),
          tenantId: command.tenantId,
          tableId: command.tableId,
          currency: command.currency,
          at: deps.now(),
        }),
        cart: emptyCart(command.currency),
      };

    const dinerId = deps.newId();
    const joined = joinSession(state.session, {
      id: dinerId,
      nickname: command.nickname,
      at: deps.now(),
    });
    if (joined.isErr()) {
      return err(joined.error);
    }

    const saved = await deps.sessions.save(command.tenantId, {
      session: joined.value,
      cart: state.cart,
    });
    if (saved.isErr()) {
      return err(saved.error);
    }

    await deps.events.sessionChanged({
      tenantId: command.tenantId,
      sessionId: joined.value.id,
      reason: 'joined',
    });

    return ok({ state: saved.value, dinerId });
  };
}

export interface AddToSharedCartCommand {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly dinerId: string;
  readonly line: Omit<CartLine, 'id' | 'quantity'>;
  readonly quantity: number;
}

export function addToSharedCart(deps: {
  sessions: SessionReader & SessionWriter;
  events: SessionEventPublisher;
  newId: () => string;
}) {
  return async (command: AddToSharedCartCommand): Promise<Result<SessionState, SessionFailure>> => {
    // Runs inside the store's lock: reading the cart and writing it back has to
    // be one step, or a second phone adding at the same moment overwrites this.
    const saved = await deps.sessions.mutate(command.tenantId, command.sessionId, (state) => {
      if (state.session.status === 'CLOSED') {
        return err({ kind: 'NOT_FOUND', id: command.sessionId });
      }
      const cart = addLine(state.cart, command.line, command.quantity, deps.newId());
      return ok({ ...state, cart });
    });

    if (saved.isErr()) {
      return err(saved.error);
    }

    await deps.events.sessionChanged({
      tenantId: command.tenantId,
      sessionId: command.sessionId,
      reason: 'cart-changed',
    });
    return ok(saved.value);
  };
}

export interface ChangeLineCommand {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly dinerId: string;
  readonly lineId: string;
  readonly quantity: number;
}

/** Only the diner who added a line may change it. */
export function changeSharedLine(deps: {
  sessions: SessionReader & SessionWriter;
  events: SessionEventPublisher;
}) {
  return async (command: ChangeLineCommand): Promise<Result<SessionState, SessionFailure>> => {
    let refused: SessionFailure | null = null;

    const saved = await deps.sessions.mutate(command.tenantId, command.sessionId, (state) => {
      const line = state.cart.lines.find((candidate) => candidate.id === command.lineId);
      if (line === undefined) {
        return err({ kind: 'NOT_FOUND', id: command.lineId });
      }
      if (!canModify(line, command.dinerId)) {
        // Carried out separately: the store's error type has no room for it.
        refused = { kind: 'NOT_YOUR_LINE', lineId: command.lineId };
        return err({ kind: 'NOT_FOUND', id: command.lineId });
      }

      const cart: Cart =
        command.quantity <= 0
          ? removeLine(state.cart, command.lineId)
          : setQuantity(state.cart, command.lineId, command.quantity);
      return ok({ ...state, cart });
    });

    if (refused !== null) {
      return err(refused);
    }
    if (saved.isErr()) {
      return err(saved.error);
    }

    await deps.events.sessionChanged({
      tenantId: command.tenantId,
      sessionId: command.sessionId,
      reason: 'cart-changed',
    });
    return ok(saved.value);
  };
}

export interface LeaveTableCommand {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly dinerId: string;
}

export function leaveTable(deps: {
  sessions: SessionReader & SessionWriter;
  events: SessionEventPublisher;
}) {
  return async (command: LeaveTableCommand): Promise<Result<SessionState, SessionFailure>> => {
    let refused: SessionFailure | null = null;

    const saved = await deps.sessions.mutate(command.tenantId, command.sessionId, (state) => {
      const left = leaveSession(state.session, command.dinerId);
      if (left.isErr()) {
        refused = left.error;
        return err({ kind: 'NOT_FOUND', id: command.sessionId });
      }
      return ok({ ...state, session: left.value });
    });

    if (refused !== null) {
      return err(refused);
    }
    if (saved.isErr()) {
      return err(saved.error);
    }

    await deps.events.sessionChanged({
      tenantId: command.tenantId,
      sessionId: command.sessionId,
      reason: 'left',
    });
    return ok(saved.value);
  };
}
