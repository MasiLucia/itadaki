import { type QrMatrix, encodeQr, isQrError, qrToSvgPath } from './qr';

const matrixOf = (text: string): QrMatrix => {
  const result = encodeQr(text);
  if (isQrError(result)) throw new Error(`expected a matrix, got ${result.kind}`);
  return result;
};

/**
 * Reads the payload back out of a finished matrix.
 *
 * A generated QR is only worth anything if a scanner can decode it, so the
 * tests undo the mask, de-interleave the blocks and re-read the byte segment
 * rather than asserting on module counts.
 */
function decode(matrix: QrMatrix): string {
  const { size, modules } = matrix;
  const version = (size - 17) / 4;

  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );
  const reserve = (r: number, c: number): void => {
    const row = reserved[r];
    if (row !== undefined) row[c] = true;
  };

  for (const [br, bc] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        if (br + r >= 0 && br + r < size && bc + c >= 0 && bc + c < size) reserve(br + r, bc + c);
      }
    }
  }
  for (let i = 0; i < size; i += 1) {
    reserve(6, i);
    reserve(i, 6);
  }
  for (let i = 0; i < 9; i += 1) {
    reserve(8, i);
    reserve(8, size - 1 - i);
    reserve(i, 8);
    reserve(size - 1 - i, 8);
  }

  const alignment: Record<number, readonly number[]> = {
    2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };
  for (const r of alignment[version] ?? []) {
    for (const c of alignment[version] ?? []) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) reserve(r + dr, c + dc);
      }
    }
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      reserve(r, c);
      reserve(c, r);
    }
  }

  // The mask lives in the format field, which is itself masked by 0x5412.
  const formatBits: number[] = [];
  for (let i = 0; i < 15; i += 1) {
    if (i < 6) formatBits.push(modules[i]?.[8] === true ? 1 : 0);
    else if (i < 8) formatBits.push(modules[i + 1]?.[8] === true ? 1 : 0);
    else formatBits.push(modules[size - 15 + i]?.[8] === true ? 1 : 0);
  }
  let format = 0;
  for (let i = 14; i >= 0; i -= 1) format = (format << 1) | (formatBits[i] ?? 0);
  format ^= 0x5412;
  const mask = (format >>> 10) & 0b111;

  const maskFn = (m: number, r: number, c: number): boolean => {
    switch (m) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  };

  const bits: number[] = [];
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (reserved[row]?.[c] === true) continue;
        const raw = modules[row]?.[c] === true;
        bits.push(raw !== maskFn(mask, row, c) ? 1 : 0);
      }
    }
    upward = !upward;
  }

  const codewords: number[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] ?? 0);
    codewords.push(byte);
  }

  const layout: Record<number, readonly [number, number, number, number, number]> = {
    2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0], 4: [18, 2, 32, 0, 0],
    5: [24, 2, 43, 0, 0], 6: [16, 4, 27, 0, 0], 7: [18, 4, 31, 0, 0],
    8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37], 10: [26, 4, 43, 1, 44],
  };
  const spec = layout[version];
  if (spec === undefined) throw new Error(`decoder has no layout for version ${version}`);
  const [, g1, g1Data, g2, g2Data] = spec;

  // Undo the interleave: data codewords were written column-wise across blocks.
  const blocks: number[][] = Array.from({ length: g1 + g2 }, () => []);
  let index = 0;
  const maxData = Math.max(g1Data, g2Data);
  for (let i = 0; i < maxData; i += 1) {
    for (let b = 0; b < g1 + g2; b += 1) {
      const capacity = b < g1 ? g1Data : g2Data;
      if (i < capacity) {
        blocks[b]?.push(codewords[index] ?? 0);
        index += 1;
      }
    }
  }

  const data = blocks.flat();
  const lengthBits = version >= 10 ? 16 : 8;
  const header = ((data[0] ?? 0) << 8) | (data[1] ?? 0);
  const mode = (header >>> 12) & 0xf;
  if (mode !== 0b0100) throw new Error(`expected byte mode, got ${mode}`);

  let length: number;
  let payloadStart: number;
  let shift: number;
  if (lengthBits === 8) {
    length = (header >>> 4) & 0xff;
    payloadStart = 1;
    shift = 4;
  } else {
    length = ((header & 0x0fff) << 4) | (((data[2] ?? 0) >>> 4) & 0xf);
    payloadStart = 2;
    shift = 4;
  }

  const bytes: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const hi = data[payloadStart + i] ?? 0;
    const lo = data[payloadStart + i + 1] ?? 0;
    bytes.push(((hi << shift) | (lo >>> (8 - shift))) & 0xff);
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

describe('QR encoding', () => {
  it('round-trips a short payload', () => {
    const text = 'https://itadaki.ar/m/7';
    expect(decode(matrixOf(text))).toBe(text);
  });

  it('round-trips a realistic table link with a signed token', () => {
    const token =
      'eyJ0ZW5hbnRJZCI6Iml0YWRha2kiLCJ0YWJsZUlkIjoibWVzYS03In0.wnI7qrLOzq8mhuZOkiH8cT2xWMTckGe2';
    const text = `https://app.itadaki.ar/bienvenida?t=${token}`;
    expect(decode(matrixOf(text))).toBe(text);
  });

  it('round-trips accented Spanish, which is multi-byte in UTF-8', () => {
    const text = 'Mesa Nº 7 — Parrilla Don José';
    expect(decode(matrixOf(text))).toBe(text);
  });

  it('produces a square matrix whose size matches its version', () => {
    const matrix = matrixOf('https://itadaki.ar/m/7');
    expect(matrix.modules).toHaveLength(matrix.size);
    expect((matrix.size - 17) % 4).toBe(0);
    for (const row of matrix.modules) expect(row).toHaveLength(matrix.size);
  });

  it('places the three finder patterns', () => {
    const { modules, size } = matrixOf('https://itadaki.ar/m/7');
    for (const [r, c] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
      // Outer ring dark, inner gap light, 3x3 core dark.
      expect(modules[r]?.[c]).toBe(true);
      expect(modules[r + 1]?.[c + 1]).toBe(false);
      expect(modules[r + 3]?.[c + 3]).toBe(true);
    }
  });

  it('grows to a larger version as the payload grows', () => {
    const small = matrixOf('https://itadaki.ar/m/7');
    const large = matrixOf(`https://itadaki.ar/bienvenida?t=${'x'.repeat(300)}`);
    expect(large.size).toBeGreaterThan(small.size);
  });

  it('reports payloads it cannot fit instead of throwing', () => {
    const result = encodeQr('x'.repeat(5000));
    expect(isQrError(result)).toBe(true);
  });

  it('renders one SVG rect per dark module', () => {
    const matrix = matrixOf('hola');
    const dark = matrix.modules.flat().filter(Boolean).length;
    expect(qrToSvgPath(matrix).match(/M/g) ?? []).toHaveLength(dark);
  });
});
