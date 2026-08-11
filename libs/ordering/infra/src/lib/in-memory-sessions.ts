import {
  type SessionReader,
  type SessionState,
  type SessionWriter,
  type OrderRepositoryError,
} from '@itadaki/ordering/application';
import { type Result, err, ok } from '@itadaki/shared/domain';

/** Sessions are keyed per tenant so tables never leak between restaurants. */
export class InMemorySessionStore implements SessionReader, SessionWriter {
  private readonly rows = new Map<string, Map<string, SessionState>>();

  private tenantRows(tenantId: string): Map<string, SessionState> {
    const existing = this.rows.get(tenantId);
    if (existing !== undefined) return existing;
    const created = new Map<string, SessionState>();
    this.rows.set(tenantId, created);
    return created;
  }

  async findById(
    tenantId: string,
    sessionId: string,
  ): Promise<Result<SessionState, OrderRepositoryError>> {
    const found = this.tenantRows(tenantId).get(sessionId);
    return found === undefined ? err({ kind: 'NOT_FOUND', id: sessionId }) : ok(found);
  }

  async findOpenForTable(
    tenantId: string,
    tableId: string,
  ): Promise<Result<SessionState | null, OrderRepositoryError>> {
    const found = [...this.tenantRows(tenantId).values()].find(
      (state) => state.session.tableId === tableId && state.session.status === 'OPEN',
    );
    return ok(found ?? null);
  }

  async mutate(
    tenantId: string,
    sessionId: string,
    change: (state: SessionState) => Result<SessionState, OrderRepositoryError>,
  ): Promise<Result<SessionState, OrderRepositoryError>> {
    // Single-process and single-threaded: awaiting nothing between read and
    // write is already atomic here. The lock only matters against Postgres.
    const found = await this.findById(tenantId, sessionId);
    if (found.isErr()) return found;
    const changed = change(found.value);
    return changed.isErr() ? changed : this.save(tenantId, changed.value);
  }

  async save(
    tenantId: string,
    state: SessionState,
  ): Promise<Result<SessionState, OrderRepositoryError>> {
    this.tenantRows(tenantId).set(state.session.id, state);
    return ok(state);
  }
}
