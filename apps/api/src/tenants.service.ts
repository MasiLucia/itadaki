import { Injectable } from '@nestjs/common';
import { PostgresTenantStore } from '@itadaki/identity/infra';
import { database } from './database';

/** Signup writes to real tables, so there is no in-memory variant. */
@Injectable()
export class TenantsService {
  readonly store = new PostgresTenantStore(database);
}
