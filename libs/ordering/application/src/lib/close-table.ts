import { closeSession } from '@itadaki/ordering/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';
import { type SessionEventPublisher, type SessionReader, type SessionWriter } from './session-ports';
import { type OrderRepositoryError } from './ports';

export interface CloseTableCommand {
  readonly tenantId: string;
  readonly sessionId: string;
}

/**
 * Frees a table once its bill is paid.
 *
 * Without this a session stays OPEN forever, and `findOpenForTable` hands the
 * next person who scans that QR the previous group's session — their dishes,
 * their names, and a bill already settled. The unique index on
 * `(tenant_id, table_id) WHERE status = 'OPEN'` means closing is also what
 * lets the table be used again.
 */
export function closeTable(deps: {
  sessions: SessionReader & SessionWriter;
  events: SessionEventPublisher;
}) {
  return async (command: CloseTableCommand): Promise<Result<void, OrderRepositoryError>> => {
    const found = await deps.sessions.findById(command.tenantId, command.sessionId);
    if (found.isErr()) {
      return err(found.error);
    }

    // Already closed: nothing to do, and re-closing would be a pointless write.
    if (found.value.session.status === 'CLOSED') {
      return ok(undefined);
    }

    const saved = await deps.sessions.save(command.tenantId, {
      ...found.value,
      session: closeSession(found.value.session),
    });
    if (saved.isErr()) {
      return err(saved.error);
    }

    // Phones still on this table need to know it ended, or they keep showing a
    // cart they can no longer add to.
    await deps.events.sessionChanged({
      tenantId: command.tenantId,
      sessionId: command.sessionId,
      reason: 'closed',
    });
    return ok(undefined);
  };
}
