import { type Bill } from '@itadaki/billing/domain';
import { type CurrencyCode, type ExchangeRate, type Result } from '@itadaki/shared/domain';

export type BillRepositoryError =
  | { readonly kind: 'NOT_FOUND'; readonly id: string }
  | { readonly kind: 'STORAGE_FAILURE'; readonly detail: string };

export interface BillReader {
  findBySession(tenantId: string, sessionId: string): Promise<Result<Bill, BillRepositoryError>>;
}

export interface BillWriter {
  save(tenantId: string, bill: Bill): Promise<Result<Bill, BillRepositoryError>>;
}

/**
 * Supplies the rate to freeze onto a bill. Kept behind a port so the source
 * (BCRA, a provider, a manual override) can change without touching billing.
 */
export interface ExchangeRateProvider {
  ratesFor(base: CurrencyCode): Promise<readonly ExchangeRate[]>;
}
