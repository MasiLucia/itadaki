import { type Bill, type BillLine, type BillParticipant, billSubtotal, isSettled } from '@itadaki/billing/domain';
import { Money, type Result, err, ok } from '@itadaki/shared/domain';
import { type BillReader, type BillRepositoryError, type BillWriter } from './ports';
import { closeBill } from './close-bill';

/** Local fake: application must not reach into infra. */
class FakeBillStore implements BillReader, BillWriter {
  private readonly rows = new Map<string, Bill>();

  async findBySession(
    tenantId: string,
    sessionId: string,
  ): Promise<Result<Bill, BillRepositoryError>> {
    const found = this.rows.get(`${tenantId}/${sessionId}`);
    return found === undefined ? err({ kind: 'NOT_FOUND', id: sessionId }) : ok(found);
  }

  async save(tenantId: string, bill: Bill): Promise<Result<Bill, BillRepositoryError>> {
    const key = `${tenantId}/${bill.sessionId}`;
    const existing = this.rows.get(key);
    if (existing !== undefined && isSettled(existing) && bill.status !== 'SETTLED') {
      return ok(existing);
    }
    this.rows.set(key, bill);
    return ok(bill);
  }
}

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('fixture must be valid');
  return result.value;
};

const ANA: BillParticipant = { id: 'd1', nickname: 'Ana', colorIndex: 0 };
const BETO: BillParticipant = { id: 'd2', nickname: 'Beto', colorIndex: 1 };

const line = (id: string, dinerId: string, name: string, minor: number): BillLine => ({
  id,
  dinerId,
  name,
  quantity: 1,
  unitTotal: ars(minor),
});

const rates = { ratesFor: async () => [] };

const run = (store: FakeBillStore) =>
  closeBill({ bills: store, rates, newId: () => crypto.randomUUID(), now: () => new Date() });

const totalOf = (bill: Parameters<typeof billSubtotal>[0]): number => {
  const sum = billSubtotal(bill);
  if (sum.isErr()) throw new Error('expected ok');
  return sum.value.amountInMinorUnits;
};

describe('closeBill', () => {
  it('bills the whole table, not just the diner who asked', async () => {
    const store = new FakeBillStore();
    const result = await run(store)({
      tenantId: 't1',
      sessionId: 's1',
      currency: 'ARS',
      participants: [ANA, BETO],
      lines: [line('l1', 'd1', 'bife', 820_000), line('l2', 'd2', 'milanesa', 740_000)],
    });

    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.participants).toHaveLength(2);
    expect(totalOf(result.value)).toBe(1_560_000);
  });

  it('picks up a dish ordered after the bill was first asked for', async () => {
    const store = new FakeBillStore();
    const close = run(store);
    const base = {
      tenantId: 't1',
      sessionId: 's1',
      currency: 'ARS' as const,
      participants: [ANA, BETO],
    };

    await close({
      ...base,
      lines: [line('l1', 'd1', 'bife', 820_000), line('l2', 'd2', 'milanesa', 740_000)],
    });

    // The table orders dessert and asks again — the regression this covers is
    // the second call returning the stored bill and dropping the flan.
    const again = await close({
      ...base,
      lines: [
        line('l1', 'd1', 'bife', 820_000),
        line('l2', 'd2', 'milanesa', 740_000),
        line('l3', 'd1', 'flan', 260_000),
      ],
    });

    if (again.isErr()) throw new Error('expected ok');
    expect(again.value.lines).toHaveLength(3);
    expect(totalOf(again.value)).toBe(1_820_000);
  });

  it('keeps the same bill id and timestamp while it stays open', async () => {
    const store = new FakeBillStore();
    const close = run(store);
    const base = {
      tenantId: 't1',
      sessionId: 's1',
      currency: 'ARS' as const,
      participants: [ANA],
    };

    const first = await close({ ...base, lines: [line('l1', 'd1', 'bife', 820_000)] });
    const second = await close({
      ...base,
      lines: [line('l1', 'd1', 'bife', 820_000), line('l2', 'd1', 'flan', 260_000)],
    });

    if (first.isErr() || second.isErr()) throw new Error('expected ok');
    expect(second.value.id).toBe(first.value.id);
    expect(second.value.closedAt).toEqual(first.value.closedAt);
  });

  it('picks up a diner who joined after the bill was raised', async () => {
    const store = new FakeBillStore();
    const close = run(store);

    await close({
      tenantId: 't1',
      sessionId: 's1',
      currency: 'ARS',
      participants: [ANA],
      lines: [line('l1', 'd1', 'bife', 820_000)],
    });

    const again = await close({
      tenantId: 't1',
      sessionId: 's1',
      currency: 'ARS',
      participants: [ANA, BETO],
      lines: [line('l1', 'd1', 'bife', 820_000), line('l2', 'd2', 'milanesa', 740_000)],
    });

    if (again.isErr()) throw new Error('expected ok');
    expect(again.value.participants.map((p) => p.nickname)).toEqual(['Ana', 'Beto']);
  });

  it('freezes once settled, so a reprint matches what was paid', async () => {
    const store = new FakeBillStore();
    const close = run(store);
    const base = {
      tenantId: 't1',
      sessionId: 's1',
      currency: 'ARS' as const,
      participants: [ANA],
    };

    const raised = await close({ ...base, lines: [line('l1', 'd1', 'bife', 820_000)] });
    if (raised.isErr()) throw new Error('expected ok');

    await store.save('t1', { ...raised.value, status: 'SETTLED' });

    const after = await close({
      ...base,
      lines: [line('l1', 'd1', 'bife', 820_000), line('l2', 'd1', 'flan', 260_000)],
    });

    if (after.isErr()) throw new Error('expected ok');
    expect(after.value.status).toBe('SETTLED');
    expect(totalOf(after.value)).toBe(820_000);
  });

  it('bills dishes already sent to the kitchen', async () => {
    // Sending an order empties the cart. Billing from the cart alone lost
    // every dish the table had already eaten — the bill came back empty.
    const store = new FakeBillStore();
    const result = await run(store)({
      tenantId: 't1',
      sessionId: 's1',
      currency: 'ARS',
      participants: [ANA],
      lines: [line('sent-1', 'd1', 'empanadas', 340_000)],
    });

    if (result.isErr()) throw new Error('expected ok');
    expect(totalOf(result.value)).toBe(340_000);
  });

  it('adds a dish chosen but not yet sent', async () => {
    // Asking for the bill with something still in the cart is ordinary.
    const store = new FakeBillStore();
    const result = await run(store)({
      tenantId: 't1',
      sessionId: 's1',
      currency: 'ARS',
      participants: [ANA],
      lines: [
        line('sent-1', 'd1', 'empanadas', 340_000),
        line('cart-1', 'd1', 'flan', 260_000),
      ],
    });

    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.lines).toHaveLength(2);
    expect(totalOf(result.value)).toBe(600_000);
  });

  it('refuses to raise a bill for an empty table', async () => {
    const store = new FakeBillStore();
    const result = await run(store)({
      tenantId: 't1',
      sessionId: 's1',
      currency: 'ARS',
      participants: [ANA],
      lines: [],
    });

    expect(result.isErr()).toBe(true);
  });
});
