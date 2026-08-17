import { lookup } from 'node:dns/promises';

/**
 * Baja una página para importar la carta que ya está publicada en ella.
 *
 * Pedirle al servidor que traiga una URL que escribe otro es abrirle la puerta
 * a la red interna: `http://169.254.169.254/` es donde la nube guarda las
 * credenciales de la máquina, y `http://localhost:5432` es la base. Así que la
 * dirección se resuelve antes de pedir nada y se rechaza si cae adentro, con
 * cada redirección revisada igual — si no, alcanza con que el sitio conteste
 * un 302 hacia adentro para saltear el control.
 */

export type FetchPageError =
  | { readonly kind: 'URL_INVALIDA' }
  /** Apunta a la red interna, o a un nombre que resuelve ahí. */
  | { readonly kind: 'DESTINO_NO_PERMITIDO' }
  | { readonly kind: 'NO_RESPONDE' }
  | { readonly kind: 'NO_ES_UNA_PAGINA' }
  | { readonly kind: 'DEMASIADO_GRANDE' };

/** Una carta entera de texto pesa kilobytes; un megabyte y medio ya es de sobra. */
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/**
 * Direcciones que no son de internet.
 *
 * Están todas las que un atacante nombraría: la propia máquina, la red
 * privada, el link-local de los metadatos de la nube, y el rango del CGNAT que
 * en un proveedor comparte vecinos. Lo que no está en la lista se permite,
 * así que la lista es larga a propósito.
 */
export function isPrivateAddress(ip: string): boolean {
  // Una IPv4 escrita como IPv6 —`::ffff:10.0.0.1`— es esa misma IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const address = mapped?.[1] ?? ip;

  if (address.includes(':')) {
    const v6 = address.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    // fc00::/7 únicas locales, fe80::/10 link-local, ff00::/8 multicast.
    return /^(f[cd]|fe[89ab]|ff)/.test(v6);
  }

  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a = 0, b = 0] = parts;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return a >= 224;
}

/** Resuelve el nombre y falla si alguna de sus direcciones es interna. */
async function resolvesToPublicHost(hostname: string): Promise<boolean> {
  try {
    // Todas y no la primera: un nombre puede tener una pública y una interna,
    // y cuál usa la conexión no lo decide esto.
    const addresses = await lookup(hostname, { all: true });
    return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}

function parseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    // Sólo web: `file://` leería el disco del servidor y `gopher://` es el
    // clásico para hablarle a un servicio interno que no es HTTP.
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Lee el cuerpo hasta el tope, sin confiar en el `content-length` declarado. */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) return Buffer.alloc(0);

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;

    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

/**
 * Baja una dirección ajena revisando cada salto.
 *
 * Las redirecciones se siguen a mano porque dejárselas a `fetch` sería revisar
 * la primera dirección y confiar en el resto: un sitio que contesta 302 hacia
 * `http://169.254.169.254/` saltearía el control entero.
 */
async function fetchGuarded(
  rawUrl: string,
  accept: string,
  maxBytes: number,
): Promise<
  { ok: true; bytes: Buffer; url: string; contentType: string } | { ok: false; error: FetchPageError }
> {
  const first = parseUrl(rawUrl);
  if (first === null) return { ok: false, error: { kind: 'URL_INVALIDA' } };

  let url: URL = first;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!(await resolvesToPublicHost(url.hostname))) {
      return { ok: false, error: { kind: 'DESTINO_NO_PERMITIDO' } };
    }

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept, 'user-agent': 'itadaki-menu-import' },
      });
    } catch {
      return { ok: false, error: { kind: 'NO_RESPONDE' } };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      const next: URL | null =
        location === null ? null : parseUrl(new URL(location, url).toString());
      if (next === null) return { ok: false, error: { kind: 'DESTINO_NO_PERMITIDO' } };
      url = next;
      continue;
    }

    if (!response.ok) return { ok: false, error: { kind: 'NO_RESPONDE' } };

    const bytes = await readCapped(response, maxBytes).catch(() => null);
    if (bytes === null) return { ok: false, error: { kind: 'DEMASIADO_GRANDE' } };

    return {
      ok: true,
      bytes,
      // La dirección final y no la pedida: las fotos vienen relativas y un
      // redirect a otra carpeta las dejaría apuntando a donde no están.
      url: url.toString(),
      contentType: response.headers.get('content-type') ?? '',
    };
  }

  return { ok: false, error: { kind: 'NO_RESPONDE' } };
}

export async function fetchPage(
  rawUrl: string,
): Promise<{ ok: true; html: string; url: string } | { ok: false; error: FetchPageError }> {
  const got = await fetchGuarded(rawUrl, 'text/html,text/plain', MAX_BYTES);
  if (!got.ok) return got;

  if (!/text\/html|text\/plain|application\/xhtml/i.test(got.contentType)) {
    // Un PDF o una foto de la carta no son texto: se dice cuál es el problema
    // en vez de mostrar bytes ilegibles en la vista previa.
    return { ok: false, error: { kind: 'NO_ES_UNA_PAGINA' } };
  }

  return { ok: true, html: new TextDecoder('utf-8').decode(got.bytes), url: got.url };
}

/**
 * Baja la foto de un plato de la misma página de la que salió la carta.
 *
 * No mira el `content-type`: quién decide si esto es una imagen de verdad es
 * `validateUpload`, por los primeros bytes y no por lo que el servidor ajeno
 * diga que mandó.
 */
export async function fetchImage(
  rawUrl: string,
  maxBytes: number,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: FetchPageError }> {
  const got = await fetchGuarded(rawUrl, 'image/*', maxBytes);
  return got.ok ? { ok: true, bytes: got.bytes } : got;
}
