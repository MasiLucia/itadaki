import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { type CallReason, type PaymentMethod } from '@itadaki/ordering/domain';
import { ApiClient } from './api-client';
import { SessionStore } from './session.store';

export interface CallDto {
  readonly id: string;
  readonly reason: CallReason;
  readonly status: string;
  readonly note: string;
  readonly paymentMethod: PaymentMethod | null;
  readonly raisedAt: string;
}

/**
 * What this table has asked for and is still waiting on.
 *
 * Kept server-side rather than in local state: the same table on a second
 * phone has to see that someone already called, or the staff screen fills up
 * with the same request from every device.
 */
@Injectable({ providedIn: 'root' })
export class CallStore {
  private readonly api = inject(ApiClient);
  private readonly session = inject(SessionStore);

  readonly pending = signal<readonly CallDto[]>([]);

  /** La sesión de la que son los llamados que están en memoria. */
  private loadedFor: string | null = null;

  constructor() {
    /**
     * Los llamados son de una mesa, no del teléfono.
     *
     * Este servicio vive mientras la pestaña esté abierta, así que la mesa que
     * el mozo cobró dejaba su timbre encendido para la mesa siguiente: se
     * volvía a entrar desde la misma pestaña y aparecía el llamado de la gente
     * anterior. Desde otra pestaña no pasaba, porque ahí el servicio nacía
     * vacío — de ahí que pareciera cache.
     */
    effect(() => {
      const sessionId = this.session.session()?.id ?? null;
      if (sessionId === this.loadedFor) return;

      this.loadedFor = sessionId;
      this.pending.set([]);
      this.error.set(null);
      if (sessionId !== null) void this.load(sessionId);
    });

    // El salón atiende el llamado y el timbre se apaga solo: sin esto había
    // que abrir la hoja para que se enterara.
    this.session.onCallChanged(() => {
      const sessionId = this.session.session()?.id;
      if (sessionId !== undefined) void this.load(sessionId);
    });
  }

  /** Lo que el servidor rechaza, dicho en la mesa y no en código de error. */
  private static readonly MENSAJES: Readonly<Record<string, string>> = {
    TOO_MANY_REQUESTS: 'Esperá un momento antes de volver a llamar',
    SESSION_CLOSED: 'La cuenta de esta mesa ya se cerró',
    NOTHING_ORDERED: 'Todavía no pidieron nada',
    ALREADY_CALLING: 'Ya hay un llamado en curso en esta mesa',
  };
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly waitingFor = computed(() => new Set(this.pending().map((call) => call.reason)));

  /** El llamado abierto de ese tipo, para poder cancelarlo. */
  callFor(reason: CallReason): CallDto | null {
    return this.pending().find((call) => call.reason === reason) ?? null;
  }

  /**
   * Deshace un llamado que la mesa no quiso hacer.
   *
   * Tocar por error el timbre manda al mozo a caminar sin motivo, y sin esto
   * la única salida era esperar a que llegara para decirle que no hacía falta.
   */
  async cancel(sessionId: string, reason: CallReason): Promise<boolean> {
    const call = this.callFor(reason);
    if (call === null) return false;

    this.busy.set(true);
    this.error.set(null);

    try {
      const response = await this.api.send(`/calls/${sessionId}/${call.id}/cancel`, 'PATCH', {});
      if (!response.ok) {
        this.error.set('No pudimos cancelar. Probá de nuevo.');
        return false;
      }
      await this.load(sessionId);
      return true;
    } catch {
      this.error.set('Sin conexión');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async load(sessionId: string): Promise<void> {
    try {
      const response = await this.api.fetch(`/calls/${sessionId}`);
      if (!response.ok) return;
      this.pending.set((await response.json()) as CallDto[]);
    } catch {
      // Keep the last known state; the socket or next tap retries.
    }
  }

  /**
   * Raises a call. The API returns the existing one if the table already has
   * that request open, so tapping twice is harmless.
   */
  async raise(
    sessionId: string,
    reason: CallReason,
    note = '',
    paymentMethod?: PaymentMethod,
  ): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);

    try {
      const response = await this.api.send(`/calls/${sessionId}`, 'POST', {
        reason,
        note,
        ...(paymentMethod === undefined ? {} : { paymentMethod }),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { kind?: string } | null;
        this.error.set(
          CallStore.MENSAJES[detail?.kind ?? ''] ?? 'No pudimos avisar. Probá de nuevo.',
        );

        // El servidor sabe algo que la pantalla no: otro teléfono de la mesa
        // llamó primero, o el pedido se canceló mientras esta hoja estaba
        // abierta. Recargar deja los botones como corresponde.
        if (detail?.kind === 'ALREADY_CALLING' || detail?.kind === 'NOTHING_ORDERED') {
          await this.load(sessionId);
        }
        return false;
      }

      await this.load(sessionId);
      return true;
    } catch {
      this.error.set('Sin conexión');
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
