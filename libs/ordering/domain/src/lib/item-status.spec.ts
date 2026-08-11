import { type ItemProgress, countAtLeast, orderStatusFrom } from './item-status';

const at = (itemId: string, status: ItemProgress['status']): ItemProgress => ({ itemId, status });

describe('reading an order from its dishes', () => {
  it('is SENT while nothing has been picked up', () => {
    expect(orderStatusFrom([at('a', 'SENT'), at('b', 'SENT')], 'SENT')).toBe('SENT');
  });

  it('follows the slowest dish', () => {
    // Empanadas out in six minutes, slow-roast still in the oven: the ticket
    // is not ready, and the board must not say it is.
    expect(orderStatusFrom([at('a', 'READY'), at('b', 'IN_PREP')], 'SENT')).toBe('IN_PREP');
  });

  it('is READY only once every dish is', () => {
    expect(orderStatusFrom([at('a', 'READY'), at('b', 'READY')], 'SENT')).toBe('READY');
  });

  it('is DELIVERED only once every dish has gone out', () => {
    expect(orderStatusFrom([at('a', 'DELIVERED'), at('b', 'READY')], 'SENT')).toBe('READY');
    expect(orderStatusFrom([at('a', 'DELIVERED'), at('b', 'DELIVERED')], 'SENT')).toBe('DELIVERED');
  });

  it('moves to ACCEPTED as soon as the kitchen picks one up', () => {
    expect(orderStatusFrom([at('a', 'ACCEPTED'), at('b', 'ACCEPTED')], 'SENT')).toBe('ACCEPTED');
  });

  it('ignores a cancelled dish when reading the rest', () => {
    // A dish struck off should not hold the whole ticket back.
    expect(orderStatusFrom([at('a', 'CANCELLED'), at('b', 'READY')], 'SENT')).toBe('READY');
  });

  it('is cancelled when every dish is', () => {
    expect(orderStatusFrom([at('a', 'CANCELLED'), at('b', 'CANCELLED')], 'SENT')).toBe('CANCELLED');
  });

  it('falls back for an order with no dishes recorded', () => {
    // Orders placed before per-dish tracking keep the status they were saved with.
    expect(orderStatusFrom([], 'IN_PREP')).toBe('IN_PREP');
  });
});

describe('counting progress for the diner', () => {
  const three = [at('a', 'READY'), at('b', 'IN_PREP'), at('c', 'SENT')];

  it('counts how many have reached a stage', () => {
    expect(countAtLeast(three, 'READY')).toBe(1);
    expect(countAtLeast(three, 'IN_PREP')).toBe(2);
    expect(countAtLeast(three, 'SENT')).toBe(3);
  });

  it('does not count cancelled dishes as progress', () => {
    expect(countAtLeast([at('a', 'CANCELLED'), at('b', 'READY')], 'READY')).toBe(1);
  });

  it('counts a delivered dish as having passed every earlier stage', () => {
    expect(countAtLeast([at('a', 'DELIVERED')], 'READY')).toBe(1);
  });
});
