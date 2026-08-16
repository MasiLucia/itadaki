import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type SessionReader, type SessionWriter } from '@itadaki/ordering/application';
import {
  InMemorySessionStore,
  PostgresInviteStore,
  PostgresSessionStore,
} from '@itadaki/ordering/infra';
import { database } from './database';
import { log } from './logger';

/**
 * Cuánto puede quedar abierta una mesa antes de darla por abandonada.
 *
 * Más que cualquier comida real: cerrar una mesa mientras la gente todavía
 * come le borra el carrito, que es mucho peor que liberarla una hora tarde.
 * Tres horas cubre una sobremesa larga y devuelve la mesa el mismo turno —
 * ocho la dejaban ocupada hasta la madrugada.
 *
 * Es la red de seguridad, no el camino normal: la mesa se libera sola al
 * cerrar la cuenta, y el mozo puede liberarla a mano cuando pagaron en caja.
 */
const STALE_AFTER_HOURS = Number(process.env['SESSION_STALE_HOURS'] ?? 3);
const SWEEP_EVERY_MS = 30 * 60_000;

@Injectable()
export class SessionsService implements OnModuleInit, OnModuleDestroy {
  readonly store: SessionReader & SessionWriter =
    process.env['USE_POSTGRES'] !== 'false'
      ? new PostgresSessionStore(database)
      : new InMemorySessionStore();

  readonly invites = new PostgresInviteStore(database);

  private sweeper: ReturnType<typeof setInterval> | null = null;

  onModuleInit(): void {
    if (!(this.store instanceof PostgresSessionStore)) return;

    // A group that leaves without asking for the bill would otherwise hold its
    // table forever — only one session per table may be OPEN at a time.
    void this.sweep();
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    // Never keep the process alive just for the sweep.
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweeper !== null) clearInterval(this.sweeper);
  }

  private async sweep(): Promise<void> {
    if (!(this.store instanceof PostgresSessionStore)) return;

    const closed = await this.store.closeStale(STALE_AFTER_HOURS);
    if (closed.isOk() && closed.value > 0) {
      log.info('abandoned sessions closed', { closed: closed.value });
    }

    // Las invitaciones vencidas no sirven para nada y se acumulan de a una por
    // invitado. Van con el mismo barrido para no tener dos relojes corriendo.
    const purged = await this.invites.purgeExpired(new Date());
    if (purged.isOk() && purged.value > 0) {
      log.info('expired invites purged', { purged: purged.value });
    }
  }
}
