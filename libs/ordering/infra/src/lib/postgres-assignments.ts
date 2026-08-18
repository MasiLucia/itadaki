import { type TableAssignment } from '@itadaki/ordering/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';
import { type Database } from '@itadaki/shared/persistence';

export type AssignmentError = { readonly kind: 'STORAGE_FAILURE'; readonly detail: string };

interface Row {
  table_id: string;
  staff_id: string;
}

/** Qué mozo atiende qué mesa, en Postgres. */
export class PostgresAssignmentStore {
  constructor(private readonly db: Database) {}

  async list(tenantId: string): Promise<Result<readonly TableAssignment[], AssignmentError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<Row>(
          'SELECT table_id, staff_id FROM table_assignments ORDER BY table_id',
        );
        return result.rows;
      });
      return ok(rows.map((row) => ({ tableId: row.table_id, staffId: row.staff_id })));
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  /**
   * Pone o cambia el mozo de una mesa.
   *
   * Reasignar no es un caso raro: alguien se va antes, entra otro a cubrir, y
   * el encargado corrige el reparto en el momento.
   */
  async assign(
    tenantId: string,
    tableId: string,
    staffId: string,
  ): Promise<Result<void, AssignmentError>> {
    try {
      await this.db.withTenant(tenantId, async (client) => {
        await client.query(
          `INSERT INTO table_assignments (tenant_id, table_id, staff_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, table_id) DO UPDATE
             SET staff_id = EXCLUDED.staff_id, assigned_at = now()`,
          [tenantId, tableId, staffId],
        );
      });
      return ok(undefined);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  /** Deja la mesa sin dueño: la vuelve a ver todo el salón. */
  async clear(tenantId: string, tableId: string): Promise<Result<void, AssignmentError>> {
    try {
      await this.db.withTenant(tenantId, async (client) => {
        await client.query('DELETE FROM table_assignments WHERE table_id = $1', [tableId]);
      });
      return ok(undefined);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }
}
