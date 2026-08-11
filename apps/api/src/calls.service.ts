import { Injectable } from '@nestjs/common';
import { PostgresCallStore } from '@itadaki/ordering/infra';
import { database } from './database';

/** Calls live in Postgres only: staff on other devices have to see them. */
@Injectable()
export class CallsService {
  readonly store = new PostgresCallStore(database);
}
