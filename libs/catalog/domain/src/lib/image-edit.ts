import { type Result, err, ok } from '@itadaki/shared/domain';

/**
 * Crop box in normalised coordinates (0–1) relative to the source image.
 * Normalised rather than pixel-based so the same params re-render correctly
 * against any stored resolution of the original.
 */
export interface CropBox {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** Focal point in normalised coordinates relative to the *crop box*. */
export interface FocalPoint {
  readonly x: number;
  readonly y: number;
}

export interface DepthOfField {
  readonly focal: FocalPoint;
  /** Fraction of the crop that stays sharp. */
  readonly sharpRadius: number;
  /** 0 = no blur, 1 = maximum defocus outside the radius. */
  readonly blurIntensity: number;
}

export interface Adjustments {
  /** Unsharp mask amount; 0 disables sharpening. */
  readonly sharpen: number;
  /** Multipliers where 1 is unchanged. */
  readonly brightness: number;
  readonly saturation: number;
}

export interface ImageEditParams {
  readonly crop: CropBox;
  readonly depthOfField: DepthOfField | null;
  readonly adjustments: Adjustments;
}

export type ImageEditError =
  | { readonly kind: 'CROP_OUT_OF_BOUNDS'; readonly field: string; readonly value: number }
  | { readonly kind: 'VALUE_OUT_OF_RANGE'; readonly field: string; readonly value: number };

const inUnit = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  sharpen: 0,
  brightness: 1,
  saturation: 1,
};

/** Centred square crop covering as much of the frame as the aspect allows. */
export function defaultCrop(): CropBox {
  return { x: 0, y: 0, size: 1 };
}

/**
 * Validates editor parameters before they reach the render pipeline.
 * A crop that runs past the edge would make sharp throw deep inside the
 * pipeline, so it is rejected here where the error is still meaningful.
 */
export function validateEditParams(params: ImageEditParams): Result<ImageEditParams, ImageEditError> {
  const { crop, depthOfField, adjustments } = params;

  for (const [field, value] of [
    ['crop.x', crop.x],
    ['crop.y', crop.y],
    ['crop.size', crop.size],
  ] as const) {
    if (!inUnit(value)) {
      return err({ kind: 'CROP_OUT_OF_BOUNDS', field, value });
    }
  }

  if (crop.size <= 0) {
    return err({ kind: 'CROP_OUT_OF_BOUNDS', field: 'crop.size', value: crop.size });
  }
  if (crop.x + crop.size > 1.0001 || crop.y + crop.size > 1.0001) {
    return err({ kind: 'CROP_OUT_OF_BOUNDS', field: 'crop', value: crop.size });
  }

  if (depthOfField !== null) {
    for (const [field, value] of [
      ['focal.x', depthOfField.focal.x],
      ['focal.y', depthOfField.focal.y],
      ['sharpRadius', depthOfField.sharpRadius],
      ['blurIntensity', depthOfField.blurIntensity],
    ] as const) {
      if (!inUnit(value)) {
        return err({ kind: 'VALUE_OUT_OF_RANGE', field, value });
      }
    }
  }

  if (!Number.isFinite(adjustments.sharpen) || adjustments.sharpen < 0 || adjustments.sharpen > 5) {
    return err({ kind: 'VALUE_OUT_OF_RANGE', field: 'sharpen', value: adjustments.sharpen });
  }
  for (const [field, value] of [
    ['brightness', adjustments.brightness],
    ['saturation', adjustments.saturation],
  ] as const) {
    if (!Number.isFinite(value) || value < 0.1 || value > 3) {
      return err({ kind: 'VALUE_OUT_OF_RANGE', field, value });
    }
  }

  return ok(params);
}

/** Widths rendered for every image, largest first. */
export const VARIANT_WIDTHS = [1200, 600, 300, 80] as const;
export const VARIANT_FORMATS = ['avif', 'webp', 'jpeg'] as const;
