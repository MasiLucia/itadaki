import { type Shift } from '@itadaki/ordering/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';
import { type Database } from '@itadaki/shared/persistence';

export type ShiftError = { readonly kind: 'STORAGE_FAILURE'; readonly detail: string };

interface Row {
  staff_id: string;
  last_seen: Date;
}

/** Quién está en turno, en Postgres. */
export class PostgresShiftStore {
  constructor(private readonly db: Database) {}

  async list(tenantId: string): Promise<Result<readonly Shift[], ShiftError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<Row>(
          'SELECT staff_id, last_seen FROM staff_shifts ORDER BY started_at',
        );
        return result.rows;
      });
      return ok(rows.map((row) => ({ staffId: row.staff_id, lastSeen: row.last_seen })));
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  /**
   * Entra en turno, o renueva el que ya tiene.
   *
   * Lo mismo sirve para las dos cosas a propósito: cada acción del salón pasa
   * por acá, así que el turno se mantiene vivo sin que el mozo lo toque.
   */
  async enter(tenantId: string, staffId: string): Promise<Result<void, ShiftError>> {
    try {
      await this.db.withTenant(tenantId, async (client) => {
        await client.query(
          `INSERT INTO staff_shifts (tenant_id, staff_id)
           VALUES ($1, $2)
           ON CONFLICT (tenant_id, staff_id) DO UPDATE SET last_seen = now()`,
          [tenantId, staffId],
        );
      });
      return ok(undefined);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  async leave(tenantId: string, staffId: string): Promise<Result<void, ShiftError>> {
    try {
      await this.db.withTenant(tenantId, async (client) => {
        await client.query('DELETE FROM staff_shifts WHERE staff_id = $1', [staffId]);
      });
      return ok(undefined);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }
}
