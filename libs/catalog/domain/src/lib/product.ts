import { type Money } from '@itadaki/shared/domain';

export const ALLERGENS = [
  'GLUTEN',
  'LACTOSE',
  'NUTS',
  'PEANUTS',
  'EGG',
  'FISH',
  'SHELLFISH',
  'SOY',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const DIET_TAGS = ['VEGAN', 'VEGETARIAN', 'GLUTEN_FREE', 'LACTOSE_FREE'] as const;
export type DietTag = (typeof DIET_TAGS)[number];

export const STATIONS = ['GRILL', 'COLD', 'BAR', 'DESSERT'] as const;
export type Station = (typeof STATIONS)[number];

/** One rendered variant of a product image. */
export interface ImageVariant {
  readonly url: string;
  readonly width: number;
  readonly format: 'avif' | 'webp' | 'jpeg';
}

/**
 * Rendered variants plus the low-quality placeholder used to hold layout
 * space while the real image loads.
 */
export interface ImageSet {
  readonly variants: readonly ImageVariant[];
  readonly lqip: string;
  readonly alt: string;
}

export interface Product {
  readonly id: string;
  readonly tenantId: string;
  readonly categoryId: string;
  readonly name: string;
  readonly description: string;
  readonly price: Money;
  readonly images: ImageSet | null;
  readonly allergens: readonly Allergen[];
  readonly diets: readonly DietTag[];
  readonly estimatedPrepMinutes: number;
  readonly available: boolean;
  readonly station: Station;
}

/** Diner-facing filters. A product matches only if it satisfies every criterion. */
export interface ProductFilter {
  readonly categoryId?: string;
  readonly search?: string;
  readonly excludeAllergens?: readonly Allergen[];
  readonly requireDiets?: readonly DietTag[];
  readonly onlyAvailable?: boolean;
}

export function matchesFilter(product: Product, filter: ProductFilter): boolean {
  if (filter.onlyAvailable === true && !product.available) {
    return false;
  }
  if (filter.categoryId !== undefined && product.categoryId !== filter.categoryId) {
    return false;
  }
  if (filter.search !== undefined && filter.search.trim() !== '') {
    const needle = filter.search.trim().toLowerCase();
    const haystack = `${product.name} ${product.description}`.toLowerCase();
    if (!haystack.includes(needle)) {
      return false;
    }
  }
  if (filter.excludeAllergens?.some((allergen) => product.allergens.includes(allergen)) === true) {
    return false;
  }
  if (filter.requireDiets?.every((diet) => product.diets.includes(diet)) === false) {
    return false;
  }
  return true;
}
