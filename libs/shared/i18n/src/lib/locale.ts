export const LOCALES = ['es', 'en', 'pt'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** Picks the best supported locale from the browser's preference list. */
export function negotiate(preferred: readonly string[]): Locale {
  for (const candidate of preferred) {
    const base = candidate.toLowerCase().split('-')[0] ?? '';
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/**
 * Per-product overrides. A machine translation of "milanesa napolitana" is
 * worse than the original, so staff can pin an exact wording per language.
 */
export type Translations = Partial<Record<Locale, string>>;

export function translate(
  overrides: Translations | null | undefined,
  fallback: string,
  locale: Locale,
): string {
  const override = overrides?.[locale];
  return override !== undefined && override.trim() !== '' ? override : fallback;
}
