import { Injectable } from '@nestjs/common';
import { ConsoleMailer, type Mailer } from '@itadaki/identity/application';
import { PostgresResetStore } from '@itadaki/identity/infra';
import { database } from './database';

/**
 * Composition point for password resets.
 *
 * The mailer is a console adapter until a provider is configured — swapping it
 * for Resend or SendGrid is a change here and nowhere else.
 */
@Injectable()
export class ResetsService {
  readonly store = new PostgresResetStore(database);
  readonly mailer: Mailer = new ConsoleMailer();
}
