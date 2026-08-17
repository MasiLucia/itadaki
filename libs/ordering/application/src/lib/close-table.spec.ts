import { type TableSession } from '@itadaki/ordering/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';
import { closeTable } from './close-table';
import { type OrderRepositoryError } from './ports';
import {
  type CallCloser,
  type SessionEvent,
  type SessionEventPublisher,
  type SessionReader,
  type SessionState,
  type SessionWriter,
} from './session-ports';

const AT = new Date('2026-08-07T20:00:00Z');

const sessionAt = (status: TableSession['status']): SessionState => ({
  session: {
    id: 's1',
    tenantId: 't1',
    tableId: 'mesa-7',
    status,
    currency: 'ARS',
    openedAt: AT,
    diners: [{ id: 'd1', nickname: 'Ana', colorIndex: 0, joinedAt: AT }],
  },
  cart: { currency: 'ARS', lines: [] },
});

class FakeSessions implements SessionReader, SessionWriter {
  saved: SessionState | null = null;
  writes = 0;

  constructor(private state: SessionState | null) {}

  async findById(_tenantId: string, id: string): Promise<Result<SessionState, OrderRepositoryError>> {
    return this.state === null ? err({ kind: 'NOT_FOUND', id }) : ok(this.state);
  }

  async findOpenForTable(): Promise<Result<SessionState | null, OrderRepositoryError>> {
    return ok(this.state?.session.status === 'OPEN' ? this.state : null);
  }

  async listOpen(): Promise<Result<readonly SessionState[], OrderRepositoryError>> {
    return ok(this.state?.session.status === 'OPEN' ? [this.state] : []);
  }

  async mutate(
    tenantId: string,
    sessionId: string,
    change: (state: SessionState) => Result<SessionState, OrderRepositoryError>,
  ): Promise<Result<SessionState, OrderRepositoryError>> {
    const found = await this.findById(tenantId, sessionId);
    if (found.isErr()) return found;
    const changed = change(found.value);
    return changed.isErr() ? changed : this.save(tenantId, changed.value);
  }

  async save(_tenantId: string, state: SessionState): Promise<Result<SessionState, OrderRepositoryError>> {
    this.writes += 1;
    this.saved = state;
    this.state = state;
    return ok(state);
  }
}

class FakeEvents implements SessionEventPublisher {
  readonly published: SessionEvent[] = [];
  async sessionChanged(event: SessionEvent): Promise<void> {
    this.published.push(event);
  }
}

class FakeCalls implements CallCloser {
  readonly closed: string[] = [];
  async closeForSession(_tenantId: string, sessionId: string): Promise<unknown> {
    this.closed.push(sessionId);
    return undefined;
  }
}

describe('closeTable', () => {
  it('closes an open session so the table is free again', async () => {
    const sessions = new FakeSessions(sessionAt('OPEN'));
    const events = new FakeEvents();

    const result = await closeTable({ sessions, events, calls: new FakeCalls() })({ tenantId: 't1', sessionId: 's1' });

    expect(result.isOk()).toBe(true);
    expect(sessions.saved?.session.status).toBe('CLOSED');
  });

  it('frees the table for the next group', async () => {
    const sessions = new FakeSessions(sessionAt('OPEN'));
    await closeTable({ sessions, events: new FakeEvents(), calls: new FakeCalls() })({ tenantId: 't1', sessionId: 's1' });

    // This is the bug it exists to prevent: the next scan must not find the
    // previous group's session waiting for them.
    const open = await sessions.findOpenForTable();
    if (open.isErr()) throw new Error('expected ok');
    expect(open.value).toBeNull();
  });

  it('keeps the diners and cart, only the status changes', async () => {
    const sessions = new FakeSessions(sessionAt('OPEN'));
    await closeTable({ sessions, events: new FakeEvents(), calls: new FakeCalls() })({ tenantId: 't1', sessionId: 's1' });

    // The session is history now, and the bill references it.
    expect(sessions.saved?.session.diners).toHaveLength(1);
    expect(sessions.saved?.session.id).toBe('s1');
  });

  it('tells the phones still on that table', async () => {
    const events = new FakeEvents();
    await closeTable({ sessions: new FakeSessions(sessionAt('OPEN')), events, calls: new FakeCalls() })({
      tenantId: 't1',
      sessionId: 's1',
    });

    expect(events.published).toHaveLength(1);
    expect(events.published[0]?.reason).toBe('closed');
  });

  it('is a no-op on a session already closed', async () => {
    const sessions = new FakeSessions(sessionAt('CLOSED'));
    const events = new FakeEvents();

    const result = await closeTable({ sessions, events, calls: new FakeCalls() })({ tenantId: 't1', sessionId: 's1' });

    expect(result.isOk()).toBe(true);
    expect(sessions.writes).toBe(0);
    expect(events.published).toHaveLength(0);
  });

  /**
   * El timbre quedaba encendido para siempre: la mesa pedía la cuenta, nadie
   * atendía ese llamado, y cualquier teléfono que volviera a entrar lo seguía
   * viendo activo. El salón, igual, con el pedido de gente que ya se fue.
   */
  it('apaga lo que la mesa haya dejado pidiendo', async () => {
    const calls = new FakeCalls();
    await closeTable({ sessions: new FakeSessions(sessionAt('OPEN')), events: new FakeEvents(), calls })({
      tenantId: 't1',
      sessionId: 's1',
    });

    expect(calls.closed).toEqual(['s1']);
  });

  it('no toca los llamados de una mesa que ya estaba cerrada', async () => {
    const calls = new FakeCalls();
    await closeTable({ sessions: new FakeSessions(sessionAt('CLOSED')), events: new FakeEvents(), calls })({
      tenantId: 't1',
      sessionId: 's1',
    });

    expect(calls.closed).toEqual([]);
  });

  it('reports a session that does not exist', async () => {
    const result = await closeTable({
      sessions: new FakeSessions(null),
      events: new FakeEvents(),
      calls: new FakeCalls(),
    })({ tenantId: 't1', sessionId: 'missing' });

    expect(result.isErr()).toBe(true);
  });
});
