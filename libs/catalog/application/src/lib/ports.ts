import { type Category, type Product, type ProductFilter } from '@itadaki/catalog/domain';
import { type Money, type Result } from '@itadaki/shared/domain';

export type RepositoryError =
  | { readonly kind: 'NOT_FOUND'; readonly id: string }
  | { readonly kind: 'CONFLICT'; readonly detail: string };

/** Read and write sides stay separate: the diner PWA only ever needs the reader. */
export interface ProductReader {
  findById(tenantId: string, productId: string): Promise<Result<Product, RepositoryError>>;
  list(tenantId: string, filter: ProductFilter): Promise<Result<readonly Product[], RepositoryError>>;
}

export interface ProductWriter {
  save(product: Product): Promise<Result<Product, RepositoryError>>;
  setAvailability(
    tenantId: string,
    productId: string,
    available: boolean,
  ): Promise<Result<Product, RepositoryError>>;
}

export interface CategoryReader {
  list(tenantId: string): Promise<Result<readonly Category[], RepositoryError>>;
}

export interface CategoryWriter {
  save(category: Category): Promise<Result<Category, RepositoryError>>;
  reorder(tenantId: string, orderedIds: readonly string[]): Promise<Result<void, RepositoryError>>;
  /** Fails while the category still holds dishes: a delete must not orphan them. */
  remove(tenantId: string, categoryId: string): Promise<Result<void, RepositoryError>>;
}

/** Every price change is auditable: who, when, and the previous value. */
export interface PriceAuditLog {
  record(entry: {
    readonly tenantId: string;
    readonly productId: string;
    readonly previousPrice: Money;
    readonly newPrice: Money;
    readonly actorId: string;
    readonly at: Date;
  }): Promise<Result<void, RepositoryError>>;
}

/** Broadcasts catalog changes so open menus update within a second. */
export interface CatalogEventPublisher {
  productAvailabilityChanged(event: {
    readonly tenantId: string;
    readonly productId: string;
    readonly available: boolean;
  }): Promise<void>;
}
