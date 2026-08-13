import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type SessionReader, type SessionWriter } from '@itadaki/ordering/application';
import { InMemorySessionStore, PostgresSessionStore } from '@itadaki/ordering/infra';
import { database } from './database';
import { log } from './logger';

/**
 * How long a table may sit open before it is considered abandoned.
 *
 * Longer than any real meal: closing a session while people are still eating
 * would lose their cart, which is far worse than a table freed an hour late.
 */
const STALE_AFTER_HOURS = Number(process.env['SESSION_STALE_HOURS'] ?? 8);
const SWEEP_EVERY_MS = 30 * 60_000;

@Injectable()
export class SessionsService implements OnModuleInit, OnModuleDestroy {
  readonly store: SessionReader & SessionWriter =
    process.env['USE_POSTGRES'] !== 'false'
      ? new PostgresSessionStore(database)
      : new InMemorySessionStore();

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
  }
}
