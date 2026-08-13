/**
 * Where the API lives, for a browser app.
 *
 * Angular builds bake their configuration in at compile time, which would mean
 * one build per restaurant. Instead the origin is read at runtime from a
 * `<meta name="itadaki-api">` tag in index.html, so the same bundle is
 * deployed everywhere and the environment sets the tag.
 *
 * The fallback covers local development and the case where the tag is missing:
 * same host as the page, which is right whenever the API sits behind the same
 * domain — and visible in the network tab when it is not.
 */

const DEV_API_PORT = '3000';

/** What the page says about itself, kept as a parameter so it can be tested. */
export interface PageContext {
  /** Content of the meta tag, or null when it is absent. */
  readonly configured: string | null;
  readonly protocol: string;
  readonly hostname: string;
  readonly origin: string;
}

/**
 * Reads the real page.
 *
 * Reached through `globalThis` so this module also type-checks in the Node
 * builds that share it — outside a browser every field falls back.
 */
function currentPage(): PageContext {
  const win = globalThis as {
    document?: { querySelector(selector: string): { getAttribute(name: string): string | null } | null };
    location?: { protocol: string; hostname: string; origin: string };
  };

  const tag = win.document?.querySelector('meta[name="itadaki-api"]') ?? null;
  return {
    configured: tag?.getAttribute('content') ?? null,
    protocol: win.location?.protocol ?? 'http:',
    hostname: win.location?.hostname ?? 'localhost',
    origin: win.location?.origin ?? `http://localhost:${DEV_API_PORT}`,
  };
}

/** Origin of the API, without a trailing slash: `https://api.itadaki.ar`. */
export function apiOrigin(page: PageContext = currentPage()): string {
  const configured = page.configured?.trim() ?? '';
  // A deploy that forgets to substitute the placeholder must not silently
  // become a request to a literal "__API_ORIGIN__" host.
  if (configured !== '' && !configured.startsWith('__')) {
    return configured.replace(/\/+$/, '');
  }

  // Every app runs on its own dev-server port, so "same origin" is wrong
  // locally; the API is the one on DEV_API_PORT.
  const local = page.hostname === 'localhost' || page.hostname === '127.0.0.1';
  return local ? `${page.protocol}//${page.hostname}:${DEV_API_PORT}` : page.origin;
}

/** Base URL for REST calls, which all live under `/api`. */
export function apiUrl(page?: PageContext): string {
  return `${apiOrigin(page)}/api`;
}

/** Origin the realtime socket connects to. */
export function socketUrl(page?: PageContext): string {
  return apiOrigin(page);
}
