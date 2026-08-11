import { Database } from '@itadaki/shared/persistence';

const CONNECTION =
  process.env['DATABASE_URL'] ??
  'postgres://itadaki_app:itadaki_app@localhost:5433/itadaki';

/**
 * Single pool for the process. When Postgres is unreachable the API falls back
 * to the in-memory adapters so the app still runs for a demo — the fallback is
 * announced at boot rather than failing silently.
 */
export const database = new Database({ connectionString: CONNECTION });

export async function databaseAvailable(): Promise<boolean> {
  return database.healthy();
}
