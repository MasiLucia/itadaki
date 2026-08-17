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
  /** Lo que esta persona ya mandó a la cocina, aparte de su carrito. */
  readonly placed?: { amountInMinorUnits: number; currency: string };
}

export interface SessionDto {
  readonly id: string;
  readonly tableId: string;
  readonly status: string;
  readonly currency: string;
  readonly diners: readonly SessionDiner[];
  readonly lines: readonly SessionLine[];
  readonly subtotals: readonly SessionSubtotal[];
  /**
   * El consumo acumulado de la mesa: lo que ya fue a la cocina.
   *
   * Aparte del carrito a propósito — el carrito es lo que se está armando y
   * se vacía al enviar; esto es lo que la mesa ya debe.
   */
  readonly placedTotal?: { amountInMinorUnits: number; currency: string };
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

  /** Si está abierta la hoja del QR para invitar a alguien. */
  readonly inviting = signal(false);

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

  openInvite(): void {
    this.inviting.set(true);
  }

  closeInvite(): void {
    this.inviting.set(false);
  }

  /**
   * Pide una invitación para sumar a los que llegan tarde.
   *
   * Vence en minutos, así que se pide en el momento y no se guarda: el QR se
   * dibuja, lo escanean los que llegaron, y se muere solo.
   */
  async invite(): Promise<{ url: string; expiresAt: number } | null> {
    const sessionId = this.session()?.id;
    const dinerId = this.myDinerId();
    if (sessionId === undefined || dinerId === null) return null;

    try {
      const response = await this.api.send(`/sessions/${sessionId}/invite`, 'POST', { dinerId });
      if (!response.ok) return null;

      const created = (await response.json()) as { url: string; expiresAt: string };
      return { url: created.url, expiresAt: new Date(created.expiresAt).getTime() };
    } catch {
      return null;
    }
  }

  /** Rejoins the same session after a reload so a refresh does not eject the diner. */
  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return;
      const saved = JSON.parse(raw) as { sessionId: string; dinerId: string };

      void this.refresh(saved.sessionId).then(() => {
        // A meal that already ended is not worth rejoining: restoring it puts
        // the diner straight into the "bill settled" screen with no way out.
        if (this.session()?.status === 'CLOSED') {
          this.forget();
          return;
        }

        // El comensal se marca recién con la mesa ya confirmada por el
        // servidor. Marcarlo antes daba por sentada una mesa que todavía no
        // había respondido — o que ya no existía — y el timbre aparecía sobre
        // esa mesa fantasma, dejando pedir la cuenta a quien nunca se sentó.
        if (this.session() === null) {
          this.forget();
          return;
        }

        this.myDinerId.set(saved.dinerId);
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
    const invitacion = this.table.invite();
    const restaurante = this.table.tenant();

    // Con invitación no hace falta el token: el QR de un amigo no lo lleva
    // —así la matriz queda legible— y el servidor lo emite al canjearla.
    const porInvitacion = invitacion !== null && restaurante !== null;
    if (tableToken === null && !porInvitacion) {
      this.joinError.set('escaneá el QR de tu mesa para pedir');
      return false;
    }

    // Quien ya estuvo en esta mesa vuelve con su mismo id: sin esto, cerrar
    // la pestaña la mandaba contra "ese nombre ya está en la mesa" — y el
    // único nombre que quería usar era justamente ese.
    const anterior = this.storedDinerId();

    const response = await this.api.send('/sessions/join', 'POST', {
      nickname,
      ...(tableToken === null ? {} : { tableToken }),
      ...(anterior === null ? {} : { dinerId: anterior }),
      ...(joinCode === undefined || joinCode === '' ? {} : { joinCode }),
      // Quien entra por el QR de un amigo no tiene el PIN, ni tiene por qué:
      // la invitación ya prueba que alguien de la mesa lo dejó pasar.
      ...(porInvitacion ? { invite: invitacion, tenant: restaurante } : {}),
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { kind?: string } | null;

      if (detail?.kind === 'INVITE_INVALID') {
        // Vencida, o de otra mesa. Se dice sin distinguir cuál de las dos: el
        // que llegó tarde sólo necesita pedir otra.
        this.table.invite.set(null);
        this.joinError.set('Esa invitación ya no sirve — pedile otra a tu mesa');
        return false;
      }

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
      tableToken?: string;
    };

    // Quien entró por invitación recibe acá su token de mesa: sin él, la carta
    // carga pero no puede pedir nada.
    if (created.tableToken !== undefined) {
      this.table.accept(created.tableToken);
    }

    this.myDinerId.set(created.dinerId);
    this.session.set(created.session);
    // El PIN no se guarda porque no vuelve: para sumar gente está la
    // invitación, que se pide en el momento y vale una sola vez.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sessionId: created.session.id, dinerId: created.dinerId }),
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
