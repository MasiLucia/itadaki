import { type Result, err, ok } from '@itadaki/shared/domain';
import { type Database } from '@itadaki/shared/persistence';
import { newTableSecret } from './table-token';

export interface RestaurantTable {
  readonly tenantId: string;
  readonly id: string;
  readonly label: string;
  readonly seats: number;
  readonly secret: string;
}

export type TableError =
  | { readonly kind: 'NOT_FOUND'; readonly id: string }
  | { readonly kind: 'STORAGE_FAILURE'; readonly detail: string };

interface TableRow {
  tenant_id: string;
  id: string;
  label: string;
  seats: number;
  qr_secret: string;
}

export class PostgresTableStore {
  constructor(private readonly db: Database) {}

  /**
   * Reads a table by tenant and id.
   *
   * Used while verifying a scanned QR, so it runs unscoped: the tenant claimed
   * by the token is exactly what still has to be proven.
   */
  async find(tenantId: string, tableId: string): Promise<Result<RestaurantTable, TableError>> {
    try {
      const rows = await this.db.unscoped(async (client) => {
        const result = await client.query<TableRow>(
          // Una función y no una tabla: verificar un QR pasa antes de confiar
          // en el restaurante que el token declara — ver la migración 009.
          'SELECT * FROM table_secret_lookup_fn($1, $2)',
          [tenantId, tableId],
        );
        return result.rows;
      });

      const row = rows[0];
      return row === undefined
        ? err({ kind: 'NOT_FOUND', id: tableId })
        : ok({
            tenantId: row.tenant_id,
            id: row.id,
            label: row.label,
            seats: row.seats,
            secret: row.qr_secret,
          });
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  async list(tenantId: string): Promise<Result<readonly RestaurantTable[], TableError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<TableRow>(
          'SELECT * FROM restaurant_tables ORDER BY label',
        );
        return result.rows;
      });

      return ok(
        rows.map((row) => ({
          tenantId: row.tenant_id,
          id: row.id,
          label: row.label,
          seats: row.seats,
          secret: row.qr_secret,
        })),
      );
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  async save(table: Omit<RestaurantTable, 'secret'>): Promise<Result<RestaurantTable, TableError>> {
    try {
      const secret = newTableSecret();
      await this.db.withTenant(table.tenantId, async (client) => {
        await client.query(
          `INSERT INTO restaurant_tables (tenant_id, id, label, seats, qr_secret)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, id) DO UPDATE SET
             label = EXCLUDED.label, seats = EXCLUDED.seats`,
          [table.tenantId, table.id, table.label, table.seats, secret],
        );
      });
      const saved = await this.find(table.tenantId, table.id);
      return saved.isErr() ? err(saved.error) : ok(saved.value);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  /** Rotating the secret invalidates every QR printed for that table. */
  async rotateSecret(tenantId: string, tableId: string): Promise<Result<RestaurantTable, TableError>> {
    try {
      await this.db.withTenant(tenantId, async (client) => {
        await client.query('UPDATE restaurant_tables SET qr_secret = $3 WHERE tenant_id = $1 AND id = $2', [
          tenantId,
          tableId,
          newTableSecret(),
        ]);
      });
      return this.find(tenantId, tableId);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }
}
