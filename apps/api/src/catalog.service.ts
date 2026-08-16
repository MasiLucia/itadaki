import { Injectable } from '@nestjs/common';
import {
  type CategoryReader,
  type CategoryWriter,
  type ProductReader,
  type ProductWriter,
} from '@itadaki/catalog/application';
import {
  InMemoryCategoryStore,
  InMemoryProductStore,
  MODIFIER_GROUPS,
  PostgresCategoryStore,
  PostgresModifierStore,
  PostgresProductStore,
} from '@itadaki/catalog/infra';
import { type ModifierGroup } from '@itadaki/catalog/domain';
import { type LinePricer } from '@itadaki/ordering/application';
import { CatalogLinePricer } from '@itadaki/ordering/infra';
import { database } from './database';

/**
 * Composition point for the catalog. `USE_POSTGRES` decides which adapter
 * backs the ports; nothing above infra changes either way.
 */
@Injectable()
export class CatalogService {
  private readonly usePostgres = process.env['USE_POSTGRES'] !== 'false';

  readonly products: ProductReader & ProductWriter = this.usePostgres
    ? new PostgresProductStore(database)
    : new InMemoryProductStore();

  private readonly categoryStore = this.usePostgres
    ? new PostgresCategoryStore(database)
    : new InMemoryCategoryStore();

  readonly categories: CategoryReader = this.categoryStore;
  readonly categoryWriter: CategoryWriter = this.categoryStore;

  /**
   * Los grupos de opciones del restaurante.
   *
   * En memoria caen al fixture porque no hay dónde leerlos; contra Postgres
   * salen de la tabla, que es lo que permite que cada restaurante defina sus
   * propios puntos de cocción y guarniciones.
   */
  readonly modifiers = this.usePostgres ? new PostgresModifierStore(database) : null;

  async modifierGroups(tenantId: string): Promise<readonly ModifierGroup[]> {
    if (this.modifiers === null) return MODIFIER_GROUPS;
    const found = await this.modifiers.listForTenant(tenantId);
    return found.isOk() ? found.value : [];
  }

  readonly pricer: LinePricer = new CatalogLinePricer(this.products, (tenantId) =>
    this.modifierGroups(tenantId),
  );
}
