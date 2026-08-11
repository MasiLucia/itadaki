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

  /** A client must join before it receives anything. */
  @SubscribeMessage('join')
  handleJoin(
    @MessageBody() body: { tenantId?: unknown },
    @ConnectedSocket() client: Socket,
  ): { joined: string } | { error: string } {
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : '';
    if (tenantId === '') {
      return { error: 'tenantId required' };
    }
    void client.join(`tenant:${tenantId}`);
    return { joined: tenantId };
  }

  @SubscribeMessage('join-session')
  handleJoinSession(
    @MessageBody() body: { sessionId?: unknown },
    @ConnectedSocket() client: Socket,
  ): { joined: string } | { error: string } {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    if (sessionId === '') {
      return { error: 'sessionId required' };
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
