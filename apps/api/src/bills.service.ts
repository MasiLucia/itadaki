import { Injectable } from '@nestjs/common';
import {
  type BillReader,
  type BillWriter,
  type ExchangeRateProvider,
} from '@itadaki/billing/application';
import { InMemoryBillStore, PostgresBillStore, StaticExchangeRates } from '@itadaki/billing/infra';
import { database } from './database';

@Injectable()
export class BillsService {
  readonly store: BillReader & BillWriter =
    process.env['USE_POSTGRES'] !== 'false'
      ? new PostgresBillStore(database)
      : new InMemoryBillStore();

  readonly rates: ExchangeRateProvider = new StaticExchangeRates();
}
