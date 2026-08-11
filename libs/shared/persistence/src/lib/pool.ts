import { Pool, type PoolClient } from 'pg';

export interface DatabaseConfig {
  readonly connectionString: string;
  readonly maxConnections?: number;
}

/**
 * Connection pool that scopes every query to a tenant.
 *
 * `app.tenant_id` is set per checked-out connection and the row level
 * security policies compare against it, so a query that forgets its tenant
 * returns nothing instead of another restaurant's rows.
 */
export class Database {
  private readonly pool: Pool;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      // Row locks mean a busy table's writes queue while holding a connection,
      // so the pool has to be wider than the number of diners who might tap at
      // once. A full pool otherwise stalls requests that touch other tables.
      max: config.maxConnections ?? Number(process.env['DB_POOL_MAX'] ?? 25),
      // Fail a stuck checkout instead of hanging the request forever.
      connectionTimeoutMillis: 10_000,
    });
  }

  /**
   * Runs `work` with the tenant set for the duration of a transaction.
   * `set_config(..., true)` is transaction-local, so a pooled connection can
   * never leak one tenant's scope into the next request.
   */
  async withTenant<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Admin-level access for migrations and seeding; bypasses tenant scoping. */
  async unscoped<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await work(client);
    } finally {
      client.release();
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
