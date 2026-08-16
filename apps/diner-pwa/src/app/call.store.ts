import { Injectable, computed, inject, signal } from '@angular/core';
import { type CallReason, type PaymentMethod } from '@itadaki/ordering/domain';
import { ApiClient } from './api-client';

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

  readonly pending = signal<readonly CallDto[]>([]);
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
          detail?.kind === 'TOO_MANY_REQUESTS'
            ? 'Esperá un momento antes de volver a llamar'
            : detail?.kind === 'SESSION_CLOSED'
              ? 'La cuenta de esta mesa ya se cerró'
              : 'No pudimos avisar. Probá de nuevo.',
        );
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
