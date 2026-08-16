import { type ModifierGroup } from '@itadaki/catalog/domain';
import { Money, type Result, err, ok } from '@itadaki/shared/domain';
import { type Database } from '@itadaki/shared/persistence';

export type ModifierStoreError =
  | { readonly kind: 'NOT_FOUND'; readonly id: string }
  | { readonly kind: 'STORAGE_FAILURE'; readonly detail: string };

interface GroupRow {
  id: string;
  tenant_id: string;
  product_id: string;
  name: string;
  min_selections: number;
  max_selections: number;
  modifiers: ReadonlyArray<{
    id: string;
    name: string;
    priceDelta: { amountInMinorUnits: number; currency: string };
    available: boolean;
  }>;
}

const toGroup = (row: GroupRow): ModifierGroup => ({
  id: row.id,
  productId: row.product_id,
  name: row.name,
  minSelections: row.min_selections,
  maxSelections: row.max_selections,
  modifiers: (row.modifiers ?? []).map((modifier) => {
    const price = Money.of(
      modifier.priceDelta.amountInMinorUnits,
      modifier.priceDelta.currency as 'ARS',
    );
    return {
      id: modifier.id,
      name: modifier.name,
      // Un importe inválido guardado no debe tirar abajo la carta entera:
      // el extra vale cero hasta que alguien lo corrija.
      priceDelta: price.isOk() ? price.value : Money.zero('ARS'),
      available: modifier.available,
    };
  }),
});

/**
 * Los grupos de opciones de cada plato, en Postgres.
 *
 * Hasta acá la API servía un archivo fijo del código: el punto de cocción del
 * bife estaba escrito en el repositorio, igual para todos los restaurantes, y
 * nadie podía definir los suyos. La tabla existía desde la primera migración
 * y el seed la llenaba; lo que faltaba era leerla.
 */
export class PostgresModifierStore {
  constructor(private readonly db: Database) {}

  async listForTenant(tenantId: string): Promise<Result<readonly ModifierGroup[], ModifierStoreError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<GroupRow>(
          'SELECT * FROM modifier_groups ORDER BY product_id, name',
        );
        return result.rows;
      });
      return ok(rows.map(toGroup));
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  /** Guarda un grupo entero: los modificadores viajan juntos, como un set. */
  async save(
    tenantId: string,
    group: ModifierGroup,
  ): Promise<Result<ModifierGroup, ModifierStoreError>> {
    try {
      await this.db.withTenant(tenantId, async (client) => {
        await client.query(
          `INSERT INTO modifier_groups
             (tenant_id, id, product_id, name, min_selections, max_selections, modifiers)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (tenant_id, id) DO UPDATE SET
             product_id = EXCLUDED.product_id,
             name = EXCLUDED.name,
             min_selections = EXCLUDED.min_selections,
             max_selections = EXCLUDED.max_selections,
             modifiers = EXCLUDED.modifiers`,
          [
            tenantId,
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
      });
      return ok(group);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  async remove(tenantId: string, groupId: string): Promise<Result<void, ModifierStoreError>> {
    try {
      const borrados = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query('DELETE FROM modifier_groups WHERE id = $1', [groupId]);
        return result.rowCount ?? 0;
      });
      return borrados === 0 ? err({ kind: 'NOT_FOUND', id: groupId }) : ok(undefined);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }
}
