import 'reflect-metadata';
import { validateCredentials } from '@itadaki/identity/domain';
import { hashPassword } from '@itadaki/identity/infra';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Creates a staff account.
 *
 * Usage: node create-staff.js <tenantId> <email> <password> [role]
 * Runs as the owner role because it also applies the identity migration.
 */
const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgres://itadaki:itadaki@localhost:5433/itadaki';

async function main(): Promise<void> {
  const [tenantId, email, password, role = 'OWNER'] = process.argv.slice(2);

  if (tenantId === undefined || email === undefined || password === undefined) {
    console.error('uso: create-staff <tenantId> <email> <password> [OWNER|MANAGER|KITCHEN|WAITER]');
    process.exit(1);
  }

  const checked = validateCredentials(email, password);
  if (checked.isErr()) {
    console.error('credenciales inválidas:', checked.error.kind);
    process.exit(1);
  }

  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();

  const migration = await readFile(
    join(process.cwd(), 'libs/shared/persistence/src/lib/migrations/002_tenants_and_staff.sql'),
    'utf-8',
  );
  await client.query(migration);

  await client.query(
    `INSERT INTO tenants (id, name, slug) VALUES ($1,$1,$1) ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );

  const hash = await hashPassword(checked.value.password);
  await client.query(
    `INSERT INTO staff_users (tenant_id, id, email, display_name, password_hash, role)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, id) DO UPDATE SET
       password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, active = true`,
    [
      tenantId,
      checked.value.email.split('@')[0] ?? 'user',
      checked.value.email,
      checked.value.email.split('@')[0] ?? 'staff',
      hash,
      role,
    ],
  );

  console.log(`cuenta creada: ${checked.value.email} (${role}) en ${tenantId}`);
  await client.end();
}

void main().catch((error: unknown) => {
  console.error('falló:', error);
  process.exit(1);
});
