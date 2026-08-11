import { DEFAULT_LOCALE, isLocale, negotiate, translate } from './locale';
import { MESSAGES, message, type MessageKey } from './messages';

describe('locale negotiation', () => {
  it('picks an exact match', () => {
    expect(negotiate(['en'])).toBe('en');
    expect(negotiate(['pt'])).toBe('pt');
  });

  it('strips the region', () => {
    expect(negotiate(['pt-BR'])).toBe('pt');
    expect(negotiate(['en-US'])).toBe('en');
    expect(negotiate(['es-AR'])).toBe('es');
  });

  it('falls through to the first supported entry', () => {
    expect(negotiate(['de', 'fr', 'pt-BR'])).toBe('pt');
  });

  it('falls back to Spanish when nothing matches', () => {
    expect(negotiate(['de', 'ja'])).toBe(DEFAULT_LOCALE);
    expect(negotiate([])).toBe('es');
  });

  it('recognises supported codes', () => {
    expect(isLocale('es')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });
});

describe('per-product overrides', () => {
  it('uses the override when present', () => {
    expect(translate({ en: 'Pork ramen' }, 'ramen de cerdo', 'en')).toBe('Pork ramen');
  });

  it('falls back to the original name when no override exists', () => {
    expect(translate({ en: 'Pork ramen' }, 'ramen de cerdo', 'pt')).toBe('ramen de cerdo');
  });

  it('ignores a blank override', () => {
    expect(translate({ en: '   ' }, 'ramen de cerdo', 'en')).toBe('ramen de cerdo');
  });

  it('handles a missing override map', () => {
    expect(translate(null, 'ramen de cerdo', 'en')).toBe('ramen de cerdo');
    expect(translate(undefined, 'ramen de cerdo', 'en')).toBe('ramen de cerdo');
  });
});

describe('messages', () => {
  it('has every key in every language', () => {
    for (const [key, entry] of Object.entries(MESSAGES)) {
      for (const locale of ['es', 'en', 'pt'] as const) {
        expect(entry[locale]).toBeDefined();
        expect(entry[locale].length).toBeGreaterThan(0);
      }
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('resolves a key per locale', () => {
    expect(message('cart.title' as MessageKey, 'es')).toBe('carrito');
    expect(message('cart.title' as MessageKey, 'en')).toBe('cart');
    expect(message('cart.title' as MessageKey, 'pt')).toBe('carrinho');
  });
});
