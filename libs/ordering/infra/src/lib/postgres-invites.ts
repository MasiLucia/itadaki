import { type Result, err, ok } from '@itadaki/shared/domain';
import { type Database } from '@itadaki/shared/persistence';
import { randomBytes } from 'node:crypto';

export interface Invite {
  readonly code: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

export type InviteError =
  | { readonly kind: 'INVITE_INVALID' }
  | { readonly kind: 'STORAGE_FAILURE'; readonly detail: string };

/**
 * Cuánto vive una invitación.
 *
 * Sirve para toda la gente que llegue mientras esté vigente, no para una sola
 * persona: en un cumpleaños entra uno primero y van cayendo veinte, y un QR
 * por invitado es inusable. Quien la muestra la tiene en la mano y la ve
 * vencer, así que puede generar otra cuando haga falta.
 *
 * Quince minutos cubre a un grupo que va llegando de a poco sin dejar la
 * puerta abierta toda la cena. Lo que la limita de verdad no es el reloj sino
 * el techo de la mesa: cuando se llena, no entra nadie más.
 */
export const INVITE_MINUTES = 15;

/**
 * El código de la invitación.
 *
 * No son seis dígitos como el PIN: este viaja adentro de un QR y nadie lo
 * escribe a mano, así que puede ser largo. 128 bits en base64url no se
 * adivinan probando, que es lo que sí habría que cuidar con algo corto.
 */
function newInviteCode(): string {
  return randomBytes(16).toString('base64url');
}

export class PostgresInviteStore {
  constructor(private readonly db: Database) {}

  async create(
    tenantId: string,
    sessionId: string,
    invitedBy: string,
    now: Date,
  ): Promise<Result<Invite, InviteError>> {
    try {
      const code = newInviteCode();
      const expiresAt = new Date(now.getTime() + INVITE_MINUTES * 60_000);

      await this.db.withTenant(tenantId, async (client) => {
        await client.query(
          `INSERT INTO session_invites (tenant_id, code, session_id, invited_by, expires_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [tenantId, code, sessionId, invitedBy, expiresAt],
        );
      });

      return ok({ code, sessionId, expiresAt });
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  /**
   * Canjea una invitación, si sigue vigente.
   *
   * Vale para todos los que lleguen dentro de su ventana, no para uno solo:
   * quien la muestra levanta el teléfono una vez y se suma la mesa entera.
   * `used_at` guarda la última vez que se usó — sirve para reconstruir cómo
   * entró cada uno si alguna vez hay que revisar una mesa, y no decide nada.
   *
   * Lo único que la corta es el vencimiento. Y detrás está el techo de la
   * mesa: con veinte sentados, la invitación deja de servirle a nadie.
   *
   * Devolver el mismo error para vencida e inexistente es deliberado: quien
   * prueba códigos no aprende cuáles existieron.
   */
  async redeem(
    tenantId: string,
    code: string,
    now: Date,
  ): Promise<Result<string, InviteError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<{ session_id: string }>(
          `UPDATE session_invites
              SET used_at = $3
            WHERE code = $2
              AND tenant_id = $1
              AND expires_at > $3
        RETURNING session_id`,
          [tenantId, code, now],
        );
        return result.rows;
      });

      const row = rows[0];
      return row === undefined ? err({ kind: 'INVITE_INVALID' }) : ok(row.session_id);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }

  /**
   * Borra las que ya no sirven.
   *
   * Una por invitado y por mesa se acumulan rápido, y ninguna vale nada después
   * de vencer. Corre con el barrido de sesiones abandonadas.
   */
  async purgeExpired(now: Date): Promise<Result<number, InviteError>> {
    try {
      const deleted = await this.db.unscoped(async (client) => {
        const tenants = await client.query<{ id: string }>('SELECT id FROM tenants WHERE active');

        let total = 0;
        for (const row of tenants.rows) {
          await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', row.id]);
          const result = await client.query('DELETE FROM session_invites WHERE expires_at < $1', [
            now,
          ]);
          total += result.rowCount ?? 0;
        }
        return total;
      });

      return ok(deleted);
    } catch (error) {
      return err({ kind: 'STORAGE_FAILURE', detail: String(error) });
    }
  }
}
