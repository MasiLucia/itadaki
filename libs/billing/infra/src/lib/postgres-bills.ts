import { type BillReader, type BillRepositoryError, type BillWriter } from '@itadaki/billing/application';
import { type Bill } from '@itadaki/billing/domain';
import { Money, type CurrencyCode, type Result, err, ok } from '@itadaki/shared/domain';
import { type Database } from '@itadaki/shared/persistence';

interface MoneyJson {
  amountInMinorUnits: number;
  currency: string;
}

interface BillRow {
  id: string;
  session_id: string;
  currency: string;
  status: string | null;
  lines: Array<{ id: string; dinerId: string; name: string; quantity: number; unitTotal: MoneyJson }>;
  participants: Array<{ id: string; nickname: string; colorIndex: number }>;
  rates: Array<{ from: string; to: string; rate: number; source: string; capturedAt: string }>;
  closed_at: string;
}

const toMoney = (json: MoneyJson): Money =>
  Money.of(json.amountInMinorUnits, json.currency as CurrencyCode).unwrapOr(Money.zero('ARS'));

export class PostgresBillStore implements BillReader, BillWriter {
  constructor(private readonly db: Database) {}

  private toBill(row: BillRow): Bill {
    return {
      id: row.id,
      sessionId: row.session_id,
      currency: row.currency as CurrencyCode,
      // Rows written before the column existed read as open, which is the
      // safe default: an open bill recalculates, it does not overwrite history.
      status: row.status === 'SETTLED' ? 'SETTLED' : 'OPEN',
      closedAt: new Date(row.closed_at),
      participants: row.participants,
      lines: row.lines.map((line) => ({
        id: line.id,
        dinerId: line.dinerId,
        name: line.name,
        quantity: line.quantity,
        unitTotal: toMoney(line.unitTotal),
      })),
      // Rates are read back exactly as captured; the bill must not re-price.
      rates: row.rates.map((rate) => ({
        from: rate.from as CurrencyCode,
        to: rate.to as CurrencyCode,
        rate: rate.rate,
        source: rate.source,
        capturedAt: new Date(rate.capturedAt),
      })),
    };
  }

  async findBySession(
    tenantId: string,
    sessionId: string,
  ): Promise<Result<Bill, BillRepositoryError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<BillRow>('SELECT * FROM bills WHERE session_id = $1', [
          sessionId,
        ]);
        return result.rows;
      });
      const row = rows[0];
      return row === undefined ? err({ kind: 'NOT_FOUND', id: sessionId }) : ok(this.toBill(row));
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  async save(tenantId: string, bill: Bill): Promise<Result<Bill, BillRepositoryError>> {
    try {
      await this.db.withTenant(tenantId, async (client) => {
        await client.query(
          // An open bill is rewritten as the table keeps ordering. DO NOTHING
          // used to drop those updates silently, so a dessert ordered after
          // the bill was first asked for never reached the total.
          // The WHERE clause is the guard: once settled, nothing overwrites it.
          `INSERT INTO bills (tenant_id, id, session_id, currency, status, lines, participants, rates, closed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, session_id) DO UPDATE SET
             status = EXCLUDED.status,
             lines = EXCLUDED.lines,
             participants = EXCLUDED.participants
           WHERE bills.status <> 'SETTLED'`,
          [
            tenantId,
            bill.id,
            bill.sessionId,
            bill.currency,
            bill.status,
            JSON.stringify(
              bill.lines.map((line) => ({
                id: line.id,
                dinerId: line.dinerId,
                name: line.name,
                quantity: line.quantity,
                unitTotal: {
                  amountInMinorUnits: line.unitTotal.amountInMinorUnits,
                  currency: line.unitTotal.currency,
                },
              })),
            ),
            JSON.stringify(bill.participants),
            JSON.stringify(
              bill.rates.map((rate) => ({
                from: rate.from,
                to: rate.to,
                rate: rate.rate,
                source: rate.source,
                capturedAt: rate.capturedAt.toISOString(),
              })),
            ),
            bill.closedAt,
          ],
        );
      });
      return ok(bill);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }
}
