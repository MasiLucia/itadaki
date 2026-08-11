/**
 * Typed mirror of tokens.css for values that must be referenced from logic
 * (canvas painting, chart fills, inline SVG) rather than a stylesheet.
 * Keep in sync with tokens.css — that file is the source of truth for styling.
 */

export const ORDER_STATUS_COLOR = {
  NEW: 'var(--itadaki-status-new)',
  COOKING: 'var(--itadaki-status-cooking)',
  READY: 'var(--itadaki-status-ready)',
} as const;

export type OrderStatusColorKey = keyof typeof ORDER_STATUS_COLOR;

/** Diner identity colors for the collaborative table session. */
export const DINER_PALETTE = [
  'oklch(62% 0.19 33)',
  'oklch(65% 0.15 150)',
  'oklch(75% 0.15 85)',
  'oklch(58% 0.16 260)',
  'oklch(60% 0.18 320)',
  'oklch(55% 0.14 200)',
] as const;

/** Assigns a stable color per diner without coordination between clients. */
export function dinerColor(dinerId: string): string {
  let hash = 0;
  for (let index = 0; index < dinerId.length; index += 1) {
    hash = (hash * 31 + dinerId.charCodeAt(index)) | 0;
  }
  const slot = Math.abs(hash) % DINER_PALETTE.length;
  return DINER_PALETTE[slot] ?? DINER_PALETTE[0];
}
