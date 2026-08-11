import 'reflect-metadata';
import { CATEGORIES, MODIFIER_GROUPS, PRODUCTS, TENANT_ID } from '@itadaki/catalog/infra';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Applies the schema and loads the sample menu.
 *
 * Runs as the owner role because migrations need DDL; the API itself connects
 * as the unprivileged app role so row level security applies to it.
 */
const ADMIN_URL = process.env['DATABASE_ADMIN_URL'] ?? 'postgres://itadaki:itadaki@localhost:5433/itadaki';

async function main(): Promise<void> {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();

  // Read from source rather than the build output: tsc does not copy .sql,
  // and the migration is data the repo owns, not a build artefact.
  // Every file runs, in name order — a new migration must not need this edited.
  const dir = join(process.cwd(), 'libs/shared/persistence/src/lib/migrations');
  const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();

  for (const file of files) {
    await client.query(await readFile(join(dir, file), 'utf-8'));
    console.log(`  ${file}`);
  }
  console.log('schema applied');

  await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', TENANT_ID]);

  // The fixture is the whole demo catalog, not an addition to it: upserting
  // alone would leave dishes from an earlier fixture sitting in the menu.
  // Scoped to the demo tenant, and to catalog tables only — orders and
  // sessions are left alone.
  await client.query('DELETE FROM modifier_groups WHERE tenant_id = $1', [TENANT_ID]);
  await client.query('DELETE FROM products WHERE tenant_id = $1', [TENANT_ID]);
  await client.query('DELETE FROM categories WHERE tenant_id = $1', [TENANT_ID]);

  for (const category of CATEGORIES) {
    await client.query(
      `INSERT INTO categories (tenant_id, id, name, sort_order, window_start, window_end)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order`,
      [
        category.tenantId,
        category.id,
        category.name,
        category.sortOrder,
        category.availability?.startMinute ?? null,
        category.availability?.endMinute ?? null,
      ],
    );
  }

  for (const product of PRODUCTS) {
    await client.query(
      `INSERT INTO products (tenant_id, id, category_id, name, description, price_minor,
                             currency, allergens, diets, prep_minutes, available, station)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         price_minor = EXCLUDED.price_minor,
         available = EXCLUDED.available`,
      [
        product.tenantId,
        product.id,
        product.categoryId,
        product.name,
        product.description,
        product.price.amountInMinorUnits,
        product.price.currency,
        product.allergens,
        product.diets,
        product.estimatedPrepMinutes,
        product.available,
        product.station,
      ],
    );
  }

  for (const group of MODIFIER_GROUPS) {
    await client.query(
      `INSERT INTO modifier_groups (tenant_id, id, product_id, name, min_selections, max_selections, modifiers)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, id) DO UPDATE SET modifiers = EXCLUDED.modifiers`,
      [
        TENANT_ID,
        group.id,
        group.productId,
        group.name,
        group.minSelections,
        group.maxSelections,
        JSON.stringify(
          group.modifiers.map((modifier) => ({
            id: modifier.id,
            name: modifier.name,
            priceDelta: {
              amountInMinorUnits: modifier.priceDelta.amountInMinorUnits,
              currency: modifier.priceDelta.currency,
            },
            available: modifier.available,
          })),
        ),
      ],
    );
  }

  const counts = await client.query<{ table_name: string; total: string }>(
    `SELECT 'categories' AS table_name, count(*)::text AS total FROM categories
     UNION ALL SELECT 'products', count(*)::text FROM products
     UNION ALL SELECT 'modifier_groups', count(*)::text FROM modifier_groups`,
  );
  for (const row of counts.rows) {
    console.log(`  ${row.table_name}: ${row.total}`);
  }

  await client.end();
  console.log('seed complete');
}

void main().catch((error: unknown) => {
  console.error('seed failed', error);
  process.exit(1);
});
