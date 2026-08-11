import {
  type CategoryReader,
  type CategoryWriter,
  type PriceAuditLog,
  type ProductReader,
  type ProductWriter,
  type RepositoryError,
} from '@itadaki/catalog/application';
import {
  type Category,
  type ImageSet,
  type Product,
  type ProductFilter,
  matchesFilter,
} from '@itadaki/catalog/domain';
import { type Database } from '@itadaki/shared/persistence';
import { Money, type CurrencyCode, type Result, err, ok } from '@itadaki/shared/domain';

interface ProductRow {
  id: string;
  tenant_id: string;
  category_id: string;
  name: string;
  description: string;
  price_minor: string;
  currency: string;
  allergens: string[];
  diets: string[];
  prep_minutes: number;
  available: boolean;
  station: string;
  image_set: ImageSet | null;
}

interface CategoryRow {
  id: string;
  tenant_id: string;
  name: string;
  sort_order: number;
  window_start: number | null;
  window_end: number | null;
}

/** bigint arrives as a string from pg; parsing keeps the integer exact. */
function toMoney(minor: string, currency: string): Money {
  const built = Money.of(Number(minor), currency as CurrencyCode);
  return built.isOk() ? built.value : Money.zero('ARS');
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    price: toMoney(row.price_minor, row.currency),
    images: row.image_set,
    allergens: row.allergens as Product['allergens'],
    diets: row.diets as Product['diets'],
    estimatedPrepMinutes: row.prep_minutes,
    available: row.available,
    station: row.station as Product['station'],
  };
}

export class PostgresProductStore implements ProductReader, ProductWriter {
  constructor(private readonly db: Database) {}

  async findById(tenantId: string, productId: string): Promise<Result<Product, RepositoryError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<ProductRow>(
          `SELECT p.*, i.image_set
             FROM products p
             LEFT JOIN images i ON i.tenant_id = p.tenant_id AND i.id = p.id
            WHERE p.id = $1`,
          [productId],
        );
        return result.rows;
      });

      const row = rows[0];
      return row === undefined ? err({ kind: 'NOT_FOUND', id: productId }) : ok(toProduct(row));
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: String(error) });
    }
  }

  async list(
    tenantId: string,
    filter: ProductFilter,
  ): Promise<Result<readonly Product[], RepositoryError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<ProductRow>(
          `SELECT p.*, i.image_set
             FROM products p
             LEFT JOIN images i ON i.tenant_id = p.tenant_id AND i.id = p.id
            ORDER BY p.name`,
        );
        return result.rows;
      });

      // Filtering stays in the domain so the rule lives in one place.
      return ok(rows.map(toProduct).filter((product) => matchesFilter(product, filter)));
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: String(error) });
    }
  }

  async save(product: Product): Promise<Result<Product, RepositoryError>> {
    try {
      await this.db.withTenant(product.tenantId, async (client) => {
        await client.query(
          `INSERT INTO products (tenant_id, id, category_id, name, description, price_minor,
                                 currency, allergens, diets, prep_minutes, available, station)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (tenant_id, id) DO UPDATE SET
             category_id = EXCLUDED.category_id,
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             price_minor = EXCLUDED.price_minor,
             currency = EXCLUDED.currency,
             allergens = EXCLUDED.allergens,
             diets = EXCLUDED.diets,
             prep_minutes = EXCLUDED.prep_minutes,
             available = EXCLUDED.available,
             station = EXCLUDED.station`,
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
      });
      return ok(product);
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: String(error) });
    }
  }

  async setAvailability(
    tenantId: string,
    productId: string,
    available: boolean,
  ): Promise<Result<Product, RepositoryError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<ProductRow>(
          `UPDATE products SET available = $2 WHERE id = $1 RETURNING *, null::jsonb AS image_set`,
          [productId, available],
        );
        return result.rows;
      });

      const row = rows[0];
      return row === undefined ? err({ kind: 'NOT_FOUND', id: productId }) : ok(toProduct(row));
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: String(error) });
    }
  }
}

export class PostgresCategoryStore implements CategoryReader, CategoryWriter {
  constructor(private readonly db: Database) {}

  async list(tenantId: string): Promise<Result<readonly Category[], RepositoryError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<CategoryRow>(
          'SELECT * FROM categories ORDER BY sort_order',
        );
        return result.rows;
      });

      return ok(
        rows.map((row) => ({
          id: row.id,
          tenantId: row.tenant_id,
          name: row.name,
          sortOrder: row.sort_order,
          availability:
            row.window_start === null || row.window_end === null
              ? null
              : { startMinute: row.window_start, endMinute: row.window_end },
        })),
      );
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: String(error) });
    }
  }

  async save(category: Category): Promise<Result<Category, RepositoryError>> {
    try {
      await this.db.withTenant(category.tenantId, async (client) => {
        await client.query(
          `INSERT INTO categories (tenant_id, id, name, sort_order, window_start, window_end)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (tenant_id, id) DO UPDATE SET
             name = EXCLUDED.name,
             sort_order = EXCLUDED.sort_order,
             window_start = EXCLUDED.window_start,
             window_end = EXCLUDED.window_end`,
          [
            category.tenantId,
            category.id,
            category.name,
            category.sortOrder,
            category.availability?.startMinute ?? null,
            category.availability?.endMinute ?? null,
          ],
        );
      });
      return ok(category);
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: String(error) });
    }
  }

  async reorder(tenantId: string, orderedIds: readonly string[]): Promise<Result<void, RepositoryError>> {
    try {
      await this.db.withTenant(tenantId, async (client) => {
        // Renumber every category in one transaction. Updating only the ids
        // that were sent leaves the rest on stale positions, which shows up as
        // duplicate sort orders and a scrambled carte.
        const all = await client.query<{ id: string }>(
          'SELECT id FROM categories ORDER BY sort_order',
        );

        const requested = orderedIds.filter((id) => all.rows.some((row) => row.id === id));
        const rest = all.rows
          .map((row) => row.id)
          .filter((id) => !requested.includes(id));

        for (const [index, id] of [...requested, ...rest].entries()) {
          await client.query('UPDATE categories SET sort_order = $2 WHERE id = $1', [id, index + 1]);
        }
      });
      return ok(undefined);
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: String(error) });
    }
  }

  async remove(tenantId: string, categoryId: string): Promise<Result<void, RepositoryError>> {
    try {
      return await this.db.withTenant(tenantId, async (client) => {
        const inUse = await client.query<{ total: string }>(
          'SELECT count(*)::text AS total FROM products WHERE category_id = $1',
          [categoryId],
        );

        if (Number(inUse.rows[0]?.total ?? '0') > 0) {
          return err({
            kind: 'CONFLICT',
            detail: 'la categoría todavía tiene platos',
          }) as Result<void, RepositoryError>;
        }

        const deleted = await client.query('DELETE FROM categories WHERE id = $1', [categoryId]);
        return deleted.rowCount === 0
          ? (err({ kind: 'NOT_FOUND', id: categoryId }) as Result<void, RepositoryError>)
          : (ok(undefined) as Result<void, RepositoryError>);
      });
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: String(error) });
    }
  }
}

/** Every price change is recorded: who, when, and the previous value. */
export class PostgresPriceAudit implements PriceAuditLog {
  constructor(private readonly db: Database) {}

  async record(entry: {
    readonly tenantId: string;
    readonly productId: string;
    readonly previousPrice: Money;
    readonly newPrice: Money;
    readonly actorId: string;
    readonly at: Date;
  }): Promise<Result<void, RepositoryError>> {
    try {
      await this.db.withTenant(entry.tenantId, async (client) => {
        await client.query(
          `INSERT INTO price_audit (tenant_id, product_id, previous_minor, new_minor,
                                    currency, actor_id, changed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            entry.tenantId,
            entry.productId,
            entry.previousPrice.amountInMinorUnits,
            entry.newPrice.amountInMinorUnits,
            entry.newPrice.currency,
            entry.actorId,
            entry.at,
          ],
        );
      });
      return ok(undefined);
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: String(error) });
    }
  }
}
