import { Injectable } from '@nestjs/common';
import { type OrderReader, type OrderWriter } from '@itadaki/ordering/application';
import { InMemoryOrderStore, PostgresOrderStore } from '@itadaki/ordering/infra';
import { database } from './database';

@Injectable()
export class OrdersService {
  readonly store: OrderReader & OrderWriter =
    process.env['USE_POSTGRES'] !== 'false'
      ? new PostgresOrderStore(database)
      : new InMemoryOrderStore();
}
