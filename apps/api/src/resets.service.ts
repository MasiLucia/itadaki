import { Injectable } from '@nestjs/common';
import { ConsoleMailer, type Mailer } from '@itadaki/identity/application';
import { PostgresResetStore, ResendMailer } from '@itadaki/identity/infra';
import { database } from './database';
import { log } from './logger';

/**
 * Composition point for password resets.
 *
 * Uses the real provider when one is configured and falls back to the console
 * otherwise, so a local install keeps working without credentials. In
 * production the fallback is refused outright: a reset flow that silently
 * prints the link to a server log looks like it works, and the person
 * locked out of their own restaurant never receives anything.
 */
@Injectable()
export class ResetsService {
  readonly store = new PostgresResetStore(database);
  readonly mailer: Mailer = resolveMailer();
}

function resolveMailer(): Mailer {
  const configured = ResendMailer.fromEnvironment();
  if (configured !== null) return configured;

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'RESEND_API_KEY y MAIL_FROM son obligatorios en producción: sin ellos nadie recibe el link para recuperar su contraseña',
    );
  }

  log.warn('sin proveedor de correo — los links de recuperación salen por el log');
  return new ConsoleMailer();
}
