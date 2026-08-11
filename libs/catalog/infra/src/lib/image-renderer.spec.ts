import { DEFAULT_ADJUSTMENTS, type ImageEditParams, defaultCrop } from '@itadaki/catalog/domain';
import sharp from 'sharp';
import { detectImageType, validateUpload } from './image-intake';
import { renderImageSet } from './image-renderer';

jest.setTimeout(60_000);

/**
 * A landscape test image filled with fine checkerboard noise. High-frequency
 * detail is what makes blur measurable: a flat colour has the same standard
 * deviation whether or not it has been defocused.
 */
async function makeSource(width = 900, height = 600): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  const block = 8;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const on = (Math.floor(x / block) + Math.floor(y / block)) % 2 === 0;
      pixels[offset] = on ? 245 : 25;
      pixels[offset + 1] = on ? 235 : 35;
      pixels[offset + 2] = on ? 210 : 60;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

/**
 * Standard deviation of the red channel over a region, measured on raw pixels.
 * sharp's `.extract().stats()` reports whole-image statistics here, so the
 * region has to be sampled directly for the assertion to mean anything.
 */
async function regionSpread(
  image: Buffer,
  left: number,
  top: number,
  side: number,
): Promise<number> {
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const raw = await sharp(image).removeAlpha().raw().toBuffer();

  const values: number[] = [];
  for (let y = top; y < top + side; y += 1) {
    for (let x = left; x < left + side; x += 1) {
      values.push(raw[(y * width + x) * 3] ?? 0);
    }
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

const params = (overrides: Partial<ImageEditParams> = {}): ImageEditParams => ({
  crop: defaultCrop(),
  depthOfField: null,
  adjustments: DEFAULT_ADJUSTMENTS,
  ...overrides,
});

describe('magic byte detection', () => {
  it('identifies a real JPEG', async () => {
    expect(detectImageType(await makeSource(64, 64))).toBe('jpeg');
  });

  it('identifies a real PNG', async () => {
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    expect(detectImageType(png)).toBe('png');
  });

  it('identifies a real WebP', async () => {
    const webp = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#fff' },
    })
      .webp()
      .toBuffer();
    expect(detectImageType(webp)).toBe('webp');
  });

  it('rejects a text file renamed as an image', () => {
    const fake = Buffer.from('<?php system($_GET["c"]); ?>                ', 'utf-8');
    expect(detectImageType(fake)).toBe('unknown');
    const result = validateUpload(fake);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('UNSUPPORTED_TYPE');
  });

  it('rejects an empty file', () => {
    expect(validateUpload(Buffer.alloc(0)).isErr()).toBe(true);
  });

  it('rejects a file over the size limit', () => {
    const huge = Buffer.alloc(16 * 1024 * 1024);
    huge.set([0xff, 0xd8, 0xff], 0);
    const result = validateUpload(huge);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('TOO_LARGE');
  });

  it('accepts a genuine image', async () => {
    expect(validateUpload(await makeSource(64, 64)).isOk()).toBe(true);
  });
});

describe('renderImageSet', () => {
  it('emits every width in every format', async () => {
    const rendered = await renderImageSet(await makeSource(), params());
    expect(rendered.variants).toHaveLength(12);

    for (const width of [1200, 600, 300, 80]) {
      for (const format of ['avif', 'webp', 'jpeg']) {
        expect(
          rendered.variants.some((v) => v.width === width && v.format === format),
        ).toBe(true);
      }
    }
  });

  it('renders every variant as a square', async () => {
    const rendered = await renderImageSet(await makeSource(), params());

    for (const variant of rendered.variants) {
      const meta = await sharp(variant.data).metadata();
      expect(meta.width).toBe(variant.width);
      expect(meta.height).toBe(variant.width);
    }
  });

  it('produces a decodable image per format', async () => {
    const rendered = await renderImageSet(await makeSource(), params());
    const at600 = rendered.variants.filter((v) => v.width === 600);

    for (const variant of at600) {
      const meta = await sharp(variant.data).metadata();
      expect(meta.width).toBe(600);
      expect(variant.data.length).toBeGreaterThan(0);
    }
  });

  it('emits an inline LQIP placeholder', async () => {
    const rendered = await renderImageSet(await makeSource(), params());
    expect(rendered.lqip.startsWith('data:image/webp;base64,')).toBe(true);
    // Small enough to inline without bloating the document.
    expect(rendered.lqip.length).toBeLessThan(3000);
  });

  it('honours an inset crop', async () => {
    const full = await renderImageSet(await makeSource(), params());
    const cropped = await renderImageSet(
      await makeSource(),
      params({ crop: { x: 0.05, y: 0.1, size: 0.3 } }),
    );

    const pick = (set: typeof full) =>
      set.variants.find((v) => v.width === 300 && v.format === 'jpeg')?.data;

    const a = pick(full);
    const b = pick(cropped);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // Different framing must yield different pixels.
    expect(Buffer.compare(a as Buffer, b as Buffer)).not.toBe(0);
  });

  it('applies depth of field so the focal area stays sharper than the edge', async () => {
    const source = await makeSource();
    const rendered = await renderImageSet(
      source,
      params({
        depthOfField: { focal: { x: 0.25, y: 0.25 }, sharpRadius: 0.15, blurIntensity: 0.9 },
      }),
    );

    const variant = rendered.variants.find((v) => v.width === 600 && v.format === 'jpeg');
    expect(variant).toBeDefined();

    // Blur destroys local contrast, so the in-focus region keeps a markedly
    // higher spread than the defocused corner.
    const data = variant?.data as Buffer;
    const focalSpread = await regionSpread(data, 90, 90, 120);
    const farSpread = await regionSpread(data, 440, 440, 120);

    expect(focalSpread).toBeGreaterThan(farSpread * 1.5);
  });

  it('leaves the image untouched when blur intensity is zero', async () => {
    const source = await makeSource();
    const plain = await renderImageSet(source, params());
    const zeroBlur = await renderImageSet(
      source,
      params({
        depthOfField: { focal: { x: 0.5, y: 0.5 }, sharpRadius: 0.4, blurIntensity: 0 },
      }),
    );

    const pick = (set: typeof plain) =>
      set.variants.find((v) => v.width === 300 && v.format === 'jpeg')?.data as Buffer;

    expect(Buffer.compare(pick(plain), pick(zeroBlur))).toBe(0);
  });

  it('strips EXIF metadata from the output', async () => {
    const withExif = await sharp(await makeSource())
      .withMetadata({ exif: { IFD0: { Copyright: 'test', Software: 'itadaki' } } })
      .jpeg()
      .toBuffer();

    const rendered = await renderImageSet(withExif, params());
    const variant = rendered.variants.find((v) => v.width === 600 && v.format === 'jpeg');
    const meta = await sharp(variant?.data as Buffer).metadata();

    expect(meta.exif).toBeUndefined();
  });
});
