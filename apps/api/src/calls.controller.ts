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
  CALL_REASONS,
  PAYMENT_METHODS,
  type CallReason,
  type PaymentMethod,
  type TableCall,
  needsCardReader,
  paysAtCounter,
} from '@itadaki/ordering/domain';
import { z } from 'zod';
import {
  type DinerScope,
  Public,
  RequirePermission,
  Scope,
  TableScoped,
  TenantId,
} from './auth';
import { RateLimit } from './rate-limit.guard';
import { CallsService } from './calls.service';
import { SessionsService } from './sessions.service';
import { RealtimeGateway } from './realtime.gateway';

const raiseSchema = z.object({
  reason: z.enum(CALL_REASONS),
  note: z.string().max(160).default(''),
  /** Only asked when the reason is BILL. */
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
});

const toDto = (call: TableCall) => ({
  id: call.id,
  sessionId: call.sessionId,
  tableId: call.tableId,
  reason: call.reason,
  status: call.status,
  note: call.note,
  paymentMethod: call.paymentMethod,
  /** Precomputed so no screen has to re-derive the rule. */
  needsCardReader: needsCardReader(call),
  /** La mesa paga en la caja: el mozo tiene que confirmarlo, nadie cobra allá. */
  paysAtCounter: paysAtCounter(call),
  raisedAt: call.raisedAt.toISOString(),
});

/** Tables asking for a waiter, the bill, or help with a question. */
@Controller('calls')
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly sessions: SessionsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Staff board: every table still waiting, oldest first.
   *
   * Gated on `orders:read`, the same permission the kitchen screen needs —
   * whoever watches the tickets is who should see a raised hand.
   */
  @RequirePermission('orders:read')
  @Get()
  async pending(@TenantId() tenantId: string) {
    const found = await this.calls.store.listPending(tenantId);
    if (found.isErr()) {
      throw new HttpException(found.error, HttpStatus.BAD_GATEWAY);
    }
    return found.value.map(toDto);
  }

  /**
   * Raises a call from the table.
   *
   * Rate limited as diner traffic: a bored table tapping the button repeatedly
   * should not be able to flood the staff screen.
   */
  @Public()
  @RateLimit('diner')
  @TableScoped()
  @Post(':sessionId')
  async raise(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @Scope() scope: DinerScope,
  ) {
    const parsed = raiseSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const session = await this.sessions.store.findById(scope.tenantId, sessionId);
    if (session.isErr()) {
      throw new HttpException(session.error, HttpStatus.NOT_FOUND);
    }
    if (scope.tableId !== null && session.value.session.tableId !== scope.tableId) {
      throw new HttpException({ kind: 'WRONG_TABLE' }, HttpStatus.FORBIDDEN);
    }
    // Calling from a table whose bill is settled would put a ghost on the
    // staff screen with nobody sitting there.
    if (session.value.session.status === 'CLOSED') {
      throw new HttpException({ kind: 'SESSION_CLOSED' }, HttpStatus.CONFLICT);
    }

    const raised = await this.calls.store.raise({
      id: crypto.randomUUID(),
      tenantId: scope.tenantId,
      sessionId,
      tableId: session.value.session.tableId,
      reason: parsed.data.reason as CallReason,
      status: 'PENDING',
      note: parsed.data.note.trim(),
      // Only a bill request carries one; anywhere else it would be noise.
      paymentMethod:
        parsed.data.reason === 'BILL'
          ? ((parsed.data.paymentMethod ?? 'UNDECIDED') as PaymentMethod)
          : null,
      raisedAt: new Date(),
      acknowledgedAt: null,
    });

    if (raised.isErr()) {
      throw new HttpException(raised.error, HttpStatus.BAD_GATEWAY);
    }

    await this.realtime.callRaised({
      tenantId: scope.tenantId,
      sessionId,
      callId: raised.value.id,
    });
    return toDto(raised.value);
  }

  /** What this table is currently waiting on, for its own screen. */
  @Public()
  @TableScoped()
  @Get(':sessionId')
  async forSession(@Param('sessionId') sessionId: string, @Scope() scope: DinerScope) {
    const found = await this.calls.store.listForSession(scope.tenantId, sessionId);
    if (found.isErr()) {
      throw new HttpException(found.error, HttpStatus.BAD_GATEWAY);
    }
    return found.value.map(toDto);
  }

  /** Staff marking a call as attended, which clears it from the board. */
  @RequirePermission('orders:advance')
  @Patch(':id/acknowledge')
  async acknowledge(@Param('id') callId: string, @TenantId() tenantId: string) {
    const updated = await this.calls.store.acknowledge(tenantId, callId, new Date());
    if (updated.isErr()) {
      throw new HttpException(updated.error, HttpStatus.NOT_FOUND);
    }

    await this.realtime.callRaised({
      tenantId,
      sessionId: updated.value.sessionId,
      callId: updated.value.id,
    });
    return toDto(updated.value);
  }

  /**
   * La mesa se arrepiente de haber llamado.
   *
   * Tocar por error el timbre manda al mozo a caminar sin motivo, y sin forma
   * de deshacerlo la única salida era esperar a que llegara para decirle que
   * no hacía falta. Cancelarlo es exactamente lo mismo que atenderlo — el
   * llamado deja de estar pendiente — pero lo pide la mesa.
   *
   * Sólo se cancela un llamado de la propia mesa: el guard prueba el QR, y
   * acá se comprueba que el llamado sea de esa sesión.
   */
  @Public()
  @RateLimit('diner')
  @TableScoped()
  @Patch(':sessionId/:id/cancel')
  async cancel(
    @Param('sessionId') sessionId: string,
    @Param('id') callId: string,
    @Scope() scope: DinerScope,
  ) {
    const session = await this.sessions.store.findById(scope.tenantId, sessionId);
    if (session.isErr()) {
      throw new HttpException(session.error, HttpStatus.NOT_FOUND);
    }
    if (scope.tableId !== null && session.value.session.tableId !== scope.tableId) {
      throw new HttpException({ kind: 'WRONG_TABLE' }, HttpStatus.FORBIDDEN);
    }

    const pending = await this.calls.store.listForSession(scope.tenantId, sessionId);
    if (pending.isErr()) {
      throw new HttpException(pending.error, HttpStatus.BAD_GATEWAY);
    }
    if (!pending.value.some((call) => call.id === callId)) {
      throw new HttpException({ kind: 'NOT_THIS_TABLE' }, HttpStatus.FORBIDDEN);
    }

    const cancelled = await this.calls.store.acknowledge(scope.tenantId, callId, new Date());
    if (cancelled.isErr()) {
      throw new HttpException(cancelled.error, HttpStatus.NOT_FOUND);
    }

    await this.realtime.callRaised({
      tenantId: scope.tenantId,
      sessionId,
      callId,
    });
    return { cancelled: callId };
  }
}
