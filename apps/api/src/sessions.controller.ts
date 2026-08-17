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
  listOpenTables,
  listUnsettledTables,
  type SessionState,
} from '@itadaki/ordering/application';
import { type Order, groupByDiner, placedTotals } from '@itadaki/ordering/domain';
import { Money } from '@itadaki/shared/domain';
import { PostgresTableStore, TABLE_TOKEN_HOURS, signTableToken } from '@itadaki/identity/infra';
import { type PostgresInviteStore } from '@itadaki/ordering/infra';
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
import { database } from './database';
import { CatalogService } from './catalog.service';
import { OrdersService } from './orders.service';
import { CallsService } from './calls.service';
import { RealtimeGateway } from './realtime.gateway';
import { SessionsService } from './sessions.service';
import { toMoneyDto, toOrderDto } from './contracts';

/** A dónde apunta el QR de una invitación; el mismo destino que el impreso. */
const DINER_APP_URL = process.env['DINER_APP_URL'] ?? 'http://localhost:4200';

const joinSchema = z.object({
  /**
   * Signed by the table's own secret; carries both tenant and table.
   *
   * Opcional porque quien entra por una invitación no lo tiene: su QR no lo
   * lleva, justamente para que la matriz sea legible. Lo recibe al entrar.
   */
  tableToken: z.string().min(1).max(2000).optional(),
  /** El restaurante, cuando se entra por invitación en vez de por el QR. */
  tenant: z.string().min(1).max(64).optional(),
  nickname: z.string().min(1).max(20),
  /**
   * Quien vuelve a la misma mesa, guardado en su teléfono.
   *
   * Sólo se acepta si esa persona sigue sentada acá: inventar un id ajeno no
   * da acceso a nada, porque se compara contra los que ya están en la mesa.
   */
  dinerId: z.string().min(1).max(64).optional(),
  /** El código de la mesa, el que da el mozo al sentarla. */
  joinCode: z.string().min(1).max(8).optional(),
  /**
   * Invitación de quien ya está sentado, escaneada de su teléfono.
   *
   * Reemplaza al código: vence en minutos, así que los que llegan tarde entran
   * sin que nadie tenga que mostrar el PIN en pantalla.
   */
  invite: z.string().min(1).max(64).optional(),
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

function toSessionDto(state: SessionState, placed: readonly Order[] = []) {
  const groups = groupByDiner(state.session, state.cart);
  const enviado = placedTotals(placed, state.session.currency);

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
      /** Lo que esta persona ya mandó a la cocina, aparte de su carrito. */
      placed: toMoneyDto(enviado.porComensal.get(group.diner.id) ?? Money.zero(state.session.currency)),
    })),
    /**
     * El consumo acumulado de la mesa: lo enviado a la cocina.
     *
     * Separado de `subtotals` a propósito. El carrito es lo que se está
     * armando; esto es lo que la mesa ya debe. Sumarlos en un solo número
     * haría que un plato contara dos veces mientras está en ambos lados.
     */
    placedTotal: toMoneyDto(enviado.total),
  };
}

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly catalog: CatalogService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeGateway,
    private readonly calls: CallsService,
  ) {}

  /** El código de cada mesa vive acá, no en la sesión. */
  private readonly tables = new PostgresTableStore(database);

  /** Las invitaciones de un solo uso para el que llega tarde. */
  private get invites(): PostgresInviteStore {
    return this.sessions.invites;
  }

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

  /**
   * Las mesas ocupadas y su código, para el salón.
   *
   * Detrás de `orders:advance`, nunca del token de la mesa: el código existe
   * justamente para que una foto del QR no alcance, así que servirlo a quien
   * presenta ese QR lo volvería inútil.
   */
  @RequirePermission('orders:advance')
  @Get('open')
  async open(@TenantId() tenantId: string) {
    const [result, tables] = await Promise.all([
      listOpenTables({ sessions: this.sessions.store })(tenantId),
      this.tables.list(tenantId),
    ]);
    if (result.isErr()) {
      throw new HttpException(result.error, HttpStatus.BAD_GATEWAY);
    }

    // El código es de la mesa, así que se lee de ahí y no de la sesión.
    const codes = new Map(
      tables.isOk() ? tables.value.map((table) => [table.id, table.joinCode]) : [],
    );

    return result.value.map((table) => ({
      sessionId: table.sessionId,
      tableId: table.tableId,
      joinCode: codes.get(table.tableId) ?? null,
      diners: table.diners,
      openedAt: table.openedAt.toISOString(),
    }));
  }

  /**
   * Todas las mesas con su código, ocupadas o no.
   *
   * El mozo lo necesita antes de que la mesa exista como sesión: es lo que
   * dice al sentar a la gente, y sin esto el primero que llega no puede
   * entrar. Detrás de un permiso de personal, nunca del token de la mesa.
   */
  @RequirePermission('orders:advance')
  @Get('codes')
  async codes(@TenantId() tenantId: string) {
    const [tables, open] = await Promise.all([
      this.tables.list(tenantId),
      this.sessions.store.listOpen(tenantId),
    ]);
    if (tables.isErr()) {
      throw new HttpException(tables.error, HttpStatus.BAD_GATEWAY);
    }

    const seated = new Map(
      open.isOk() ? open.value.map((state) => [state.session.tableId, state.session.diners.length]) : [],
    );

    return tables.value.map((table) => ({
      tableId: table.id,
      label: table.label,
      joinCode: table.joinCode,
      diners: seated.get(table.id) ?? 0,
    }));
  }

  /**
   * Le pone un código nuevo a la mesa, a mano.
   *
   * Para cuando el mozo sospecha que se filtró: alguien lo escuchó de la mesa
   * de al lado, o quedó anotado en una servilleta que se llevaron.
   */
  @RequirePermission('orders:advance')
  @Post('codes/:tableId/rotate')
  async rotateCode(@Param('tableId') tableId: string, @TenantId() tenantId: string) {
    const rotated = await this.tables.rotateJoinCode(tenantId, tableId);
    if (rotated.isErr()) {
      throw new HttpException(rotated.error, HttpStatus.BAD_GATEWAY);
    }
    return { tableId, joinCode: rotated.value };
  }

  /** Joins the table's open session, creating it if this is the first diner. */
  @Public()
  @RateLimit('join')
  @Post('join')
  async join(@Body() body: unknown) {
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    // De dónde sale la mesa: del QR impreso, o de una invitación.
    //
    // Por invitación el link no lleva el token de la mesa, y eso no es un
    // ahorro cosmético: con el token adentro el QR salía de 61 módulos y
    // ninguna cámara lo leía de una pantalla. Sin él baja a 37. El token se
    // emite acá, después de canjear, y viaja en la respuesta.
    const entrada =
      parsed.data.invite !== undefined && parsed.data.tenant !== undefined
        ? await this.tableFromInvite(parsed.data.tenant, parsed.data.invite)
        : await this.tableFromToken(parsed.data.tableToken);

    const { tenantId, tableId, viaInvite } = entrada;

    // El código que la mesa tiene puesto ahora. Sale de la mesa y no de la
    // sesión: tiene que existir antes de que nadie escanee, o el primero en
    // hacerlo entra sin código — y con una foto del QR eso se hace desde
    // cualquier lado.
    //
    // Quien llega con invitación no lo necesita: alguien de la mesa ya lo dejó
    // pasar, y eso es exactamente lo que la invitación prueba.
    const seated = await this.tables.find(tenantId, tableId);
    const expectedCode = viaInvite
      ? undefined
      : (seated.isOk() ? (seated.value.joinCode ?? undefined) : undefined);

    const run = joinTable({
      sessions: this.sessions.store,
      events: this.realtime,
      newId: () => crypto.randomUUID(),
      now: () => new Date(),
    });

    const result = await run({
      tenantId,
      tableId,
      nickname: parsed.data.nickname,
      currency: 'ARS',
      ...(parsed.data.dinerId === undefined ? {} : { dinerId: parsed.data.dinerId }),
      ...(parsed.data.joinCode === undefined ? {} : { joinCode: parsed.data.joinCode }),
      ...(expectedCode === undefined ? {} : { expectedCode }),
    });

    if (result.isErr()) {
      // 403 y no 400: el pedido está bien formado, lo que falta es permiso
      // para sentarse. El teléfono lo distingue para pedir el código.
      if (result.error.kind === 'WRONG_JOIN_CODE') {
        throw new HttpException(result.error, HttpStatus.FORBIDDEN);
      }
      const status = result.error.kind === 'NICKNAME_TAKEN' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;
      throw new HttpException(result.error, status);
    }

    // El PIN no vuelve en ningún caso. Quien ya está sentado suma gente con
    // una invitación: mostrarle el PIN en pantalla era dárselo también a quien
    // mirara desde la mesa de al lado.
    //
    // Con el token sí: quien entró por invitación no escaneó el QR impreso, y
    // sin token no puede pedir nada después. Se emite acá, ya canjeada la
    // invitación, y con vencimiento — no es el permanente del sticker.
    return {
      dinerId: result.value.dinerId,
      session: toSessionDto(result.value.state),
      ...(viaInvite && seated.isOk()
        ? { tableToken: this.tokenFor(tenantId, tableId, seated.value.secret) }
        : {}),
    };
  }

  /** La mesa que dice el QR impreso, comprobada contra el secreto de esa mesa. */
  private async tableFromToken(
    tableToken: string | undefined,
  ): Promise<{ tenantId: string; tableId: string; viaInvite: boolean }> {
    // A diner cannot pick a table: both the table and the restaurant come
    // from the QR they scanned, verified against that table's own secret.
    const table = tableToken === undefined ? null : await resolveTableToken(tableToken);
    if (table === null) {
      throw new HttpException({ kind: 'INVALID_TABLE_TOKEN' }, HttpStatus.UNAUTHORIZED);
    }
    return { tenantId: table.tenantId, tableId: table.tableId, viaInvite: false };
  }

  /**
   * La mesa a la que invita este código, si la invitación sigue vigente.
   *
   * El código es de 128 bits, así que nombrarlo ya es prueba suficiente de que
   * alguien de la mesa lo entregó. El restaurante viaja aparte porque el
   * aislamiento por tenant lo necesita antes de poder leer la fila.
   */
  private async tableFromInvite(
    tenantId: string,
    invite: string,
  ): Promise<{ tenantId: string; tableId: string; viaInvite: boolean }> {
    const redeemed = await this.invites.redeem(tenantId, invite, new Date());
    if (redeemed.isErr()) {
      throw new HttpException({ kind: 'INVITE_INVALID' }, HttpStatus.FORBIDDEN);
    }

    // La mesa pudo cerrarse entre que se generó la invitación y este escaneo.
    const state = await this.sessions.store.findById(tenantId, redeemed.value);
    if (state.isErr() || state.value.session.status === 'CLOSED') {
      throw new HttpException({ kind: 'INVITE_INVALID' }, HttpStatus.FORBIDDEN);
    }

    return { tenantId, tableId: state.value.session.tableId, viaInvite: true };
  }

  /** Un token de mesa con vencimiento, para quien no escaneó el QR impreso. */
  private tokenFor(tenantId: string, tableId: string, secret: string): string {
    const now = Date.now();
    return signTableToken(
      { tenantId, tableId, issuedAt: now, expiresAt: now + TABLE_TOKEN_HOURS * 60 * 60_000 },
      secret,
    );
  }

  /**
   * Una invitación para el que llegó tarde.
   *
   * La pide alguien que ya está sentado, desde su teléfono, y sale como QR
   * para que los invitados lo escaneen. El mismo sirve para todo el grupo que
   * llegue mientras esté vigente, y vence en minutos: no queda una puerta
   * abierta al resto del salón por el resto de la cena.
   *
   * Sólo la emite quien está en la mesa. El token del QR no alcanza —es
   * justamente lo que puede estar filtrado— así que además hay que ser uno de
   * los comensales sentados, y para estarlo hubo que saber el PIN del mozo.
   */
  @Public()
  @RateLimit('diner')
  @TableScoped()
  @Post(':id/invite')
  async invite(
    @Param('id') sessionId: string,
    @Body() body: unknown,
    @Scope() scope: DinerScope,
  ) {
    const parsed = z.object({ dinerId: z.string().min(1).max(64) }).safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const state = await this.sessionInScope(scope, sessionId, true);
    const sentado = state.session.diners.some((diner) => diner.id === parsed.data.dinerId);
    if (!sentado) {
      throw new HttpException({ kind: 'NOT_AT_TABLE' }, HttpStatus.FORBIDDEN);
    }

    const created = await this.invites.create(
      scope.tenantId,
      sessionId,
      parsed.data.dinerId,
      new Date(),
    );
    if (created.isErr()) {
      throw new HttpException(created.error, HttpStatus.BAD_GATEWAY);
    }

    // El link va corto a propósito: sólo la invitación y el restaurante.
    //
    // Con el token de la mesa adentro medía 237 caracteres y el QR salía de 61
    // módulos — a 320px en pantalla, 4,6px cada uno, y ninguna cámara lo leía.
    // Así queda en 37 módulos y 7,1px. El token lo emite el servidor al
    // canjear, que además es el momento correcto para hacerlo.
    return {
      code: created.value.code,
      expiresAt: created.value.expiresAt.toISOString(),
      url: `${DINER_APP_URL}/unirse?i=${encodeURIComponent(created.value.code)}&r=${encodeURIComponent(scope.tenantId)}`,
    };
  }

  /** Lo que la mesa ya mandó a la cocina; vacío si la consulta falla. */
  private async placedFor(tenantId: string, sessionId: string): Promise<readonly Order[]> {
    const placed = await this.orders.store.listBySession(tenantId, sessionId);
    return placed.isOk() ? placed.value : [];
  }

  @Public()
  @TableScoped()
  @Get(':id')
  async read(@Param('id') sessionId: string, @Scope() scope: DinerScope) {
    const state = await this.sessionInScope(scope, sessionId);

    // Con lo ya enviado a la cocina: el carrito se vacía al mandar el pedido,
    // y sin esto la mesa mostraba $0 justo cuando más plata debe.
    return toSessionDto(state, await this.placedFor(scope.tenantId, sessionId));
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
    // Con lo ya enviado: tocar el carrito no cambia lo que la mesa
    // debe, y sin esto el total parpadeaba a $0 al agregar un plato.
    return toSessionDto(result.value, await this.placedFor(tenantId, sessionId));
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
    // Con lo ya enviado: tocar el carrito no cambia lo que la mesa
    // debe, y sin esto el total parpadeaba a $0 al agregar un plato.
    return toSessionDto(result.value, await this.placedFor(tenantId, sessionId));
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
    // Con lo ya enviado: tocar el carrito no cambia lo que la mesa
    // debe, y sin esto el total parpadeaba a $0 al agregar un plato.
    return toSessionDto(result.value, await this.placedFor(tenantId, sessionId));
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
    // Antes de cerrarla, de qué mesa era: después la sesión ya no la nombra.
    const before = await this.sessions.store.findById(tenantId, sessionId);

    const run = closeTable({
      sessions: this.sessions.store,
      events: this.realtime,
      calls: this.calls.store,
    });
    const result = await run({ tenantId, sessionId });

    if (result.isErr()) {
      throw new HttpException(result.error, HttpStatus.CONFLICT);
    }

    // Código nuevo para el grupo que viene. Sin esto, el que se acaba de ir se
    // lo lleva anotado y puede volver a sentarse desde afuera esta noche.
    if (before.isOk()) {
      await this.tables.rotateJoinCode(tenantId, before.value.session.tableId);
    }

    // Cerrar no devuelve la mesa: ya no hay nada que mostrar de ella.
    return { released: true };
  }
}
