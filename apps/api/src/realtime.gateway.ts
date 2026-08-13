import { Injectable } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { type CatalogEventPublisher } from '@itadaki/catalog/application';
import {
  type OrderEvent,
  type OrderEventPublisher,
  type SessionEvent,
  type SessionEventPublisher,
} from '@itadaki/ordering/application';
import { type Server, type Socket } from 'socket.io';
import { verifyToken } from '@itadaki/identity/infra';
import { InMemorySessionStore, PostgresSessionStore } from '@itadaki/ordering/infra';
import { AUTH_SECRET, resolveTableToken } from './auth';
import { database } from './database';

/** The bearer a client may present on the socket handshake. */
function bearerOf(client: Socket): string | null {
  const raw =
    client.handshake.auth?.['token'] ?? client.handshake.headers.authorization ?? '';
  if (typeof raw !== 'string' || raw === '') return null;
  return raw.startsWith('Bearer ') ? raw.slice(7) : raw;
}

// Same origin list as the HTTP API; `origin: true` would let any page open a
// socket and subscribe to a restaurant's live orders.
const WS_ORIGINS = (
  process.env['CORS_ORIGINS'] ?? 'http://localhost:4200,http://localhost:4300,http://localhost:4400,http://localhost:4500'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '');

/**
 * Fans domain events out to kitchen screens and diner devices.
 * Clients join a room per tenant, so a broadcast never crosses restaurants.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: WS_ORIGINS, credentials: true } })
export class RealtimeGateway
  implements OrderEventPublisher, CatalogEventPublisher, SessionEventPublisher
{
  @WebSocketServer()
  private server?: Server;

  /**
   * Own store rather than an injected service: the services already publish
   * through this gateway, so depending on one back would be a cycle.
   */
  private readonly sessions =
    process.env['USE_POSTGRES'] !== 'false'
      ? new PostgresSessionStore(database)
      : new InMemorySessionStore();

  /** Whether that session really belongs to the table the QR proves. */
  private async sessionBelongsTo(
    tenantId: string,
    sessionId: string,
    tableId: string,
  ): Promise<boolean> {
    const found = await this.sessions.findById(tenantId, sessionId);
    return found.isOk() && found.value.session.tableId === tableId;
  }

  /**
   * Joins the room for one restaurant, for staff only.
   *
   * The tenant comes from the caller's signed session, never from the message:
   * asking to join `tenant:X` used to be enough to watch another restaurant's
   * orders arrive in real time, with no account at all. CORS does not help
   * here — a socket opened outside a browser sends no origin.
   */
  @SubscribeMessage('join')
  handleJoin(
    @MessageBody() body: { token?: unknown },
    @ConnectedSocket() client: Socket,
  ): { joined: string } | { error: string } {
    const token = typeof body?.token === 'string' ? body.token : bearerOf(client);
    const session = token === null ? null : verifyToken(token, AUTH_SECRET, new Date());
    if (session === null) {
      return { error: 'unauthorized' };
    }

    void client.join(`tenant:${session.tenantId}`);
    return { joined: session.tenantId };
  }

  /**
   * Joins the room for one table's session.
   *
   * Diners have no account, so the signed table token stands in: it proves the
   * caller scanned that table's QR, and the session is checked to belong to
   * that same table. Knowing a session id is not enough.
   */
  @SubscribeMessage('join-session')
  async handleJoinSession(
    @MessageBody() body: { sessionId?: unknown; tableToken?: unknown },
    @ConnectedSocket() client: Socket,
  ): Promise<{ joined: string } | { error: string }> {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    if (sessionId === '') {
      return { error: 'sessionId required' };
    }

    // Staff watching a table from the floor screen is legitimate too.
    const bearer = bearerOf(client);
    const staff = bearer === null ? null : verifyToken(bearer, AUTH_SECRET, new Date());
    if (staff !== null) {
      void client.join(`session:${sessionId}`);
      return { joined: sessionId };
    }

    const tableToken = typeof body?.tableToken === 'string' ? body.tableToken : undefined;
    const table = await resolveTableToken(tableToken);
    if (table === null) {
      return { error: 'unauthorized' };
    }

    const owned = await this.sessionBelongsTo(table.tenantId, sessionId, table.tableId);
    if (!owned) {
      return { error: 'unauthorized' };
    }

    void client.join(`session:${sessionId}`);
    return { joined: sessionId };
  }

  /**
   * Kitchen screens watch the whole tenant; the table that placed the order
   * gets the same event in its own room so the tracking screen advances
   * without polling.
   */
  async orderChanged(event: OrderEvent): Promise<void> {
    this.server?.to(`tenant:${event.tenantId}`).emit('order.changed', event);
    this.server?.to(`session:${event.sessionId}`).emit('order.changed', event);
  }

  /** Scoped to the session room so only that table's phones wake up. */
  async sessionChanged(event: SessionEvent): Promise<void> {
    this.server?.to(`session:${event.sessionId}`).emit('session.changed', event);
  }

  /**
   * A table raised or cleared a call.
   *
   * Broadcast to the tenant room so any staff screen shows it, and to the
   * session room so the table's own button reflects that it went through.
   */
  async callRaised(event: {
    readonly tenantId: string;
    readonly sessionId: string;
    readonly callId: string;
  }): Promise<void> {
    this.server?.to(`tenant:${event.tenantId}`).emit('call.changed', event);
    this.server?.to(`session:${event.sessionId}`).emit('call.changed', event);
  }

  async productAvailabilityChanged(event: {
    readonly tenantId: string;
    readonly productId: string;
    readonly available: boolean;
  }): Promise<void> {
    this.server?.to(`tenant:${event.tenantId}`).emit('product.availability', event);
  }
}
