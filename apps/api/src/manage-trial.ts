import 'reflect-metadata';
import { TRIAL_DAYS, describeSubscription, trialEndFor } from '@itadaki/identity/domain';
import { Client } from 'pg';

/**
 * Trial administration, until there is billing.
 *
 * Usage:
 *   manage-trial list                    every restaurant and where it stands
 *   manage-trial extend <slug> [días]    push the deadline out (default 30)
 *   manage-trial pay <slug>              mark as paid, no deadline
 *   manage-trial unpay <slug>            back onto a trial
 */
const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgres://itadaki:itadaki@localhost:5433/itadaki';

interface Row {
  slug: string;
  name: string;
  trial_ends_at: string | null;
  paid: boolean;
}

const LABELS: Record<string, string> = {
  ACTIVE: 'pago/activo',
  TRIAL: 'en prueba',
  TRIAL_ENDING: 'por vencer',
  EXPIRED: 'VENCIDO',
};

async function main(): Promise<void> {
  const [command, slug, amount] = process.argv.slice(2);
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();

  try {
    if (command === undefined || command === 'list') {
      const { rows } = await client.query<Row>(
        'SELECT slug, name, trial_ends_at, paid FROM tenants ORDER BY created_at',
      );

      for (const row of rows) {
        const state = describeSubscription(
          {
            trialEndsAt: row.trial_ends_at === null ? null : new Date(row.trial_ends_at),
            paid: row.paid,
          },
          new Date(),
        );
        const days = state.daysLeft === null ? '' : ` (${state.daysLeft} días)`;
        console.log(
          `  ${row.slug.padEnd(24)} ${(LABELS[state.status] ?? state.status).padEnd(12)}${days}  ${row.name}`,
        );
      }
      return;
    }

    if (slug === undefined) {
      console.error('falta el slug del restaurante');
      process.exit(1);
    }

    if (command === 'extend') {
      const days = Number(amount ?? TRIAL_DAYS);
      const until = trialEndFor(new Date());
      until.setTime(Date.now() + days * 86_400_000);

      const result = await client.query(
        'UPDATE tenants SET trial_ends_at = $2, paid = false WHERE slug = $1',
        [slug, until],
      );
      console.log(
        result.rowCount === 0
          ? `no existe ${slug}`
          : `${slug}: prueba extendida ${days} días (hasta ${until.toLocaleDateString('es-AR')})`,
      );
      return;
    }

    if (command === 'pay' || command === 'unpay') {
      const paid = command === 'pay';
      const result = await client.query('UPDATE tenants SET paid = $2 WHERE slug = $1', [
        slug,
        paid,
      ]);
      console.log(
        result.rowCount === 0
          ? `no existe ${slug}`
          : `${slug}: ${paid ? 'marcado como pago' : 'vuelto a prueba'}`,
      );
      return;
    }

    console.error(`comando desconocido: ${command}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error('falló:', error);
  process.exit(1);
});
