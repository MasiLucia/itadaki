import {
  type CallReason,
  type CallStatus,
  type PaymentMethod,
  type TableCall,
} from '@itadaki/ordering/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';
import { type Database } from '@itadaki/shared/persistence';

export type CallError =
  | { readonly kind: 'NOT_FOUND'; readonly id: string }
  | { readonly kind: 'STORAGE_FAILURE'; readonly detail: string };

interface CallRow {
  tenant_id: string;
  id: string;
  session_id: string;
  table_id: string;
  reason: string;
  status: string;
  note: string;
  payment_method: string | null;
  raised_at: string;
  acknowledged_at: string | null;
}

const toCall = (row: CallRow): TableCall => ({
  id: row.id,
  tenantId: row.tenant_id,
  sessionId: row.session_id,
  tableId: row.table_id,
  reason: row.reason as CallReason,
  status: row.status as CallStatus,
  note: row.note,
  paymentMethod: (row.payment_method as PaymentMethod | null) ?? null,
  raisedAt: new Date(row.raised_at),
  acknowledgedAt: row.acknowledged_at === null ? null : new Date(row.acknowledged_at),
});

export class PostgresCallStore {
  constructor(private readonly db: Database) {}

  /**
   * Raises a call, or returns the one already waiting.
   *
   * The partial unique index cannot express "one pending per session and
   * reason", so the check runs inside the transaction — an impatient table
   * tapping twice must not put two identical rows on the staff screen.
   */
  async raise(call: TableCall): Promise<Result<TableCall, CallError>> {
    try {
      return await this.db.withTenant(call.tenantId, async (client) => {
        const existing = await client.query<CallRow>(
          `SELECT * FROM table_calls
            WHERE session_id = $1 AND reason = $2 AND status = 'PENDING'
            LIMIT 1`,
          [call.sessionId, call.reason],
        );

        const waiting = existing.rows[0];
        if (waiting !== undefined) {
          return ok(toCall(waiting));
        }

        await client.query(
          `INSERT INTO table_calls
             (tenant_id, id, session_id, table_id, reason, status, note,
              payment_method, raised_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            call.tenantId,
            call.id,
            call.sessionId,
            call.tableId,
            call.reason,
            call.status,
            call.note,
            call.paymentMethod,
            call.raisedAt,
          ],
        );
        return ok(call);
      });
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  /** Everything still waiting, oldest first — that is the order to attend to. */
  async listPending(tenantId: string): Promise<Result<readonly TableCall[], CallError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<CallRow>(
          `SELECT * FROM table_calls WHERE status = 'PENDING' ORDER BY raised_at`,
        );
        return result.rows;
      });
      return ok(rows.map(toCall));
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  /** What one table is waiting on, so the diner app can show its own state. */
  async listForSession(
    tenantId: string,
    sessionId: string,
  ): Promise<Result<readonly TableCall[], CallError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<CallRow>(
          `SELECT * FROM table_calls
            WHERE session_id = $1 AND status = 'PENDING'
            ORDER BY raised_at`,
          [sessionId],
        );
        return result.rows;
      });
      return ok(rows.map(toCall));
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  async acknowledge(
    tenantId: string,
    callId: string,
    at: Date,
  ): Promise<Result<TableCall, CallError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<CallRow>(
          `UPDATE table_calls
              SET status = 'ACKNOWLEDGED', acknowledged_at = $2
            WHERE id = $1 AND status = 'PENDING'
            RETURNING *`,
          [callId, at],
        );
        return result.rows;
      });

      const row = rows[0];
      return row === undefined ? err({ kind: 'NOT_FOUND', id: callId }) : ok(toCall(row));
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  /**
   * Cierra lo que la mesa estaba pidiendo cuando la mesa termina.
   *
   * Un llamado sin atender no se iba nunca: la mesa que pedía la cuenta se
   * quedaba con el timbre encendido en todos sus teléfonos, y el salón seguía
   * viendo el pedido de una mesa que ya se fue. Cobrar y liberar pasan los dos
   * por acá, así que no hay forma de cerrar una mesa y olvidarse de esto.
   */
  async closeForSession(
    tenantId: string,
    sessionId: string,
    at: Date,
  ): Promise<Result<number, CallError>> {
    try {
      const closed = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query(
          `UPDATE table_calls
              SET status = 'ACKNOWLEDGED', acknowledged_at = $2
            WHERE session_id = $1 AND status = 'PENDING'`,
          [sessionId, at],
        );
        return result.rowCount ?? 0;
      });

      return ok(closed);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }
}
