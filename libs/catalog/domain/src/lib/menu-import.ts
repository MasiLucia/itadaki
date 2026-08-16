/**
 * Leer una carta escrita a mano.
 *
 * Un restaurante que ya trabaja tiene su carta en algún lado: un Word, un
 * Excel, un mensaje de WhatsApp, un cuaderno. Cargar sesenta platos de a uno
 * es lo que hace abandonar la prueba antes de empezar, y ninguno de esos
 * orígenes exporta un formato: lo único que todos pueden hacer es copiar y
 * pegar el texto.
 *
 * Así que esto no exige un formato — reconoce el que ya usan. Una línea con
 * un número al final es un plato; una sin precio es el nombre de la sección.
 * Lo que no entiende lo devuelve marcado, para que alguien lo corrija antes
 * de guardar en vez de descubrirlo con la carta publicada.
 */

export interface ParsedDish {
  readonly name: string;
  readonly description: string;
  /** En unidades menores, como el resto del sistema. */
  readonly priceMinor: number;
  readonly category: string;
}

export interface ParsedLine {
  readonly raw: string;
  readonly lineNumber: number;
  /** Por qué no se pudo leer, o null si se entendió. */
  readonly problem: 'SIN_PRECIO' | 'SIN_NOMBRE' | 'PRECIO_INVALIDO' | null;
  readonly dish: ParsedDish | null;
}

export interface ParsedMenu {
  readonly dishes: readonly ParsedDish[];
  readonly categories: readonly string[];
  /** Las líneas que no se entendieron, con su número para poder señalarlas. */
  readonly skipped: readonly ParsedLine[];
}

/** Cuando la carta no declara secciones, todo cae acá. */
export const DEFAULT_CATEGORY = 'Carta';

/**
 * Un precio al final de la línea.
 *
 * Acepta lo que la gente escribe de verdad: `$8.500`, `8500`, `$ 8.500,00`,
 * `8.500.-`. El punto es separador de miles en Argentina, así que `8.500` son
 * ocho mil quinientos y no ocho con cinco — leerlo al revés cobraría mil
 * veces menos, que es peor que no importar nada.
 */
const PRICE_AT_END = /(?:\$\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d{1,2}))?\s*(?:\.-|-)?\s*$/;

/** Una línea que separa secciones: sólo símbolos, sin palabras. */
const DECORATION = /^[\s\-—=*_·•.]+$/;

function toMinorUnits(whole: string, cents: string | undefined): number | null {
  // Los separadores de miles se sacan; lo que queda son pesos enteros.
  const pesos = Number(whole.replace(/[.\s]/g, ''));
  if (!Number.isFinite(pesos)) return null;

  const centavos = cents === undefined ? 0 : Number(cents.padEnd(2, '0'));
  if (!Number.isFinite(centavos)) return null;

  return pesos * 100 + centavos;
}

/**
 * Separa el nombre de la descripción.
 *
 * Muchas cartas escriben "Milanesa napolitana - con papas fritas" o
 * "Milanesa napolitana: con papas". Lo que va antes del guión o los dos
 * puntos es el plato; el resto lo explica.
 */
function splitNameAndDescription(text: string): { name: string; description: string } {
  const separator = /\s+[-–—:]\s+/.exec(text);
  if (separator === null || separator.index === 0) {
    return { name: text.trim(), description: '' };
  }

  return {
    name: text.slice(0, separator.index).trim(),
    description: text.slice(separator.index + separator[0].length).trim(),
  };
}

export function parseMenuText(text: string): ParsedMenu {
  const dishes: ParsedDish[] = [];
  const categories: string[] = [];
  const skipped: ParsedLine[] = [];

  let currentCategory = DEFAULT_CATEGORY;

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    const lineNumber = index + 1;

    // Vacías y separadores decorativos no dicen nada, y marcarlas como
    // problema llenaría la vista previa de ruido.
    if (line === '' || DECORATION.test(line)) continue;

    const priceMatch = PRICE_AT_END.exec(line);

    // Sin precio al final es el nombre de una sección: así es como se ve
    // "ENTRADAS" o "Parrilla" en cualquier carta.
    if (priceMatch === null) {
      const name = line.replace(/[:\s]+$/, '').trim();
      if (name === '') continue;

      currentCategory = name;
      if (!categories.includes(name)) categories.push(name);
      continue;
    }

    const beforePrice = line.slice(0, priceMatch.index).trim();
    // Un separador entre el plato y el precio: "Milanesa .......... 8500".
    const cleaned = beforePrice.replace(/[.\s·—–-]+$/, '').trim();

    if (cleaned === '') {
      skipped.push({ raw: line, lineNumber, problem: 'SIN_NOMBRE', dish: null });
      continue;
    }

    const priceMinor = toMinorUnits(priceMatch[1] ?? '', priceMatch[2]);
    if (priceMinor === null) {
      skipped.push({ raw: line, lineNumber, problem: 'PRECIO_INVALIDO', dish: null });
      continue;
    }

    const { name, description } = splitNameAndDescription(cleaned);
    if (name === '') {
      skipped.push({ raw: line, lineNumber, problem: 'SIN_NOMBRE', dish: null });
      continue;
    }

    if (!categories.includes(currentCategory)) categories.push(currentCategory);
    dishes.push({ name, description, priceMinor, category: currentCategory });
  }

  return { dishes, categories, skipped };
}
