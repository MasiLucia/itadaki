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

/**
 * Una tabla, como la exporta un Excel.
 *
 * El que tiene la carta en una planilla la guarda como CSV y la sube: pedirle
 * que copie y pegue celda por celda sería peor que el trabajo que esto viene
 * a ahorrar. Se convierte a las mismas líneas que entiende `parseMenuText`,
 * para que haya un solo camino probado en vez de dos.
 *
 * No exige un orden de columnas: busca los encabezados por su nombre, porque
 * cada planilla los pone donde quiere. Si no encuentra encabezados, asume el
 * orden más común — nombre, precio, categoría — que es como lo escribiría
 * cualquiera sin pensarlo.
 */

/** Cómo suele llamarse cada columna en una planilla de carta. */
const COLUMN_NAMES = {
  name: ['nombre', 'plato', 'producto', 'item', 'descripcion corta', 'name', 'product'],
  price: ['precio', 'valor', 'importe', 'price', 'monto', '$'],
  category: ['categoria', 'seccion', 'rubro', 'grupo', 'category', 'section'],
  description: ['descripcion', 'detalle', 'ingredientes', 'description', 'detail'],
} as const;

/** Saca tildes y espacios, para comparar encabezados escritos de cualquier forma. */
function normalise(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Parte una línea de CSV respetando las comillas.
 *
 * Una descripción con coma — "milanesa, papas y ensalada" — viene entre
 * comillas justamente para que no se lea como tres columnas.
 */
function splitCsvLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      // Dos comillas seguidas dentro de una celda son una comilla literal.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === separator && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** Coma o punto y coma: Excel en español exporta con punto y coma. */
function detectSeparator(firstLine: string): string {
  const semis = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

function findColumn(headers: readonly string[], names: readonly string[]): number {
  return headers.findIndex((header) => names.includes(normalise(header)));
}

/**
 * Convierte una tabla en las líneas que `parseMenuText` ya sabe leer.
 *
 * Devolver texto y no platos es deliberado: la vista previa, los errores por
 * línea y el redondeo de precios ya están resueltos y probados en un solo
 * lugar, y duplicarlos acá sería tener dos comportamientos que se separan.
 */
export function csvToMenuText(csv: string): string {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return '';

  const separator = detectSeparator(lines[0] ?? '');
  const rows = lines.map((line) => splitCsvLine(line, separator));

  const headers = rows[0] ?? [];
  let nameAt = findColumn(headers, COLUMN_NAMES.name);
  let priceAt = findColumn(headers, COLUMN_NAMES.price);
  let categoryAt = findColumn(headers, COLUMN_NAMES.category);
  let descriptionAt = findColumn(headers, COLUMN_NAMES.description);

  // Sin encabezados reconocibles, la primera fila ya es un plato y se asume
  // el orden más común: nombre, precio, categoría.
  const hasHeaders = nameAt !== -1 || priceAt !== -1;
  const body = hasHeaders ? rows.slice(1) : rows;
  if (!hasHeaders) {
    nameAt = 0;
    priceAt = 1;
    categoryAt = 2;
    descriptionAt = -1;
  }

  const out: string[] = [];
  let currentCategory = '';

  for (const row of body) {
    const name = (row[nameAt] ?? '').trim();
    const price = priceAt === -1 ? '' : (row[priceAt] ?? '').trim();
    if (name === '' && price === '') continue;

    const category = categoryAt === -1 ? '' : (row[categoryAt] ?? '').trim();
    if (category !== '' && category !== currentCategory) {
      // La sección va sola en su renglón, que es como parseMenuText la
      // reconoce; repetirla en cada fila la volvería un plato sin precio.
      if (out.length > 0) out.push('');
      out.push(category);
      currentCategory = category;
    }

    const description = descriptionAt === -1 ? '' : (row[descriptionAt] ?? '').trim();
    const left = description === '' ? name : `${name} - ${description}`;
    out.push(price === '' ? left : `${left} ${price}`);
  }

  return out.join('\n');
}
