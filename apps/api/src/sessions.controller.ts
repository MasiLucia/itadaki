import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  addToSharedCart,
  changeSharedLine,
  joinTable,
  closeTable,
  leaveTable,
  listUnsettledTables,
  type SessionState,
} from '@itadaki/ordering/application';
import { groupByDiner } from '@itadaki/ordering/domain';
import { z } from 'zod';
import {
  type DinerScope,
  Public,
  RequirePermission,
  Scope,
  TableScoped,
  TenantId,
  resolveTableToken,
} from './auth';
import { RateLimit } from './rate-limit.guard';
import { CatalogService } from './catalog.service';
import { OrdersService } from './orders.service';
import { RealtimeGateway } from './realtime.gateway';
import { SessionsService } from './sessions.service';
import { toMoneyDto, toOrderDto } from './contracts';

const joinSchema = z.object({
  /** Signed by the table's own secret; carries both tenant and table. */
  tableToken: z.string().min(1).max(2000),
  nickname: z.string().min(1).max(20),
  /**
   * Quien vuelve a la misma mesa, guardado en su teléfono.
   *
   * Sólo se acepta si esa persona sigue sentada acá: inventar un id ajeno no
   * da acceso a nada, porque se compara contra los que ya están en la mesa.
   */
  dinerId: z.string().min(1).max(64).optional(),
});

const addSchema = z.object({
  dinerId: z.string().min(1).max(64),
  productId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(99),
  notes: z.string().max(280).default(''),
  modifierIds: z.array(z.string().min(1).max(64)).max(10).default([]),
});

const changeSchema = z.object({
  dinerId: z.string().min(1).max(64),
  quantity: z.number().int().min(0).max(99),
});

function toSessionDto(state: SessionState) {
  const groups = groupByDiner(state.session, state.cart);

  return {
    id: state.session.id,
    tableId: state.session.tableId,
    status: state.session.status,
    currency: state.session.currency,
    diners: state.session.diners.map((diner) => ({
      id: diner.id,
      nickname: diner.nickname,
      colorIndex: diner.colorIndex,
    })),
    lines: state.cart.lines.map((line) => ({
      id: line.id,
      dinerId: line.dinerId,
      name: line.product.name,
      productId: line.product.productId,
      quantity: line.quantity,
      notes: line.notes,
      unitPrice: toMoneyDto(line.product.unitPrice),
      modifiers: line.modifiers.map((modifier) => ({
        name: modifier.name,
        priceDelta: toMoneyDto(modifier.priceDelta),
      })),
    })),
    subtotals: groups.map((group) => ({
      dinerId: group.diner.id,
      nickname: group.diner.nickname,
      colorIndex: group.diner.colorIndex,
      subtotal: toMoneyDto(group.subtotal),
    })),
  };
}

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly catalog: CatalogService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Loads the session, confirming it is the caller's to touch.
   *
   * `TableScopeGuard` has already rejected anyone without a signed token, so
   * what is left is the narrower question: a table token unlocks only its own
   * table, while a staff token is not bound to any single one.
   */
  /**
   * La sesión que el QR escaneado abrió, o un error.
   *
   * `mustBeOpen` para todo lo que cambia el pedido: alguien más de la mesa
   * pudo cerrar la cuenta mientras esta persona seguía eligiendo, y su
   * teléfono no se enteró. Leer una sesión cerrada sí está bien — es lo que
   * deja ver el detalle de lo que se acaba de pagar.
   */
  private async sessionInScope(
    scope: DinerScope,
    sessionId: string,
    mustBeOpen = false,
  ): Promise<SessionState> {
    const found = await this.sessions.store.findById(scope.tenantId, sessionId);
    if (found.isErr()) {
      throw new HttpException(found.error, HttpStatus.NOT_FOUND);
    }

    if (scope.tableId !== null && found.value.session.tableId !== scope.tableId) {
      throw new HttpException({ kind: 'WRONG_TABLE' }, HttpStatus.FORBIDDEN);
    }

    if (mustBeOpen && found.value.session.status === 'CLOSED') {
      throw new HttpException({ kind: 'SESSION_CLOSED' }, HttpStatus.CONFLICT);
    }

    return found.value;
  }

  /**
   * Mesas que ya comieron todo y siguen sin pagar.
   *
   * Declarada antes que `:id` a propósito: Nest resuelve por orden y "unsettled"
   * caería en esa ruta.
   *
   * Gated en `orders:advance`, el mismo permiso que libera una mesa: quien
   * atiende el salón es quien va a cobrar.
   */
  @RequirePermission('orders:advance')
  @Get('unsettled')
  async unsettled(@TenantId() tenantId: string) {
    const run = listUnsettledTables({
      sessions: this.sessions.store,
      orders: this.orders.store,
    });
    const result = await run(tenantId);

    if (result.isErr()) {
      throw new HttpException(result.error, HttpStatus.BAD_GATEWAY);
    }

    return result.value.map((table) => ({
      sessionId: table.sessionId,
      tableId: table.tableId,
      owed: toMoneyDto(table.owed),
      since: table.since?.toISOString() ?? null,
      diners: table.diners,
    }));
  }

  /** Joins the table's open session, creating it if this is the first diner. */
  @Public()
  @RateLimit('diner')
  @Post('join')
  async join(@Body() body: unknown) {
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    // A diner cannot pick a table: both the table and the restaurant come
    // from the QR they scanned, verified against that table's own secret.
    const table = await resolveTableToken(parsed.data.tableToken);
    if (table === null) {
      throw new HttpException({ kind: 'INVALID_TABLE_TOKEN' }, HttpStatus.UNAUTHORIZED);
    }

    const run = joinTable({
      sessions: this.sessions.store,
      events: this.realtime,
      newId: () => crypto.randomUUID(),
      now: () => new Date(),
    });

    const result = await run({
      tenantId: table.tenantId,
      tableId: table.tableId,
      nickname: parsed.data.nickname,
      currency: 'ARS',
      ...(parsed.data.dinerId === undefined ? {} : { dinerId: parsed.data.dinerId }),
    });

    if (result.isErr()) {
      const status = result.error.kind === 'NICKNAME_TAKEN' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;
      throw new HttpException(result.error, status);
    }

    return { dinerId: result.value.dinerId, session: toSessionDto(result.value.state) };
  }

  @Public()
  @TableScoped()
  @Get(':id')
  async read(@Param('id') sessionId: string, @Scope() scope: DinerScope) {
    return toSessionDto(await this.sessionInScope(scope, sessionId));
  }

  /**
   * Order tracking for the diner's own table.
   *
   * Deliberately not `GET /orders`: that one is the kitchen feed and needs
   * `orders:read`, which a diner never holds. The projection also drops the
   * idempotency key and per-item pricing the tracking screen has no use for.
   *
   * The tenant comes from the signed table token rather than the `?tenant=`
   * fallback, so knowing a session id is not on its own enough to read what a
   * table ordered — the caller has to hold the QR that opened it.
   */
  @Public()
  @TableScoped()
  @Get(':id/orders')
  async listOrders(@Param('id') sessionId: string, @Scope() scope: DinerScope) {
    await this.sessionInScope(scope, sessionId);

    const result = await this.orders.store.listBySession(scope.tenantId, sessionId);
    if (result.isErr()) {
      throw new HttpException('orders unavailable', HttpStatus.BAD_GATEWAY);
    }

    return result.value.map((order) => {
      const dto = toOrderDto(order);
      return {
        id: dto.id,
        status: dto.status,
        total: dto.total,
        placedAt: dto.placedAt,
        items: dto.items.map((item) => ({
          id: item.id,
          dinerId: item.dinerId,
          name: item.name,
          quantity: item.quantity,
          status: item.status,
        })),
      };
    });
  }

  /** Prices the line from the catalog: the client never sends amounts. */
  @Public()
  @TableScoped()
  @Post(':id/lines')
  async addLine(
    @Param('id') sessionId: string,
    @Body() body: unknown,
    @Scope() scope: DinerScope,
  ) {
    const parsed = addSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    await this.sessionInScope(scope, sessionId, true);
    const tenantId = scope.tenantId;

    const priced = await this.catalog.pricer.price(tenantId, {
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
      notes: parsed.data.notes,
      modifierIds: parsed.data.modifierIds,
    });

    if (priced.isErr()) {
      throw new HttpException(priced.error, HttpStatus.CONFLICT);
    }

    const run = addToSharedCart({
      sessions: this.sessions.store,
      events: this.realtime,
      newId: () => crypto.randomUUID(),
    });

    const result = await run({
      tenantId,
      sessionId,
      dinerId: parsed.data.dinerId,
      line: {
        dinerId: parsed.data.dinerId,
        product: priced.value.product,
        modifiers: priced.value.modifiers,
        notes: parsed.data.notes,
      },
      quantity: parsed.data.quantity,
    });

    if (result.isErr()) {
      throw new HttpException(result.error, HttpStatus.CONFLICT);
    }
    return toSessionDto(result.value);
  }

  @Public()
  @TableScoped()
  @Patch(':id/lines/:lineId')
  async changeLine(
    @Param('id') sessionId: string,
    @Param('lineId') lineId: string,
    @Body() body: unknown,
    @Scope() scope: DinerScope,
  ) {
    const parsed = changeSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    await this.sessionInScope(scope, sessionId, true);
    const tenantId = scope.tenantId;

    const run = changeSharedLine({ sessions: this.sessions.store, events: this.realtime });
    const result = await run({
      tenantId: tenantId,
      sessionId,
      dinerId: parsed.data.dinerId,
      lineId,
      quantity: parsed.data.quantity,
    });

    if (result.isErr()) {
      const status =
        result.error.kind === 'NOT_YOUR_LINE' ? HttpStatus.FORBIDDEN : HttpStatus.CONFLICT;
      throw new HttpException(result.error, status);
    }
    return toSessionDto(result.value);
  }

  @Public()
  @TableScoped()
  @Post(':id/leave')
  async leave(
    @Param('id') sessionId: string,
    @Body() body: unknown,
    @Scope() scope: DinerScope,
  ) {
    const parsed = z.object({ dinerId: z.string().min(1) }).safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    await this.sessionInScope(scope, sessionId, true);
    const tenantId = scope.tenantId;

    const run = leaveTable({ sessions: this.sessions.store, events: this.realtime });
    const result = await run({
      tenantId: tenantId,
      sessionId,
      dinerId: parsed.data.dinerId,
    });

    if (result.isErr()) {
      throw new HttpException(result.error, HttpStatus.CONFLICT);
    }
    return toSessionDto(result.value);
  }

  /**
   * Libera una mesa a mano, desde la app del mozo.
   *
   * El camino normal es que la mesa se libere sola al cerrar la cuenta. Pero
   * mucha gente paga en la caja y se va sin tocar el teléfono, y esa mesa
   * queda ocupada hasta que corre el barrido: el grupo siguiente escanea el
   * QR y cae en el pedido de los anteriores.
   *
   * Gated en `orders:advance`, el mismo permiso que mueve comandas: quien
   * atiende el salón es quien sabe que la mesa se fue.
   */
  @RequirePermission('orders:advance')
  @Post(':id/release')
  async release(@Param('id') sessionId: string, @TenantId() tenantId: string) {
    const run = closeTable({ sessions: this.sessions.store, events: this.realtime });
    const result = await run({ tenantId, sessionId });

    if (result.isErr()) {
      throw new HttpException(result.error, HttpStatus.CONFLICT);
    }
    // Cerrar no devuelve la mesa: ya no hay nada que mostrar de ella.
    return { released: true };
  }
}
