export const ORDER_STATUSES = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'IN_PREP',
  'READY',
  'DELIVERED',
  'CANCELLED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The only legal moves. Anything absent here is rejected by the domain,
 * so an invalid status can never be persisted.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['IN_PREP', 'CANCELLED'],
  IN_PREP: ['READY', 'CANCELLED'],
  READY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedTransitionsFrom(status: OrderStatus): readonly OrderStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export function isTerminal(status: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/**
 * The rungs a diner is shown while waiting. Fewer than the statuses above:
 * DRAFT never leaves the phone, DELIVERED sits past the last rung, and
 * CANCELLED is not progress at all, so none of them is a rung.
 */
export const TRACKING_STEPS = ['SENT', 'ACCEPTED', 'IN_PREP', 'READY'] as const;

export type TrackingStep = (typeof TRACKING_STEPS)[number];

const STEP_OF_STATUS: Record<OrderStatus, number> = {
  DRAFT: 0,
  SENT: 0,
  ACCEPTED: 1,
  IN_PREP: 2,
  READY: 3,
  // One past the last rung: every rung reads as completed.
  DELIVERED: TRACKING_STEPS.length,
  // Not on the timeline; callers branch on the status before rendering rungs.
  CANCELLED: 0,
};

/** How far along the four-rung timeline a status sits. */
export function trackingStepOf(status: OrderStatus): number {
  return STEP_OF_STATUS[status];
}
