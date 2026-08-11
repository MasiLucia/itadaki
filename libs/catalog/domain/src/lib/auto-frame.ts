import { type CropBox, type FocalPoint } from './image-edit';

/** Grayscale luminance grid sampled from the source image. */
export interface LumaGrid {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface FrameProposal {
  readonly crop: CropBox;
  readonly focal: FocalPoint;
}

const at = (grid: LumaGrid, x: number, y: number): number =>
  grid.data[y * grid.width + x] ?? 0;

/**
 * Per-pixel local contrast, used as a cheap stand-in for visual saliency.
 * Plated food sits against a flat table or board, so the busiest region of
 * the frame is nearly always the dish itself.
 */
function saliency(grid: LumaGrid): Float32Array {
  const scores = new Float32Array(grid.width * grid.height);

  for (let y = 1; y < grid.height - 1; y += 1) {
    for (let x = 1; x < grid.width - 1; x += 1) {
      // Sobel magnitude, approximated with the absolute gradients.
      const gx =
        at(grid, x + 1, y - 1) + 2 * at(grid, x + 1, y) + at(grid, x + 1, y + 1) -
        (at(grid, x - 1, y - 1) + 2 * at(grid, x - 1, y) + at(grid, x - 1, y + 1));
      const gy =
        at(grid, x - 1, y + 1) + 2 * at(grid, x, y + 1) + at(grid, x + 1, y + 1) -
        (at(grid, x - 1, y - 1) + 2 * at(grid, x, y - 1) + at(grid, x + 1, y - 1));

      scores[y * grid.width + x] = Math.abs(gx) + Math.abs(gy);
    }
  }
  return scores;
}

/** Summed-area table so any window's total is four lookups. */
function integralOf(scores: Float32Array, width: number, height: number): Float64Array {
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += scores[y * width + x] ?? 0;
      const above = integral[y * (width + 1) + (x + 1)] ?? 0;
      integral[(y + 1) * (width + 1) + (x + 1)] = above + rowSum;
    }
  }
  return integral;
}

function windowSum(
  integral: Float64Array,
  width: number,
  left: number,
  top: number,
  side: number,
): number {
  const stride = width + 1;
  const right = left + side;
  const bottom = top + side;
  return (
    (integral[bottom * stride + right] ?? 0) -
    (integral[top * stride + right] ?? 0) -
    (integral[bottom * stride + left] ?? 0) +
    (integral[top * stride + left] ?? 0)
  );
}

/**
 * Proposes a square crop centred on the busiest part of the image, plus a
 * focal point at its centre of mass.
 *
 * The window covers the shorter side so nothing is discarded unnecessarily;
 * the search only decides where to slide it. Returned coordinates are
 * normalised against the full image, matching what the render pipeline expects.
 */
export function proposeFrame(grid: LumaGrid): FrameProposal {
  const side = Math.min(grid.width, grid.height);

  if (side < 3) {
    return { crop: { x: 0, y: 0, size: 1 }, focal: { x: 0.5, y: 0.5 } };
  }

  const scores = saliency(grid);
  const integral = integralOf(scores, grid.width, grid.height);

  // 24 candidate positions along the long axis is enough to land on the
  // subject without the search cost showing up as input lag.
  const travel = Math.max(grid.width, grid.height) - side;
  const steps = travel === 0 ? 0 : 24;
  const horizontal = grid.width >= grid.height;

  let bestOffset = 0;
  let bestScore = -1;

  for (let step = 0; step <= steps; step += 1) {
    const offset = steps === 0 ? 0 : Math.round((travel * step) / steps);
    const left = horizontal ? offset : 0;
    const top = horizontal ? 0 : offset;
    const total = windowSum(integral, grid.width, left, top, side);

    if (total > bestScore) {
      bestScore = total;
      bestOffset = offset;
    }
  }

  const cropLeft = horizontal ? bestOffset : 0;
  const cropTop = horizontal ? 0 : bestOffset;

  // Centre of mass of the detail inside the chosen window.
  let weighted = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let y = cropTop; y < cropTop + side; y += 1) {
    for (let x = cropLeft; x < cropLeft + side; x += 1) {
      const score = scores[y * grid.width + x] ?? 0;
      weighted += score;
      weightedX += score * (x - cropLeft);
      weightedY += score * (y - cropTop);
    }
  }

  const focal: FocalPoint =
    weighted === 0
      ? { x: 0.5, y: 0.5 }
      : {
          x: Math.min(1, Math.max(0, weightedX / weighted / side)),
          y: Math.min(1, Math.max(0, weightedY / weighted / side)),
        };

  // `size` is a fraction of the shorter side, matching the render pipeline;
  // a full-height window on a landscape photo is therefore 1.
  return {
    crop: {
      x: cropLeft / grid.width,
      y: cropTop / grid.height,
      size: 1,
    },
    focal,
  };
}
