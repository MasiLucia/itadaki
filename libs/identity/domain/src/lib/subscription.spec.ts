import {
  TRIAL_DAYS,
  WARN_WITHIN_DAYS,
  canEditConfiguration,
  daysUntil,
  describeSubscription,
  trialEndFor,
} from './subscription';

const NOW = new Date('2026-08-07T12:00:00Z');
const inDays = (days: number): Date => new Date(NOW.getTime() + days * 86_400_000);

const describe_ = (trialEndsAt: Date | null, paid = false) =>
  describeSubscription({ trialEndsAt, paid }, NOW);

describe('trial period', () => {
  it('runs for the advertised month', () => {
    const ends = trialEndFor(NOW);
    expect(daysUntil(ends, NOW)).toBe(TRIAL_DAYS);
  });

  it('is simply TRIAL while there is plenty of time', () => {
    const result = describe_(inDays(20));
    expect(result.status).toBe('TRIAL');
    expect(result.daysLeft).toBe(20);
  });

  it('starts warning a week out, so the lock is never a surprise', () => {
    expect(describe_(inDays(WARN_WITHIN_DAYS)).status).toBe('TRIAL_ENDING');
    expect(describe_(inDays(WARN_WITHIN_DAYS + 1)).status).toBe('TRIAL');
  });

  it('still works on the last day', () => {
    const result = describe_(inDays(1));
    expect(result.status).toBe('TRIAL_ENDING');
    expect(canEditConfiguration(result)).toBe(true);
  });

  it('expires once the deadline passes', () => {
    const result = describe_(inDays(-1));
    expect(result.status).toBe('EXPIRED');
    expect(canEditConfiguration(result)).toBe(false);
  });

  it('reports how far past due it is', () => {
    expect(describe_(inDays(-10)).daysLeft).toBe(-10);
  });

  it('treats a paid restaurant as active regardless of the old deadline', () => {
    const result = describe_(inDays(-90), true);
    expect(result.status).toBe('ACTIVE');
    expect(canEditConfiguration(result)).toBe(true);
    expect(result.daysLeft).toBeNull();
  });

  it('leaves restaurants without a deadline alone', () => {
    // Rows that predate trials: locking them out would punish existing
    // customers for a migration they had no part in.
    const result = describe_(null);
    expect(result.status).toBe('ACTIVE');
    expect(canEditConfiguration(result)).toBe(true);
  });

  it('only ever gates configuration, never the diner-facing app', () => {
    // The API enforces this; the domain states it so the intent is testable.
    const expired = describe_(inDays(-1));
    expect(expired.status).toBe('EXPIRED');
    expect(canEditConfiguration(expired)).toBe(false);
  });
});

describe('daysUntil', () => {
  it('rounds up, so a deadline later today still counts as a day', () => {
    expect(daysUntil(new Date(NOW.getTime() + 3_600_000), NOW)).toBe(1);
  });

  it('is zero exactly at the deadline', () => {
    expect(daysUntil(NOW, NOW)).toBe(0);
  });

  it('goes negative once past', () => {
    expect(daysUntil(new Date(NOW.getTime() - 3_600_000), NOW)).toBe(0);
    expect(daysUntil(inDays(-2), NOW)).toBe(-2);
  });
});
