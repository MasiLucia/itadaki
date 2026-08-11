import { type LumaGrid, proposeFrame } from './auto-frame';

/**
 * Builds a grid that is flat everywhere except a textured patch, standing in
 * for a dish on a plain table.
 */
function gridWithSubject(
  width: number,
  height: number,
  patch: { left: number; top: number; size: number },
): LumaGrid {
  const data = new Uint8Array(width * height);
  data.fill(120);

  for (let y = patch.top; y < patch.top + patch.size; y += 1) {
    for (let x = patch.left; x < patch.left + patch.size; x += 1) {
      if (x >= width || y >= height) continue;
      data[y * width + x] = (x + y) % 2 === 0 ? 240 : 20;
    }
  }
  return { width, height, data };
}

describe('proposeFrame', () => {
  it('slides the window towards a subject on the left', () => {
    const grid = gridWithSubject(400, 200, { left: 20, top: 40, size: 120 });
    const { crop } = proposeFrame(grid);

    // The 200px window should sit near the left edge, not centred at 0.25.
    expect(crop.x).toBeLessThan(0.15);
    expect(crop.y).toBe(0);
    expect(crop.size).toBe(1);
  });

  it('slides the window towards a subject on the right', () => {
    const grid = gridWithSubject(400, 200, { left: 260, top: 40, size: 120 });
    const { crop } = proposeFrame(grid);

    expect(crop.x).toBeGreaterThan(0.35);
  });

  it('handles a portrait image by sliding vertically', () => {
    const grid = gridWithSubject(200, 400, { left: 40, top: 250, size: 120 });
    const { crop } = proposeFrame(grid);

    expect(crop.x).toBe(0);
    expect(crop.y).toBeGreaterThan(0.25);
  });

  it('places the focal point on the subject', () => {
    const grid = gridWithSubject(400, 200, { left: 240, top: 30, size: 100 });
    const { crop, focal } = proposeFrame(grid);

    // Convert the focal point back to source pixels and check it lands
    // inside the textured patch.
    const cropLeftPx = crop.x * grid.width;
    const focalPx = cropLeftPx + focal.x * Math.min(grid.width, grid.height);
    const focalPy = focal.y * Math.min(grid.width, grid.height);

    expect(focalPx).toBeGreaterThan(230);
    expect(focalPx).toBeLessThan(350);
    expect(focalPy).toBeGreaterThan(20);
    expect(focalPy).toBeLessThan(140);
  });

  it('centres the focal point on a flat image', () => {
    const flat: LumaGrid = {
      width: 100,
      height: 100,
      data: new Uint8Array(100 * 100).fill(150),
    };
    const { crop, focal } = proposeFrame(flat);

    expect(focal).toEqual({ x: 0.5, y: 0.5 });
    expect(crop).toEqual({ x: 0, y: 0, size: 1 });
  });

  it('returns the whole frame for an already-square image', () => {
    const grid = gridWithSubject(200, 200, { left: 20, top: 20, size: 60 });
    const { crop } = proposeFrame(grid);

    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
    expect(crop.size).toBe(1);
  });

  it('survives a degenerate one-pixel image', () => {
    const tiny: LumaGrid = { width: 1, height: 1, data: new Uint8Array([200]) };
    const { crop, focal } = proposeFrame(tiny);

    expect(crop.size).toBe(1);
    expect(focal).toEqual({ x: 0.5, y: 0.5 });
  });

  it('produces a crop the render pipeline accepts', () => {
    const grid = gridWithSubject(900, 600, { left: 600, top: 200, size: 200 });
    const { crop, focal } = proposeFrame(grid);

    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.size).toBeGreaterThan(0);
    expect(crop.size).toBeLessThanOrEqual(1);
    expect(focal.x).toBeGreaterThanOrEqual(0);
    expect(focal.x).toBeLessThanOrEqual(1);
  });
});
