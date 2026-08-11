import {
  type CategoryReader,
  type CategoryWriter,
  type ProductReader,
  type ProductWriter,
  type RepositoryError,
} from '@itadaki/catalog/application';
import { type Category, type Product, type ProductFilter, matchesFilter } from '@itadaki/catalog/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';
import { CATEGORIES, PRODUCTS } from './menu-fixture';

/**
 * Serves the catalog from memory so the diner PWA runs before the API exists.
 * Swapping in the Postgres adapter means changing the provider, not the screens.
 */
export class InMemoryProductStore implements ProductReader, ProductWriter {
  private products: Product[];

  constructor(products: readonly Product[] = PRODUCTS) {
    this.products = [...products];
  }

  async findById(tenantId: string, productId: string): Promise<Result<Product, RepositoryError>> {
    const found = this.products.find(
      (product) => product.tenantId === tenantId && product.id === productId,
    );
    return found === undefined ? err({ kind: 'NOT_FOUND', id: productId }) : ok(found);
  }

  async list(
    tenantId: string,
    filter: ProductFilter,
  ): Promise<Result<readonly Product[], RepositoryError>> {
    return ok(
      this.products.filter(
        (product) => product.tenantId === tenantId && matchesFilter(product, filter),
      ),
    );
  }

  async save(product: Product): Promise<Result<Product, RepositoryError>> {
    const index = this.products.findIndex((candidate) => candidate.id === product.id);
    this.products =
      index >= 0
        ? this.products.map((candidate, position) => (position === index ? product : candidate))
        : [...this.products, product];
    return ok(product);
  }

  async setAvailability(
    tenantId: string,
    productId: string,
    available: boolean,
  ): Promise<Result<Product, RepositoryError>> {
    const found = await this.findById(tenantId, productId);
    if (found.isErr()) {
      return found;
    }
    const updated: Product = { ...found.value, available };
    return this.save(updated);
  }

}

export class InMemoryCategoryStore implements CategoryReader, CategoryWriter {
  private categories: Category[];

  constructor(categories: readonly Category[] = CATEGORIES) {
    this.categories = [...categories];
  }

  async list(tenantId: string): Promise<Result<readonly Category[], RepositoryError>> {
    return ok(
      [...this.categories]
        .filter((category) => category.tenantId === tenantId)
        .sort((left, right) => left.sortOrder - right.sortOrder),
    );
  }

  async save(category: Category): Promise<Result<Category, RepositoryError>> {
    const index = this.categories.findIndex(
      (candidate) => candidate.id === category.id && candidate.tenantId === category.tenantId,
    );
    this.categories =
      index >= 0
        ? this.categories.map((candidate, position) => (position === index ? category : candidate))
        : [...this.categories, category];
    return ok(category);
  }

  async reorder(
    tenantId: string,
    orderedIds: readonly string[],
  ): Promise<Result<void, RepositoryError>> {
    this.categories = this.categories.map((category) => {
      if (category.tenantId !== tenantId) return category;
      const position = orderedIds.indexOf(category.id);
      return position === -1 ? category : { ...category, sortOrder: position + 1 };
    });
    return ok(undefined);
  }

  async remove(tenantId: string, categoryId: string): Promise<Result<void, RepositoryError>> {
    const before = this.categories.length;
    this.categories = this.categories.filter(
      (category) => !(category.tenantId === tenantId && category.id === categoryId),
    );
    return before === this.categories.length
      ? err({ kind: 'NOT_FOUND', id: categoryId })
      : ok(undefined);
  }
}
