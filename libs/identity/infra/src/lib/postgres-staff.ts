import { type Role, type StaffUser } from '@itadaki/identity/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';
import { type Database } from '@itadaki/shared/persistence';

export type StaffError =
  | { readonly kind: 'NOT_FOUND'; readonly email: string }
  | { readonly kind: 'STORAGE_FAILURE'; readonly detail: string };

interface StaffRow {
  tenant_id: string;
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: string;
  active: boolean;
}

export interface StaffWithHash extends StaffUser {
  readonly passwordHash: string;
}

export class PostgresStaffStore {
  constructor(private readonly db: Database) {}

  /**
   * Looks a user up by email alone.
   *
   * Login happens before any tenant is known, so this reads through a view
   * owned by the privileged role rather than the row-filtered table.
   */
  async findByEmail(email: string): Promise<Result<StaffWithHash, StaffError>> {
    try {
      const rows = await this.db.unscoped(async (client) => {
        const result = await client.query<StaffRow>(
          'SELECT * FROM staff_login_lookup WHERE lower(email) = lower($1) AND active',
          [email],
        );
        return result.rows;
      });

      const row = rows[0];
      if (row === undefined) {
        return err({ kind: 'NOT_FOUND', email });
      }

      return ok({
        id: row.id,
        tenantId: row.tenant_id,
        email: row.email,
        displayName: row.display_name,
        role: row.role as Role,
        active: row.active,
        passwordHash: row.password_hash,
      });
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  async create(user: StaffWithHash): Promise<Result<StaffUser, StaffError>> {
    try {
      await this.db.withTenant(user.tenantId, async (client) => {
        await client.query(
          `INSERT INTO staff_users (tenant_id, id, email, display_name, password_hash, role, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (tenant_id, id) DO UPDATE SET
             display_name = EXCLUDED.display_name,
             password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             active = EXCLUDED.active`,
          [
            user.tenantId,
            user.id,
            user.email,
            user.displayName,
            user.passwordHash,
            user.role,
            user.active,
          ],
        );
      });

      const { passwordHash: _passwordHash, ...safe } = user;
      return ok(safe);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  /**
   * Turns an account's access on or off.
   *
   * Deactivating rather than deleting: orders and bills reference the person
   * who handled them, so removing the row would erase that trail.
   */
  async setActive(
    tenantId: string,
    userId: string,
    active: boolean,
  ): Promise<Result<StaffUser, StaffError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<StaffRow>(
          'UPDATE staff_users SET active = $2 WHERE id = $1 RETURNING *',
          [userId, active],
        );
        return result.rows;
      });

      const row = rows[0];
      if (row === undefined) {
        return err({ kind: 'NOT_FOUND', email: userId });
      }
      return ok({
        id: row.id,
        tenantId: row.tenant_id,
        email: row.email,
        displayName: row.display_name,
        role: row.role as Role,
        active: row.active,
      });
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  async listForTenant(tenantId: string): Promise<Result<readonly StaffUser[], StaffError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<StaffRow>(
          'SELECT * FROM staff_users ORDER BY display_name',
        );
        return result.rows;
      });

      return ok(
        rows.map((row) => ({
          id: row.id,
          tenantId: row.tenant_id,
          email: row.email,
          displayName: row.display_name,
          role: row.role as Role,
          active: row.active,
        })),
      );
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }
}
