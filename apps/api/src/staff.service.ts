import { Injectable } from '@nestjs/common';
import { PostgresStaffStore } from '@itadaki/identity/infra';
import { database } from './database';

@Injectable()
export class StaffService {
  readonly store = new PostgresStaffStore(database);
}
