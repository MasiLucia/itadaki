/**
 * Minimal QR encoder, byte mode, error correction level M.
 *
 * Written rather than pulled in: a table QR is a printed artefact that has to
 * keep scanning for months, so the encoder is worth owning and testing. Level M
 * (~15% recovery) is the usual choice for print — enough to survive a smudge on
 * a laminated card without inflating the module count.
 */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

for (let i = 0, x = 1; i < 255; i += 1) {
  GF_EXP[i] = x;
  GF_LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255] ?? 0;

const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : (GF_EXP[((GF_LOG[a] ?? 0) + (GF_LOG[b] ?? 0)) % 255] ?? 0);

/** Generator polynomial for `degree` error correction codewords. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] ?? 0) ^ gfMul(poly[j] ?? 0, 1);
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j] ?? 0, GF_EXP[i] ?? 0);
    }
    poly = next;
  }
  return poly;
}

function reedSolomon(data: readonly number[], ecCount: number): number[] {
  const poly = generatorPoly(ecCount);
  const residual = new Array<number>(ecCount).fill(0);

  for (const byte of data) {
    const factor = byte ^ (residual[0] ?? 0);
    residual.shift();
    residual.push(0);
    for (let i = 0; i < ecCount; i += 1) {
      residual[i] = (residual[i] ?? 0) ^ gfMul(poly[i + 1] ?? 0, factor);
    }
  }
  return residual;
}

/**
 * Capacity table for level M, byte mode: [version, totalCodewords,
 * ecPerBlock, group1Blocks, group1Data, group2Blocks, group2Data].
 * Versions 2–10 cover a table URL comfortably; a signed token pushes most
 * links into the 200–400 byte range.
 */
const VERSIONS: ReadonlyArray<readonly [number, number, number, number, number, number, number]> = [
  [2, 44, 16, 1, 28, 0, 0],
  [3, 70, 26, 1, 44, 0, 0],
  [4, 100, 18, 2, 32, 0, 0],
  [5, 134, 24, 2, 43, 0, 0],
  [6, 172, 16, 4, 27, 0, 0],
  [7, 196, 18, 4, 31, 0, 0],
  [8, 242, 22, 2, 38, 2, 39],
  [9, 292, 22, 3, 36, 2, 37],
  [10, 346, 26, 4, 43, 1, 44],
  [11, 404, 30, 1, 50, 4, 51],
  [12, 466, 22, 6, 36, 2, 37],
  [13, 532, 22, 8, 37, 1, 38],
  [14, 581, 24, 4, 40, 5, 41],
  [15, 655, 24, 5, 41, 5, 42],
  [16, 733, 28, 7, 45, 3, 46],
  [17, 815, 28, 10, 46, 1, 47],
  [18, 901, 26, 9, 43, 4, 44],
  [19, 991, 26, 3, 44, 11, 45],
  [20, 1085, 26, 3, 41, 13, 42],
];

const ALIGNMENT: Record<number, readonly number[]> = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66],
  15: [6, 26, 48, 70], 16: [6, 26, 50, 74], 17: [6, 30, 54, 78],
  18: [6, 30, 56, 82], 19: [6, 30, 58, 86], 20: [6, 34, 62, 90],
};

export interface QrMatrix {
  readonly size: number;
  /** Row-major; true is a dark module. */
  readonly modules: readonly boolean[][];
}

export type QrError = { readonly kind: 'TOO_LONG'; readonly bytes: number };

function pickVersion(byteLength: number): (typeof VERSIONS)[number] | null {
  for (const entry of VERSIONS) {
    const [, total, ecPerBlock, g1, g1Data, g2, g2Data] = entry;
    const blocks = g1 + g2;
    const dataCapacity = total - ecPerBlock * blocks;
    // 4 bits mode + 16 bits length (versions ≥ 10) or 8 bits (below).
    const headerBytes = entry[0] >= 10 ? 3 : 2;
    if (byteLength + headerBytes <= dataCapacity && g1 * g1Data + g2 * g2Data === dataCapacity) {
      return entry;
    }
  }
  return null;
}

class BitWriter {
  private readonly bits: number[] = [];

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }

  padToBytes(): void {
    while (this.bits.length % 8 !== 0) this.bits.push(0);
  }

  get lengthInBits(): number {
    return this.bits.length;
  }

  toBytes(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (this.bits[i + j] ?? 0);
      out.push(byte);
    }
    return out;
  }
}

/** Penalty rules from the spec; the lowest-scoring mask is the one used. */
function maskPenalty(modules: boolean[][], size: number): number {
  let penalty = 0;

  for (let i = 0; i < size; i += 1) {
    for (const line of [
      Array.from({ length: size }, (_, j) => modules[i]?.[j] ?? false),
      Array.from({ length: size }, (_, j) => modules[j]?.[i] ?? false),
    ]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        if (line[j] === line[j - 1]) {
          run += 1;
        } else {
          if (run >= 5) penalty += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) penalty += 3 + (run - 5);
    }
  }

  for (let i = 0; i < size - 1; i += 1) {
    for (let j = 0; j < size - 1; j += 1) {
      const a = modules[i]?.[j];
      if (a === modules[i]?.[j + 1] && a === modules[i + 1]?.[j] && a === modules[i + 1]?.[j + 1]) {
        penalty += 3;
      }
    }
  }

  let dark = 0;
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) if (modules[i]?.[j] === true) dark += 1;
  }
  const ratio = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return penalty;
}

const FORMAT_BITS = 0x5412;

function formatInfo(mask: number): number {
  // Level M is 0b00 in the format field.
  let value = (0b00 << 3) | mask;
  let rem = value << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if ((rem >>> (10 + i)) & 1) rem ^= 0x537 << i;
  }
  value = ((value << 10) | rem) ^ FORMAT_BITS;
  return value;
}

function versionInfo(version: number): number {
  let rem = version << 12;
  for (let i = 5; i >= 0; i -= 1) {
    if ((rem >>> (12 + i)) & 1) rem ^= 0x1f25 << i;
  }
  return (version << 12) | rem;
}

/**
 * Encodes text as a QR matrix.
 *
 * Returns an error rather than throwing when the payload exceeds version 20 —
 * a caller shortening the URL is a better answer than a crash on a print page.
 */
export function encodeQr(text: string): QrMatrix | QrError {
  const bytes = [...new TextEncoder().encode(text)];
  const chosen = pickVersion(bytes.length);
  if (chosen === null) return { kind: 'TOO_LONG', bytes: bytes.length };

  const [version, totalCodewords, ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] = chosen;
  const dataCapacity = totalCodewords - ecPerBlock * (g1Blocks + g2Blocks);

  const writer = new BitWriter();
  writer.push(0b0100, 4);
  writer.push(bytes.length, version >= 10 ? 16 : 8);
  for (const byte of bytes) writer.push(byte, 8);

  const capacityBits = dataCapacity * 8;
  writer.push(0, Math.min(4, capacityBits - writer.lengthInBits));
  writer.padToBytes();

  const data = writer.toBytes();
  for (let pad = 0; data.length < dataCapacity; pad += 1) {
    data.push(pad % 2 === 0 ? 0xec : 0x11);
  }

  // Split into blocks, compute EC per block, then interleave.
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < g1Blocks + g2Blocks; i += 1) {
    const size = i < g1Blocks ? g1Data : g2Data;
    const block = data.slice(offset, offset + size);
    offset += size;
    blocks.push(block);
    ecBlocks.push(reedSolomon(block, ecPerBlock));
  }

  const interleaved: number[] = [];
  const maxData = Math.max(g1Data, g2Data);
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) if (i < block.length) interleaved.push(block[i] ?? 0);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) interleaved.push(block[i] ?? 0);
  }

  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );

  const placeFinder = (row: number, col: number): void => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark =
          inRing &&
          ((r === 0 || r === 6 || c === 0 || c === 6) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        const rowRef = modules[rr];
        const resRef = reserved[rr];
        if (rowRef !== undefined) rowRef[cc] = dark;
        if (resRef !== undefined) resRef[cc] = true;
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    const r6 = modules[6];
    const res6 = reserved[6];
    if (r6 !== undefined) r6[i] = dark;
    if (res6 !== undefined) res6[i] = true;
    const ri = modules[i];
    const resi = reserved[i];
    if (ri !== undefined) ri[6] = dark;
    if (resi !== undefined) resi[6] = true;
  }

  // Alignment patterns, skipping the finder corners.
  const centres = ALIGNMENT[version] ?? [];
  for (const r of centres) {
    for (const c of centres) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const rowRef = modules[r + dr];
          const resRef = reserved[r + dr];
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          if (rowRef !== undefined) rowRef[c + dc] = dark;
          if (resRef !== undefined) resRef[c + dc] = true;
        }
      }
    }
  }

  // Reserve format areas and the dark module.
  for (let i = 0; i < 9; i += 1) {
    const r8 = reserved[8];
    if (r8 !== undefined) {
      r8[i] = true;
      r8[size - 1 - i] = true;
    }
    const ri = reserved[i];
    if (ri !== undefined) ri[8] = true;
    const rn = reserved[size - 1 - i];
    if (rn !== undefined) rn[8] = true;
  }
  const darkRow = modules[size - 8];
  if (darkRow !== undefined) darkRow[8] = true;
  const darkRes = reserved[size - 8];
  if (darkRes !== undefined) darkRes[8] = true;

  if (version >= 7) {
    const info = versionInfo(version);
    for (let i = 0; i < 18; i += 1) {
      const bit = ((info >>> i) & 1) === 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      const rowA = modules[r];
      const resA = reserved[r];
      if (rowA !== undefined) rowA[c] = bit;
      if (resA !== undefined) resA[c] = true;
      const rowB = modules[c];
      const resB = reserved[c];
      if (rowB !== undefined) rowB[r] = bit;
      if (resB !== undefined) resB[r] = true;
    }
  }

  // Zig-zag placement of the interleaved codewords.
  let bitIndex = 0;
  const totalBits = interleaved.length * 8;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (reserved[row]?.[c] === true) continue;
        if (bitIndex >= totalBits) continue;
        const byte = interleaved[bitIndex >>> 3] ?? 0;
        const bit = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
        const rowRef = modules[row];
        if (rowRef !== undefined) rowRef[c] = bit;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  const maskFn = (mask: number, r: number, c: number): boolean => {
    switch (mask) {
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

  let best: boolean[][] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestMask = 0;

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = modules.map((row, r) =>
      row.map((cell, c) => (reserved[r]?.[c] === true ? cell : cell !== maskFn(mask, r, c))),
    );

    const info = formatInfo(mask);
    for (let i = 0; i < 15; i += 1) {
      const bit = ((info >>> i) & 1) === 1;
      if (i < 6) {
        const row = candidate[i];
        if (row !== undefined) row[8] = bit;
      } else if (i < 8) {
        const row = candidate[i + 1];
        if (row !== undefined) row[8] = bit;
      } else {
        const row = candidate[size - 15 + i];
        if (row !== undefined) row[8] = bit;
      }

      if (i < 8) {
        const row = candidate[8];
        if (row !== undefined) row[size - 1 - i] = bit;
      } else {
        const row = candidate[8];
        if (row !== undefined) row[14 - i] = bit;
      }
    }

    const score = maskPenalty(candidate, size);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
      bestMask = mask;
    }
  }

  void bestMask;
  return { size, modules: best ?? modules };
}

export function isQrError(value: QrMatrix | QrError): value is QrError {
  return 'kind' in value;
}

/**
 * Renders a matrix as an SVG path. Printable and scalable, and it embeds in a
 * page without a canvas or a data URL round-trip.
 */
export function qrToSvgPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let r = 0; r < matrix.size; r += 1) {
    for (let c = 0; c < matrix.size; c += 1) {
      if (matrix.modules[r]?.[c] === true) parts.push(`M${c} ${r}h1v1h-1z`);
    }
  }
  return parts.join('');
}
