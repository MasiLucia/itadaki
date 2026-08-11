import { type Result, err, ok } from '@itadaki/shared/domain';

export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly currency: string;
  readonly timezone: string;
  readonly active: boolean;
}

export type SignUpError =
  | { readonly kind: 'NAME_TOO_SHORT'; readonly name: string }
  | { readonly kind: 'NAME_TOO_LONG'; readonly name: string }
  | { readonly kind: 'NAME_NOT_USABLE'; readonly name: string };

const MIN_NAME = 2;
const MAX_NAME = 60;

/**
 * Turns a restaurant name into a URL-safe identifier.
 *
 * Accents are folded rather than stripped, so "Parrilla Don José" becomes
 * "parrilla-don-jose" instead of losing the letter — the slug shows up in
 * links a restaurant may share, and a mangled name reads as broken.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Validates a restaurant name and derives its slug.
 *
 * A name of only symbols slugifies to an empty string, which would produce an
 * unreachable tenant, so that is rejected here rather than at the database.
 */
export function prepareTenant(name: string): Result<{ name: string; slug: string }, SignUpError> {
  const trimmed = name.trim().replace(/\s+/g, ' ');

  if (trimmed.length < MIN_NAME) {
    return err({ kind: 'NAME_TOO_SHORT', name: trimmed });
  }
  if (trimmed.length > MAX_NAME) {
    return err({ kind: 'NAME_TOO_LONG', name: trimmed });
  }

  const slug = slugify(trimmed);
  if (slug === '') {
    return err({ kind: 'NAME_NOT_USABLE', name: trimmed });
  }

  return ok({ name: trimmed, slug });
}

/**
 * Appends a numeric suffix until the slug is free.
 *
 * Two restaurants can genuinely share a name — "La Esquina" in two towns — so
 * a collision is a normal case to resolve, not an error to report.
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Practically unreachable; a timestamp still beats failing the signup.
  return `${base}-${Date.now().toString(36)}`;
}
