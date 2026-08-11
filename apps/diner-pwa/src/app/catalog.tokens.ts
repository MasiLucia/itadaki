import { InjectionToken } from '@angular/core';
import { type CategoryReader, type ProductReader } from '@itadaki/catalog/application';
import { type ModifierGroup } from '@itadaki/catalog/domain';

/**
 * The screens depend on these interfaces, never on a concrete store, so
 * swapping the in-memory adapter for the HTTP one touches only the providers.
 */
export const PRODUCT_READER = new InjectionToken<ProductReader>('PRODUCT_READER');
export const CATEGORY_READER = new InjectionToken<CategoryReader>('CATEGORY_READER');
/** Resolved lazily: the groups arrive with the menu fetch. */
export const MODIFIER_GROUPS_TOKEN = new InjectionToken<() => Promise<readonly ModifierGroup[]>>(
  'MODIFIER_GROUPS',
);
export const TENANT = new InjectionToken<string>('TENANT');
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');
export const WS_URL = new InjectionToken<string>('WS_URL');
