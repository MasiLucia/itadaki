import {
  type CategoryReader,
  type ProductReader,
  type RepositoryError,
} from '@itadaki/catalog/application';
import {
  type Category,
  type Modifier,
  type ModifierGroup,
  type Product,
  type ProductFilter,
  matchesFilter,
} from '@itadaki/catalog/domain';
import { Money, type CurrencyCode, type Result, err, ok } from '@itadaki/shared/domain';

interface MoneyDto {
  amountInMinorUnits: number;
  currency: string;
}

interface MenuDto {
  categories: Array<{ id: string; name: string; sortOrder: number }>;
  products: Array<{
    id: string;
    categoryId: string;
    name: string;
    description: string;
    price: MoneyDto;
    allergens: string[];
    diets: string[];
    available: boolean;
    estimatedPrepMinutes: number;
    station: string;
    imageSet: {
      variants: Array<{ url: string; width: number; format: 'avif' | 'webp' | 'jpeg' }>;
      lqip: string;
      alt: string;
    } | null;
  }>;
  modifierGroups: Array<{
    id: string;
    productId: string;
    name: string;
    minSelections: number;
    maxSelections: number;
    modifiers: Array<{ id: string; name: string; priceDelta: MoneyDto; available: boolean }>;
  }>;
}

function toMoney(dto: MoneyDto): Money {
  const built = Money.of(dto.amountInMinorUnits, dto.currency as CurrencyCode);
  // A malformed amount from the wire would corrupt every downstream total,
  // so fall back to zero rather than propagate a bad value.
  return built.isOk() ? built.value : Money.zero('ARS');
}

/**
 * Loads the menu once and serves the reader ports from that snapshot.
 * Filtering stays local so typing in the search box costs no round trips.
 */
export interface MenuCache {
  cacheMenu(menu: unknown): Promise<void>;
  cachedMenu<T>(): Promise<T | null>;
}

export class HttpCatalog implements ProductReader {
  private menu: MenuDto | null = null;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly cache?: MenuCache,
  ) {}

  /**
   * Network first, cache as fallback. A diner in a basement still gets the
   * carte; a diner with signal still gets tonight's prices.
   */
  private async ensureLoaded(): Promise<void> {
    if (this.menu !== null) return;

    this.inflight ??= (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/menu`);
        if (!response.ok) throw new Error(`menu request failed: ${response.status}`);

        this.menu = (await response.json()) as MenuDto;
        await this.cache?.cacheMenu(this.menu);
      } catch (error) {
        const cached = await this.cache?.cachedMenu<MenuDto>();
        if (cached === null || cached === undefined) throw error;
        this.menu = cached;
      }
    })().finally(() => {
      this.inflight = null;
    });

    await this.inflight;
  }

  /** Discards the cached menu so the next read reflects an 86 broadcast. */
  invalidate(): void {
    this.menu = null;
  }

  private toProduct(dto: MenuDto['products'][number], tenantId: string): Product {
    return {
      id: dto.id,
      tenantId,
      categoryId: dto.categoryId,
      name: dto.name,
      description: dto.description,
      price: toMoney(dto.price),
      images: dto.imageSet,
      allergens: dto.allergens as Product['allergens'],
      diets: dto.diets as Product['diets'],
      estimatedPrepMinutes: dto.estimatedPrepMinutes,
      available: dto.available,
      station: dto.station as Product['station'],
    };
  }

  async findById(tenantId: string, productId: string): Promise<Result<Product, RepositoryError>> {
    await this.ensureLoaded();
    const found = this.menu?.products.find((product) => product.id === productId);
    return found === undefined
      ? err({ kind: 'NOT_FOUND', id: productId })
      : ok(this.toProduct(found, tenantId));
  }

  async list(
    tenantId: string,
    filter: ProductFilter,
  ): Promise<Result<readonly Product[], RepositoryError>> {
    await this.ensureLoaded();
    const all = (this.menu?.products ?? []).map((product) => this.toProduct(product, tenantId));
    return ok(all.filter((product) => matchesFilter(product, filter)));
  }

  async listCategoriesFor(tenantId: string): Promise<Result<readonly Category[], RepositoryError>> {
    await this.ensureLoaded();
    return ok(
      (this.menu?.categories ?? [])
        .map((category) => ({
          id: category.id,
          tenantId,
          name: category.name,
          sortOrder: category.sortOrder,
          availability: null,
        }))
        .sort((left, right) => left.sortOrder - right.sortOrder),
    );
  }

  async modifierGroups(): Promise<readonly ModifierGroup[]> {
    await this.ensureLoaded();
    return (this.menu?.modifierGroups ?? []).map((group) => ({
      id: group.id,
      productId: group.productId,
      name: group.name,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      modifiers: group.modifiers.map(
        (modifier): Modifier => ({
          id: modifier.id,
          name: modifier.name,
          priceDelta: toMoney(modifier.priceDelta),
          available: modifier.available,
        }),
      ),
    }));
  }
}

/** Separate class so each port stays small, per the reader/writer split. */
export class HttpCategoryReader implements CategoryReader {
  constructor(private readonly catalog: HttpCatalog) {}

  async list(tenantId: string): Promise<Result<readonly Category[], RepositoryError>> {
    return this.catalog.listCategoriesFor(tenantId);
  }
}
