import { type Result, err, ok } from '@itadaki/shared/domain';
import { type Database } from '@itadaki/shared/persistence';
import { randomInt } from 'node:crypto';
import { newTableSecret } from './table-token';

export interface RestaurantTable {
  readonly tenantId: string;
  readonly id: string;
  readonly label: string;
  readonly seats: number;
  readonly secret: string;

  /**
   * El código que hay que decir para sentarse en esta mesa.
   *
   * Vive en la mesa y no en la sesión a propósito: tiene que existir antes de
   * que nadie escanee. Atado a la sesión, el primero en escanear entraba sin
   * código —la sesión todavía no existía— y con una foto del QR eso se hacía
   * desde cualquier lado, dejando la mesa tomada.
   *
   * Lo sabe el mozo, que lo dice al sentar a la gente, y se renueva cuando la
   * mesa se libera. `null` en una mesa que todavía no tiene uno asignado.
   */
  readonly joinCode: string | null;
}

export type TableError =
  | { readonly kind: 'NOT_FOUND'; readonly id: string }
  /** Tiene gente sentada: el salón cambia de forma cuando está vacío. */
  | { readonly kind: 'TABLE_IN_USE'; readonly id: string }
  | { readonly kind: 'STORAGE_FAILURE'; readonly detail: string };

interface TableRow {
  tenant_id: string;
  id: string;
  label: string;
  seats: number;
  qr_secret: string;
  /** Null en una mesa a la que todavía no se le asignó código. */
  join_code: string | null;
}

/**
 * Un código nuevo para sentarse en la mesa.
 *
 * Seis dígitos: los mismos de cualquier código que llega por SMS, se dictan de
 * memoria y son un millón de combinaciones. Con cuatro, alguien que prueba a
 * ciegas agota el espacio en poco más de una hora, que es lo que dura una
 * sobremesa.
 *
 * `randomInt` y no `Math.random()`: esto decide quién se sienta en una mesa, y
 * el generador de siempre es predecible si se llegan a ver algunos códigos.
 */
export function newJoinCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
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
            joinCode: row.join_code ?? null,
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
          joinCode: row.join_code ?? null,
        })),
      );
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  async save(
    table: Omit<RestaurantTable, 'secret' | 'joinCode'>,
  ): Promise<Result<RestaurantTable, TableError>> {
    try {
      const secret = newTableSecret();
      await this.db.withTenant(table.tenantId, async (client) => {
        await client.query(
          `INSERT INTO restaurant_tables (tenant_id, id, label, seats, qr_secret, join_code)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (tenant_id, id) DO UPDATE SET
             label = EXCLUDED.label, seats = EXCLUDED.seats`,
          [table.tenantId, table.id, table.label, table.seats, secret, newJoinCode()],
        );
      });
      const saved = await this.find(table.tenantId, table.id);
      return saved.isErr() ? err(saved.error) : ok(saved.value);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  /**
   * Saca una mesa del salón.
   *
   * Se niega si tiene gente sentada: borrarla dejaría a esa mesa pidiendo
   * contra algo que ya no existe, y su cuenta sin dónde cobrarse. El salón
   * cambia de forma cuando está vacío, no en medio del servicio.
   *
   * Lo que cuelga de la mesa —su reparto entre mozos— se va por cascada. Las
   * sesiones viejas ya cerradas se conservan: son la historia de ventas, y
   * borrarlas al sacar una mesa falsearía los números de meses anteriores.
   */
  async remove(tenantId: string, tableId: string): Promise<Result<void, TableError>> {
    try {
      const ocupada = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<{ total: string }>(
          `SELECT count(*) AS total FROM table_sessions
            WHERE table_id = $1 AND status = 'OPEN'`,
          [tableId],
        );
        return Number(result.rows[0]?.total ?? 0) > 0;
      });

      if (ocupada) return err({ kind: 'TABLE_IN_USE', id: tableId });

      const borradas = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query('DELETE FROM restaurant_tables WHERE id = $1', [tableId]);
        return result.rowCount ?? 0;
      });

      return borradas === 0 ? err({ kind: 'NOT_FOUND', id: tableId }) : ok(undefined);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  /**
   * Le pone un código nuevo a la mesa.
   *
   * Se llama al liberar la mesa, para que el código de un grupo no le sirva al
   * siguiente ni a quien lo haya anotado, y a mano desde salón cuando el mozo
   * sospecha que se filtró.
   *
   * Una mesa sin código queda con uno igual: sirve para asignárselo a las
   * mesas que existían antes de que esto existiera.
   */
  async rotateJoinCode(tenantId: string, tableId: string): Promise<Result<string, TableError>> {
    try {
      const code = newJoinCode();
      await this.db.withTenant(tenantId, async (client) => {
        await client.query(
          'UPDATE restaurant_tables SET join_code = $3 WHERE tenant_id = $1 AND id = $2',
          [tenantId, tableId, code],
        );
      });
      return ok(code);
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
