import {
  type ImageEditParams,
  type ImageSet,
  type ImageVariant,
  VARIANT_FORMATS,
  VARIANT_WIDTHS,
} from '@itadaki/catalog/domain';
import sharp from 'sharp';

export interface RenderedVariant {
  readonly width: number;
  readonly format: (typeof VARIANT_FORMATS)[number];
  readonly data: Buffer;
}

export interface RenderedImage {
  readonly variants: readonly RenderedVariant[];
  readonly lqip: string;
}

const MIME_BY_FORMAT: Record<(typeof VARIANT_FORMATS)[number], string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
};

/**
 * Builds a single-channel falloff: 0 inside the sharp radius, ramping to 255
 * beyond it. Used as the alpha of the blurred layer, so the focal area keeps
 * the original pixels and the surround fades into defocus.
 *
 * The ramp is computed per pixel rather than drawn as an SVG radial gradient:
 * the librsvg build bundled with sharp renders `stop-opacity` inside a
 * referenced gradient as a flat value, which silently produced a uniform mask.
 */
function radialFalloff(
  size: number,
  focalX: number,
  focalY: number,
  sharpRadius: number,
): Buffer {
  const mask = Buffer.alloc(size * size);
  const cx = focalX * size;
  const cy = focalY * size;
  const inner = Math.max(1, sharpRadius * size);
  // Feather over a fixed fraction of the frame so the transition reads as
  // optical falloff rather than a hard circle.
  const outer = inner + size * 0.45;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      const ramp = (distance - inner) / (outer - inner);
      const clamped = ramp <= 0 ? 0 : ramp >= 1 ? 1 : ramp;
      // Smoothstep keeps the edge of the sharp zone from banding.
      const eased = clamped * clamped * (3 - 2 * clamped);
      mask[y * size + x] = Math.round(eased * 255);
    }
  }
  return mask;
}

/**
 * Renders the master square from the original plus the editor parameters.
 * The browser canvas is never uploaded: re-rendering server-side from the
 * untouched original keeps quality and makes the edit non-destructive.
 */
async function renderMaster(original: Buffer, params: ImageEditParams, size: number): Promise<Buffer> {
  const metadata = await sharp(original).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error('could not read image dimensions');
  }

  // The crop is a square expressed against the shorter side.
  const shortest = Math.min(width, height);
  const cropSide = Math.max(1, Math.round(params.crop.size * shortest));
  const left = Math.min(Math.max(0, Math.round(params.crop.x * width)), width - cropSide);
  const top = Math.min(Math.max(0, Math.round(params.crop.y * height)), height - cropSide);

  const base = sharp(original)
    .extract({ left, top, width: cropSide, height: cropSide })
    .resize(size, size, { fit: 'cover' });

  let composed = await base.png().toBuffer();

  const dof = params.depthOfField;
  if (dof !== null && dof.blurIntensity > 0) {
    // Blur sigma scales with output size so the effect looks the same at any width.
    const sigma = Math.max(0.3, dof.blurIntensity * size * 0.035);
    const mask = radialFalloff(size, dof.focal.x, dof.focal.y, dof.sharpRadius);

    // Blend the two layers per pixel. sharp's composite honours a layer's
    // alpha against the canvas, not as a per-pixel mix weight, so doing the
    // interpolation directly is both correct and easy to reason about.
    const sharpPixels = await sharp(composed).removeAlpha().raw().toBuffer();
    const blurPixels = await sharp(composed).blur(sigma).removeAlpha().raw().toBuffer();
    const blended = Buffer.alloc(size * size * 3);

    for (let pixel = 0; pixel < size * size; pixel += 1) {
      const weight = (mask[pixel] ?? 0) / 255;
      for (let channel = 0; channel < 3; channel += 1) {
        const index = pixel * 3 + channel;
        blended[index] = Math.round(
          (sharpPixels[index] ?? 0) * (1 - weight) + (blurPixels[index] ?? 0) * weight,
        );
      }
    }

    composed = await sharp(blended, { raw: { width: size, height: size, channels: 3 } })
      .png()
      .toBuffer();
  }

  let pipeline = sharp(composed);

  const { sharpen, brightness, saturation } = params.adjustments;
  if (sharpen > 0) {
    pipeline = pipeline.sharpen({ sigma: 1, m1: 0, m2: sharpen });
  }
  if (brightness !== 1 || saturation !== 1) {
    pipeline = pipeline.modulate({ brightness, saturation });
  }

  return pipeline.png().toBuffer();
}

export async function renderImageSet(
  original: Buffer,
  params: ImageEditParams,
): Promise<RenderedImage> {
  const largest = VARIANT_WIDTHS[0];
  const master = await renderMaster(original, params, largest);

  const variants: RenderedVariant[] = [];
  for (const width of VARIANT_WIDTHS) {
    const resized = await sharp(master).resize(width, width, { fit: 'cover' }).png().toBuffer();

    for (const format of VARIANT_FORMATS) {
      const encoder = sharp(resized);
      const data =
        format === 'avif'
          ? await encoder.avif({ quality: 55 }).toBuffer()
          : format === 'webp'
            ? await encoder.webp({ quality: 72 }).toBuffer()
            : await encoder.jpeg({ quality: 80, mozjpeg: true }).toBuffer();

      variants.push({ width, format, data });
    }
  }

  // 20px blurred placeholder, inlined so the card reserves space immediately.
  const lqipBuffer = await sharp(master)
    .resize(20, 20, { fit: 'cover' })
    .blur(1.2)
    .webp({ quality: 40 })
    .toBuffer();

  return {
    variants,
    lqip: `data:image/webp;base64,${lqipBuffer.toString('base64')}`,
  };
}

/** Maps rendered files to the domain's ImageSet, given a URL per variant. */
export function toImageSet(
  rendered: RenderedImage,
  urlFor: (variant: RenderedVariant) => string,
  alt: string,
): ImageSet {
  return {
    variants: rendered.variants.map(
      (variant): ImageVariant => ({
        url: urlFor(variant),
        width: variant.width,
        format: variant.format,
      }),
    ),
    lqip: rendered.lqip,
    alt,
  };
}

export const mimeForFormat = (format: (typeof VARIANT_FORMATS)[number]): string =>
  MIME_BY_FORMAT[format];
