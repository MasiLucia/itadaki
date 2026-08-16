import { Injectable, computed, inject, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import { ApiClient } from './api-client';
import { WS_URL } from './catalog.tokens';
import { TableTokenStore } from './table-token.store';

export interface SessionDiner {
  readonly id: string;
  readonly nickname: string;
  readonly colorIndex: number;
}

export interface SessionLine {
  readonly id: string;
  readonly dinerId: string;
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly notes: string;
  readonly unitPrice: { amountInMinorUnits: number; currency: string };
  readonly modifiers: ReadonlyArray<{ name: string; priceDelta: { amountInMinorUnits: number } }>;
}

export interface SessionSubtotal {
  readonly dinerId: string;
  readonly nickname: string;
  readonly colorIndex: number;
  readonly subtotal: { amountInMinorUnits: number; currency: string };
}

export interface SessionDto {
  readonly id: string;
  readonly tableId: string;
  readonly status: string;
  readonly currency: string;
  readonly diners: readonly SessionDiner[];
  readonly lines: readonly SessionLine[];
  readonly subtotals: readonly SessionSubtotal[];
}

const STORAGE_KEY = 'itadaki.session';

/**
 * Holds the shared table session. Every change is re-fetched rather than
 * patched locally: a missed socket event must never leave one phone showing
 * a different cart from the rest of the table.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly api = inject(ApiClient);
  private readonly wsUrl = inject(WS_URL);
  private readonly table = inject(TableTokenStore);
  private socket: Socket | null = null;
  private readonly orderListeners = new Set<() => void>();

  readonly session = signal<SessionDto | null>(null);
  readonly myDinerId = signal<string | null>(null);
  readonly connected = signal(false);
  readonly joinError = signal<string | null>(null);

  /**
   * El código de esta mesa, para poder decírselo a quien llega después.
   *
   * Sólo lo tiene quien ya entró: la API lo manda una vez, al unirse, a quien
   * acaba de demostrar que lo conocía. Nunca en la lectura de la sesión — esa
   * está detrás del token de la mesa, que es exactamente lo que el código
   * protege.
   */
  readonly joinCode = signal<string | null>(null);

  readonly isJoined = computed(() => this.session() !== null && this.myDinerId() !== null);

  /**
   * El número de la mesa como está impreso en el cartelito, o `null`.
   *
   * Acá y no en cada pantalla: la carta, el carrito, el estado y la cuenta lo
   * muestran en su cabecera, y hasta ahora las cuatro decían "mesa 07" escrito
   * a mano. En un salón real cada teléfono está en una mesa distinta.
   *
   * `null` mientras no haya sesión: no se sabe la mesa hasta escanear el QR, y
   * mostrar cualquier número inventado es peor que no mostrar ninguno.
   */
  readonly tableLabel = computed(() => {
    const tableId = this.session()?.tableId;
    // El id viaja como "mesa-01"; del cartel sólo cuelga el número.
    if (tableId !== undefined) return /(\d+)\s*$/.exec(tableId)?.[1] ?? tableId;

    // Sin sesión todavía, el QR ya trae la mesa: así la primera pantalla
    // saluda con el número correcto en vez de esperar a que alguien se una.
    return this.table.tableLabel();
  });
  readonly others = computed(() =>
    (this.session()?.diners ?? []).filter((diner) => diner.id !== this.myDinerId()),
  );
  readonly myLines = computed(() =>
    (this.session()?.lines ?? []).filter((line) => line.dinerId === this.myDinerId()),
  );

  constructor() {
    this.restore();
  }

  /** Quién fue esta persona en esta mesa, si ya estuvo. */
  private storedDinerId(): string | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      return (JSON.parse(raw) as { dinerId?: string }).dinerId ?? null;
    } catch {
      return null;
    }
  }

  /** Rejoins the same session after a reload so a refresh does not eject the diner. */
  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return;
      const saved = JSON.parse(raw) as {
        sessionId: string;
        dinerId: string;
        joinCode?: string | null;
      };
      this.myDinerId.set(saved.dinerId);
      this.joinCode.set(saved.joinCode ?? null);

      void this.refresh(saved.sessionId).then(() => {
        // A meal that already ended is not worth rejoining: restoring it puts
        // the diner straight into the "bill settled" screen with no way out.
        if (this.session()?.status === 'CLOSED') {
          this.forget();
          return;
        }
        this.listen(saved.sessionId);
      });
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  /**
   * Drops the stored table without telling the server.
   *
   * Used when the session is over: leaving it behind would make every reload
   * land on the closed-table screen.
   */
  forget(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.session.set(null);
    this.myDinerId.set(null);
    localStorage.removeItem(STORAGE_KEY);
    this.api.unblock();
  }

  async join(nickname: string, joinCode?: string): Promise<boolean> {
    this.joinError.set(null);
    // Scanning a fresh QR is the way out of an expired or settled table.
    this.api.unblock();

    const tableToken = this.table.token();
    if (tableToken === null) {
      this.joinError.set('escaneá el QR de tu mesa para pedir');
      return false;
    }

    // Quien ya estuvo en esta mesa vuelve con su mismo id: sin esto, cerrar
    // la pestaña la mandaba contra "ese nombre ya está en la mesa" — y el
    // único nombre que quería usar era justamente ese.
    const anterior = this.storedDinerId();

    const response = await this.api.send('/sessions/join', 'POST', {
      tableToken,
      nickname,
      ...(anterior === null ? {} : { dinerId: anterior }),
      ...(joinCode === undefined || joinCode === '' ? {} : { joinCode }),
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { kind?: string } | null;

      if (detail?.kind === 'WRONG_JOIN_CODE') {
        this.joinError.set(
          joinCode === undefined || joinCode === ''
            ? 'Pedile el código de la mesa al mozo'
            : 'Ese código no es el de esta mesa',
        );
        return false;
      }

      this.joinError.set(
        detail?.kind === 'NICKNAME_TAKEN'
          ? 'Ese nombre ya está en la mesa — probá otro'
          : detail?.kind === 'TABLE_FULL'
            ? 'La mesa está completa'
            : detail?.kind === 'INVALID_TABLE_TOKEN'
              ? 'El código de la mesa venció — escaneá el QR de nuevo'
              : 'No pudimos unirte a la mesa',
      );
      return false;
    }

    const created = (await response.json()) as {
      dinerId: string;
      session: SessionDto;
      joinCode: string | null;
    };
    this.myDinerId.set(created.dinerId);
    this.session.set(created.session);
    this.joinCode.set(created.joinCode);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessionId: created.session.id,
        dinerId: created.dinerId,
        // Guardado para que recargar no lo pierda: es lo que esta persona le
        // dice al que llega tarde, y la API sólo lo manda al entrar.
        joinCode: created.joinCode,
      }),
    );

    this.listen(created.session.id);
    return true;
  }

  private listen(sessionId: string): void {
    this.socket?.disconnect();
    this.socket = io(this.wsUrl, { transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      this.connected.set(true);
      // The QR proves which table this is; knowing a session id is not
      // enough to listen in on someone else's table.
      this.socket?.emit('join-session', { sessionId, tableToken: this.table.token() ?? '' });
      void this.refresh(sessionId);
      this.orderListeners.forEach((notify) => notify());
    });
    this.socket.on('disconnect', () => this.connected.set(false));
    this.socket.on('session.changed', () => void this.refresh(sessionId));
    this.socket.on('order.changed', () => this.orderListeners.forEach((notify) => notify()));
  }

  /**
   * Lets the tracking screen ride this socket instead of opening a second one.
   * Fires on reconnect too, so an event missed while offline is recovered.
   */
  onOrderChanged(listener: () => void): () => void {
    this.orderListeners.add(listener);
    return () => this.orderListeners.delete(listener);
  }

  async refresh(sessionId: string): Promise<void> {
    try {
      const response = await this.api.fetch(`/sessions/${sessionId}`);
      if (!response.ok) return;
      this.session.set((await response.json()) as SessionDto);
    } catch {
      // Keep the last known table; the next event or reconnect retries.
    }
  }

  async addLine(productId: string, quantity: number, notes: string, modifierIds: readonly string[]): Promise<boolean> {
    const current = this.session();
    const dinerId = this.myDinerId();
    if (current === null || dinerId === null) return false;

    const response = await this.api.send(`/sessions/${current.id}/lines`, 'POST', {
      dinerId,
      productId,
      quantity,
      notes,
      modifierIds,
    });

    if (!response.ok) return false;
    this.session.set((await response.json()) as SessionDto);
    return true;
  }

  async changeLine(lineId: string, quantity: number): Promise<void> {
    const current = this.session();
    const dinerId = this.myDinerId();
    if (current === null || dinerId === null) return;

    const response = await this.api.send(`/sessions/${current.id}/lines/${lineId}`, 'PATCH', {
      dinerId,
      quantity,
    });

    if (response.ok) {
      this.session.set((await response.json()) as SessionDto);
    }
  }

  leave(): void {
    const current = this.session();
    const dinerId = this.myDinerId();
    if (current !== null && dinerId !== null) {
      void this.api.send(`/sessions/${current.id}/leave`, 'POST', { dinerId });
    }

    this.socket?.disconnect();
    this.socket = null;
    this.session.set(null);
    this.myDinerId.set(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  /** Only the diner who added a line may change it. */
  ownsLine(line: SessionLine): boolean {
    return line.dinerId === this.myDinerId();
  }
}
