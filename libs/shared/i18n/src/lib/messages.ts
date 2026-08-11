import { type Locale } from './locale';

/** UI copy. Kept flat and explicit — a key that is missing must fail loudly. */
export const MESSAGES = {
  'welcome.greeting': { es: 'itadakimasu!', en: 'itadakimasu!', pt: 'itadakimasu!' },
  'welcome.lede': {
    es: 'bienvenido a ITADAKI. tu mesa ya está lista — armá tu pedido cuando quieras.',
    en: 'welcome to ITADAKI. your table is ready — order whenever you like.',
    pt: 'bem-vindo ao ITADAKI. sua mesa está pronta — peça quando quiser.',
  },
  'welcome.cta': { es: 'ver la carta →', en: 'see the menu →', pt: 'ver o cardápio →' },
  'join.title': { es: '¿cómo te llamamos?', en: "what's your name?", pt: 'como te chamamos?' },
  'join.lede': {
    es: 'elegí un nombre para que el resto de la mesa vea qué pediste. no pedimos mail ni cuenta.',
    en: 'pick a name so the rest of the table can see what you ordered. no email, no account.',
    pt: 'escolha um nome para a mesa ver o que você pediu. sem e-mail, sem conta.',
  },
  'join.cta': { es: 'entrar a la mesa →', en: 'join the table →', pt: 'entrar na mesa →' },
  'menu.title': { es: '¿qué se te antoja?', en: 'what are you craving?', pt: 'o que você quer?' },
  'menu.search': { es: 'buscar plato…', en: 'search dishes…', pt: 'buscar pratos…' },
  'menu.all': { es: 'todo', en: 'all', pt: 'tudo' },
  'menu.empty': {
    es: 'no hay platos que coincidan con esos filtros.',
    en: 'no dishes match those filters.',
    pt: 'nenhum prato corresponde a esses filtros.',
  },
  'cart.title': { es: 'carrito', en: 'cart', pt: 'carrinho' },
  'cart.empty': { es: 'tu carrito está vacío.', en: 'your cart is empty.', pt: 'seu carrinho está vazio.' },
  'cart.send': { es: 'enviar pedido a cocina →', en: 'send order to kitchen →', pt: 'enviar pedido à cozinha →' },
  'bill.title': { es: 'gochisousama!', en: 'gochisousama!', pt: 'gochisousama!' },
  'bill.split.byDiner': { es: 'cada uno lo suyo', en: 'each pays their own', pt: 'cada um o seu' },
  'bill.split.equal': { es: 'partes iguales', en: 'split evenly', pt: 'partes iguais' },
  'bill.split.byItem': { es: 'por plato', en: 'by dish', pt: 'por prato' },
  'bill.tip.none': { es: 'sin propina', en: 'no tip', pt: 'sem gorjeta' },
  'bill.pay': { es: 'pagar en caja', en: 'pay at the counter', pt: 'pagar no caixa' },
  'diet.VEGAN': { es: 'vegano', en: 'vegan', pt: 'vegano' },
  'diet.VEGETARIAN': { es: 'vegetariano', en: 'vegetarian', pt: 'vegetariano' },
  'diet.GLUTEN_FREE': { es: 'sin gluten', en: 'gluten free', pt: 'sem glúten' },
  'diet.LACTOSE_FREE': { es: 'sin lactosa', en: 'lactose free', pt: 'sem lactose' },
  'offline.banner': {
    es: 'sin conexión · podés seguir armando el pedido',
    en: 'offline · you can keep building your order',
    pt: 'sem conexão · você pode continuar seu pedido',
  },
} as const satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof MESSAGES;

export function message(key: MessageKey, locale: Locale): string {
  return MESSAGES[key][locale];
}
