/**
 * Free trial state for a restaurant.
 *
 * There is no billing yet, so this is deliberately small: a date, and what the
 * app should do on either side of it. Adding plans later means adding fields
 * here, not rethinking the checks scattered through the API.
 */

/** How long a new restaurant gets before the panel locks. */
export const TRIAL_DAYS = 30;

/** When the warning starts. Enough notice that the lock is never a surprise. */
export const WARN_WITHIN_DAYS = 7;

export type SubscriptionStatus =
  /** Inside the free trial, nothing restricted. */
  | 'TRIAL'
  /** Trial is nearly over; the panel warns but still works. */
  | 'TRIAL_ENDING'
  /** Trial ran out. The panel is read-only; diners are unaffected. */
  | 'EXPIRED'
  /** Paid, or granted by us. Full access. */
  | 'ACTIVE';

export interface Subscription {
  readonly status: SubscriptionStatus;
  /** Null once paid: an active subscription has no trial deadline. */
  readonly trialEndsAt: Date | null;
  /** Negative once past due; null when paid. */
  readonly daysLeft: number | null;
}

export interface TrialInput {
  readonly trialEndsAt: Date | null;
  readonly paid: boolean;
}

const DAY = 86_400_000;

/** Whole days from `now` to `deadline`; 0 means it runs out today. */
export function daysUntil(deadline: Date, now: Date): number {
  // `|| 0` normalises the -0 that Math.ceil returns just past a deadline,
  // which would otherwise reach the UI as "-0 días".
  return Math.ceil((deadline.getTime() - now.getTime()) / DAY) || 0;
}

export function trialEndFor(startedAt: Date): Date {
  return new Date(startedAt.getTime() + TRIAL_DAYS * DAY);
}

export function describeSubscription(input: TrialInput, now: Date): Subscription {
  if (input.paid) {
    return { status: 'ACTIVE', trialEndsAt: null, daysLeft: null };
  }

  // No deadline recorded — a restaurant created before trials existed. Treated
  // as active rather than locked out: never punish someone for our migration.
  if (input.trialEndsAt === null) {
    return { status: 'ACTIVE', trialEndsAt: null, daysLeft: null };
  }

  const daysLeft = daysUntil(input.trialEndsAt, now);
  const status: SubscriptionStatus =
    daysLeft <= 0 ? 'EXPIRED' : daysLeft <= WARN_WITHIN_DAYS ? 'TRIAL_ENDING' : 'TRIAL';

  return { status, trialEndsAt: input.trialEndsAt, daysLeft };
}

/**
 * Whether the restaurant may still change its own configuration.
 *
 * Only the owner's panel is gated. Diners keep ordering and the kitchen keeps
 * receiving: an expired trial must never strand a room full of people
 * mid-service, and a restaurant that gets burned that way does not come back.
 */
export function canEditConfiguration(subscription: Subscription): boolean {
  return subscription.status !== 'EXPIRED';
}
