import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from './api-client';

export interface MoneyDto {
  readonly amountInMinorUnits: number;
  readonly currency: string;
}

export interface BillDto {
  readonly id: string;
  readonly sessionId: string;
  readonly currency: string;
  readonly status: 'OPEN' | 'SETTLED';
  readonly subtotal: MoneyDto;
  readonly display: MoneyDto | null;
  readonly rates: ReadonlyArray<{ to: string; rate: number; capturedAt: string }>;
  readonly participants: ReadonlyArray<{ id: string; nickname: string; colorIndex: number }>;
  readonly lines: ReadonlyArray<{
    id: string;
    dinerId: string;
    name: string;
    quantity: number;
    unitTotal: MoneyDto;
  }>;
}

export interface SplitDto {
  readonly kind: string;
  readonly subtotal: MoneyDto;
  readonly tip: MoneyDto;
  readonly total: MoneyDto;
  readonly shares: ReadonlyArray<{
    payerId: string;
    label: string;
    amount: MoneyDto;
    amountWithTip: MoneyDto;
  }>;
}

export type SplitKind = 'EQUAL' | 'BY_DINER' | 'BY_ITEM' | 'CUSTOM_AMOUNT';
export type TipChoice = { kind: 'NONE' } | { kind: 'PERCENTAGE'; percent: number };

@Injectable({ providedIn: 'root' })
export class BillStore {
  private readonly api = inject(ApiClient);

  readonly bill = signal<BillDto | null>(null);
  readonly split = signal<SplitDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  async close(sessionId: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);

    try {
      const response = await this.api.fetch(`/bills/close/${sessionId}`, { method: 'POST' });
      if (!response.ok) {
        this.error.set('no pudimos abrir la cuenta');
        return;
      }
      this.bill.set((await response.json()) as BillDto);
    } catch {
      this.error.set('sin conexión');
    } finally {
      this.busy.set(false);
    }
  }

  async load(sessionId: string, display: string): Promise<void> {
    const response = await this.api.fetch(`/bills/${sessionId}?display=${display}`);
    if (response.ok) {
      this.bill.set((await response.json()) as BillDto);
    }
  }

  /**
   * Marks the bill paid, freezing it.
   *
   * Until this lands the bill keeps re-reading the table, so anything ordered
   * after asking for it still gets charged.
   */
  // Cerrar la cuenta salió de acá: la API lo pide con permiso `orders:advance`
  // y este teléfono nunca lo tiene. Lo hace el mozo desde salón, después de
  // cobrar; desde el comensal sale el aviso, que es una llamada a la mesa.

  /** Splits are computed server-side and never persisted, so the table can try options. */
  async computeSplit(
    sessionId: string,
    kind: SplitKind,
    tip: TipChoice,
    parts?: number,
    assignments?: ReadonlyArray<{ lineId: string; payerIds: readonly string[] }>,
  ): Promise<void> {
    this.error.set(null);

    const response = await this.api.send(`/bills/${sessionId}/split`, 'POST', {
      kind,
      tip,
      parts,
      assignments,
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { kind?: string } | null;
      this.error.set(
        detail?.kind === 'UNASSIGNED_LINES'
          ? 'falta asignar algún plato'
          : detail?.kind === 'AMOUNTS_DO_NOT_MATCH'
            ? 'los montos no suman el total'
            : 'no pudimos calcular la división',
      );
      this.split.set(null);
      return;
    }

    this.split.set((await response.json()) as SplitDto);
  }
}
