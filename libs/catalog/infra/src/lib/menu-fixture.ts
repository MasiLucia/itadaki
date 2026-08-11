import { type Category, type ModifierGroup, type Product } from '@itadaki/catalog/domain';
import { Money } from '@itadaki/shared/domain';

const TENANT = 'itadaki';

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) {
    throw new Error(`invalid fixture price: ${minor}`);
  }
  return result.value;
};

/**
 * Sample menu for the demo tenant: a neighbourhood parrilla/bodegón, the most
 * common kind of restaurant this would be sold into. The catalog itself is
 * cuisine-agnostic — this fixture is data, not a constraint.
 */
export const CATEGORIES: readonly Category[] = [
  { id: 'entradas', tenantId: TENANT, name: 'entradas', sortOrder: 1, availability: null },
  { id: 'parrilla', tenantId: TENANT, name: 'parrilla', sortOrder: 2, availability: null },
  { id: 'milanesas', tenantId: TENANT, name: 'milanesas', sortOrder: 3, availability: null },
  { id: 'bebidas', tenantId: TENANT, name: 'bebidas', sortOrder: 4, availability: null },
  { id: 'postres', tenantId: TENANT, name: 'postres', sortOrder: 5, availability: null },
];

export const PRODUCTS: readonly Product[] = [
  {
    id: 'e1',
    tenantId: TENANT,
    categoryId: 'entradas',
    name: 'empanadas de carne',
    description: 'media docena, carne cortada a cuchillo',
    price: ars(340_000),
    images: null,
    allergens: ['GLUTEN'],
    diets: [],
    estimatedPrepMinutes: 8,
    available: true,
    station: 'GRILL',
  },
  {
    id: 'e2',
    tenantId: TENANT,
    categoryId: 'entradas',
    name: 'provoleta a la parrilla',
    description: 'provolone, orégano y aceite de oliva',
    price: ars(310_000),
    images: null,
    allergens: ['LACTOSE'],
    diets: ['VEGETARIAN', 'GLUTEN_FREE'],
    estimatedPrepMinutes: 6,
    available: false,
    station: 'GRILL',
  },
  {
    id: 'a1',
    tenantId: TENANT,
    categoryId: 'parrilla',
    name: 'bife de chorizo',
    description: '400g con guarnición a elección',
    price: ars(820_000),
    images: null,
    allergens: [],
    diets: ['GLUTEN_FREE', 'LACTOSE_FREE'],
    estimatedPrepMinutes: 14,
    available: true,
    station: 'GRILL',
  },
  {
    id: 'a2',
    tenantId: TENANT,
    categoryId: 'parrilla',
    name: 'vacío al horno de barro',
    description: 'cocción lenta 3hs, papas españolas',
    price: ars(790_000),
    images: null,
    allergens: [],
    diets: ['GLUTEN_FREE', 'LACTOSE_FREE'],
    estimatedPrepMinutes: 12,
    available: true,
    station: 'GRILL',
  },
  {
    id: 'm1',
    tenantId: TENANT,
    categoryId: 'milanesas',
    name: 'milanesa napolitana',
    description: 'ternera, jamón, salsa y muzzarella',
    price: ars(740_000),
    images: null,
    allergens: ['GLUTEN', 'EGG', 'LACTOSE'],
    diets: [],
    estimatedPrepMinutes: 11,
    available: true,
    station: 'GRILL',
  },
  {
    id: 'b1',
    tenantId: TENANT,
    categoryId: 'bebidas',
    name: 'limonada con menta',
    description: 'jarra de un litro, bien fría',
    price: ars(150_000),
    images: null,
    allergens: [],
    diets: ['VEGAN', 'VEGETARIAN', 'GLUTEN_FREE', 'LACTOSE_FREE'],
    estimatedPrepMinutes: 2,
    available: true,
    station: 'BAR',
  },
  {
    id: 'p1',
    tenantId: TENANT,
    categoryId: 'postres',
    name: 'flan casero con dulce',
    description: 'con dulce de leche y crema',
    price: ars(260_000),
    images: null,
    allergens: ['EGG', 'LACTOSE'],
    diets: ['VEGETARIAN', 'GLUTEN_FREE'],
    estimatedPrepMinutes: 4,
    available: true,
    station: 'DESSERT',
  },
];

export const MODIFIER_GROUPS: readonly ModifierGroup[] = [
  {
    id: 'g-parrilla-punto',
    productId: 'a1',
    name: 'punto de cocción',
    minSelections: 1,
    maxSelections: 1,
    modifiers: [
      { id: 'm1', name: 'jugoso', priceDelta: ars(0), available: true },
      { id: 'm2', name: 'a punto', priceDelta: ars(0), available: true },
      { id: 'm3', name: 'bien cocido', priceDelta: ars(0), available: true },
    ],
  },
  {
    id: 'g-parrilla-guarnicion',
    productId: 'a1',
    name: 'guarnición',
    minSelections: 0,
    maxSelections: 2,
    modifiers: [
      { id: 'm4', name: 'papas fritas', priceDelta: ars(80_000), available: true },
      { id: 'm5', name: 'ensalada mixta', priceDelta: ars(70_000), available: true },
      { id: 'm6', name: 'puré de calabaza', priceDelta: ars(90_000), available: true },
    ],
  },
];

export const TENANT_ID = TENANT;
