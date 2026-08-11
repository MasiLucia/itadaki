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
  PostgresProductStore,
} from '@itadaki/catalog/infra';
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

  readonly pricer: LinePricer = new CatalogLinePricer(this.products, MODIFIER_GROUPS);
}
