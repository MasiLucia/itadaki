import {
  DEFAULT_ADJUSTMENTS,
  type ImageEditParams,
  defaultCrop,
  validateEditParams,
} from './image-edit';

const params = (overrides: Partial<ImageEditParams> = {}): ImageEditParams => ({
  crop: defaultCrop(),
  depthOfField: null,
  adjustments: DEFAULT_ADJUSTMENTS,
  ...overrides,
});

describe('validateEditParams', () => {
  it('accepts a full-frame crop', () => {
    expect(validateEditParams(params()).isOk()).toBe(true);
  });

  it('accepts an inset crop', () => {
    const result = validateEditParams(params({ crop: { x: 0.25, y: 0.1, size: 0.5 } }));
    expect(result.isOk()).toBe(true);
  });

  it('rejects a crop running past the right edge', () => {
    const result = validateEditParams(params({ crop: { x: 0.8, y: 0, size: 0.5 } }));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('CROP_OUT_OF_BOUNDS');
  });

  it('rejects a crop running past the bottom edge', () => {
    const result = validateEditParams(params({ crop: { x: 0, y: 0.7, size: 0.4 } }));
    expect(result.isErr()).toBe(true);
  });

  it('rejects a zero-sized crop', () => {
    const result = validateEditParams(params({ crop: { x: 0, y: 0, size: 0 } }));
    expect(result.isErr()).toBe(true);
  });

  it('rejects a negative origin', () => {
    const result = validateEditParams(params({ crop: { x: -0.1, y: 0, size: 0.5 } }));
    expect(result.isErr()).toBe(true);
  });

  it('accepts a valid depth of field', () => {
    const result = validateEditParams(
      params({
        depthOfField: { focal: { x: 0.5, y: 0.4 }, sharpRadius: 0.35, blurIntensity: 0.6 },
      }),
    );
    expect(result.isOk()).toBe(true);
  });

  it('rejects a focal point outside the crop', () => {
    const result = validateEditParams(
      params({
        depthOfField: { focal: { x: 1.4, y: 0.4 }, sharpRadius: 0.35, blurIntensity: 0.6 },
      }),
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.field).toBe('focal.x');
  });

  it('rejects a blur intensity above one', () => {
    const result = validateEditParams(
      params({
        depthOfField: { focal: { x: 0.5, y: 0.5 }, sharpRadius: 0.3, blurIntensity: 2 },
      }),
    );
    expect(result.isErr()).toBe(true);
  });

  it('rejects out-of-range brightness', () => {
    const result = validateEditParams(
      params({ adjustments: { ...DEFAULT_ADJUSTMENTS, brightness: 9 } }),
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.field).toBe('brightness');
  });

  it('rejects a negative sharpen amount', () => {
    const result = validateEditParams(
      params({ adjustments: { ...DEFAULT_ADJUSTMENTS, sharpen: -1 } }),
    );
    expect(result.isErr()).toBe(true);
  });

  it('rejects NaN', () => {
    const result = validateEditParams(params({ crop: { x: Number.NaN, y: 0, size: 0.5 } }));
    expect(result.isErr()).toBe(true);
  });
});
