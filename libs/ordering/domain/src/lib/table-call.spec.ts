import {
  CALL_REASONS,
  PAYMENT_METHODS,
  needsCardReader,
  type TableCall,
  acknowledge,
  alreadyWaiting,
  isPending,
  minutesWaiting,
} from './table-call';

const AT = new Date('2026-08-09T21:00:00Z');

const call = (overrides: Partial<TableCall> = {}): TableCall => ({
  id: 'c1',
  tenantId: 't1',
  sessionId: 's1',
  tableId: 'mesa-7',
  reason: 'WAITER',
  status: 'PENDING',
  note: '',
  paymentMethod: null,
  raisedAt: AT,
  acknowledgedAt: null,
  ...overrides,
});

describe('table calls', () => {
  it('offers the three reasons a table actually has', () => {
    expect([...CALL_REASONS]).toEqual(['WAITER', 'BILL', 'QUESTION']);
  });

  it('starts out waiting for someone', () => {
    expect(isPending(call())).toBe(true);
  });

  it('stops waiting once staff acknowledge it', () => {
    const handled = acknowledge(call(), new Date(AT.getTime() + 60_000));
    expect(isPending(handled)).toBe(false);
    expect(handled.acknowledgedAt).not.toBeNull();
  });

  it('counts how long the table has been waiting', () => {
    expect(minutesWaiting(call(), new Date(AT.getTime() + 5 * 60_000))).toBe(5);
  });

  it('reads as zero minutes the moment it is raised', () => {
    expect(minutesWaiting(call(), AT)).toBe(0);
  });

  it('finds the call a table is already waiting on', () => {
    // Tapping twice must not stack two identical rows on the staff screen.
    const existing = alreadyWaiting([call()], 's1', 'WAITER');
    expect(existing?.id).toBe('c1');
  });

  it('lets a table ask for something else while one call is open', () => {
    // Waiting on a waiter should not stop them asking for the bill.
    expect(alreadyWaiting([call()], 's1', 'BILL')).toBeNull();
  });

  it('ignores calls from another table', () => {
    expect(alreadyWaiting([call()], 's2', 'WAITER')).toBeNull();
  });

  it('lets a table call again once the first was handled', () => {
    const handled = acknowledge(call(), AT);
    expect(alreadyWaiting([handled], 's1', 'WAITER')).toBeNull();
  });
});

describe('how the table means to pay', () => {
  it('offers the three answers a table can give', () => {
    expect([...PAYMENT_METHODS]).toEqual(['CARD', 'CASH', 'UNDECIDED']);
  });

  it('tells the waiter to bring the card reader', () => {
    // The point of asking: walking over without it means a second trip.
    expect(needsCardReader(call({ reason: 'BILL', paymentMethod: 'CARD' }))).toBe(true);
  });

  it('leaves the reader behind for cash', () => {
    expect(needsCardReader(call({ reason: 'BILL', paymentMethod: 'CASH' }))).toBe(false);
  });

  it('leaves the reader behind when the table has not decided', () => {
    expect(needsCardReader(call({ reason: 'BILL', paymentMethod: 'UNDECIDED' }))).toBe(false);
  });

  it('ignores a payment method on a call that is not about the bill', () => {
    // Nothing stops the field being set; the question is what it means.
    expect(needsCardReader(call({ reason: 'WAITER', paymentMethod: 'CARD' }))).toBe(false);
  });

  it('handles an older call with no method recorded', () => {
    expect(needsCardReader(call({ reason: 'BILL', paymentMethod: null }))).toBe(false);
  });
});
