import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { PostgresTableStore, signTableToken } from '@itadaki/identity/infra';
import { PostgresAssignmentStore, PostgresShiftStore } from '@itadaki/ordering/infra';
import { z } from 'zod';
import { Auth, RequirePermission, TenantId, type AuthContext } from './auth';
import { database } from './database';

const DINER_APP_URL = process.env['DINER_APP_URL'] ?? 'http://localhost:4200';

@Controller('tables')
export class TablesController {
  private readonly tables = new PostgresTableStore(database);
  private readonly assignments = new PostgresAssignmentStore(database);
  private readonly shifts = new PostgresShiftStore(database);

  /** Lists tables with a freshly minted QR link for each. */
  @RequirePermission('menu:read')
  @Get()
  async list(@TenantId() tenantId: string) {
    const found = await this.tables.list(tenantId);
    if (found.isErr()) {
      throw new HttpException(found.error, HttpStatus.BAD_GATEWAY);
    }

    const now = Date.now();
    return found.value.map((table) => ({
      id: table.id,
      label: table.label,
      seats: table.seats,
      // The link is regenerated on every read, so an old printout expires on
      // its own schedule while the panel always shows a working one.
      url: this.linkFor(table.tenantId, table.id, table.secret, now),
    }));
  }

  @RequirePermission('menu:write')
  @Post()
  async create(@Body() body: unknown, @TenantId() tenantId: string) {
    const parsed = z
      .object({
        label: z.string().min(1).max(40),
        seats: z.number().int().min(1).max(30).default(4),
      })
      .safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const id = parsed.data.label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const saved = await this.tables.save({
      tenantId,
      id: id === '' ? `mesa-${Date.now().toString(36)}` : id,
      label: parsed.data.label,
      seats: parsed.data.seats,
    });

    if (saved.isErr()) {
      throw new HttpException(saved.error, HttpStatus.CONFLICT);
    }
    return {
      id: saved.value.id,
      label: saved.value.label,
      seats: saved.value.seats,
      url: this.linkFor(tenantId, saved.value.id, saved.value.secret, Date.now()),
    };
  }



  /** Invalidates every QR printed for this table. */
  @RequirePermission('menu:write')
  @Post(':id/rotate')
  async rotate(@Param('id') tableId: string, @TenantId() tenantId: string) {
    const rotated = await this.tables.rotateSecret(tenantId, tableId);
    if (rotated.isErr()) {
      throw new HttpException(rotated.error, HttpStatus.NOT_FOUND);
    }
    return {
      id: rotated.value.id,
      label: rotated.value.label,
      url: this.linkFor(tenantId, rotated.value.id, rotated.value.secret, Date.now()),
    };
  }

  /**
   * The link that goes on the printed QR.
   *
   * Deliberately without an expiry: the sticker on the table has to still work
   * next month, and a diner cannot "scan it again" when the paper itself is
   * what went stale. Rotating the table's secret is what invalidates it.
   */
  private linkFor(tenantId: string, tableId: string, secret: string, now: number): string {
    const token = signTableToken({ tenantId, tableId, issuedAt: now }, secret);
    return `${DINER_APP_URL}/bienvenida?t=${encodeURIComponent(token)}`;
  }

  /**
   * El reparto del salón: qué mozo atiende qué mesa.
   *
   * Lo lee el panel para dibujarlo y lo lee el salón para filtrar su tablero,
   * así que pide `orders:read` y no `menu:write`: el mozo tiene que poder
   * saber cuáles son sus mesas sin poder cambiar el reparto.
   */
  @RequirePermission('orders:read')
  @Get('assignments')
  async listAssignments(@TenantId() tenantId: string) {
    const found = await this.assignments.list(tenantId);
    if (found.isErr()) {
      throw new HttpException(found.error, HttpStatus.BAD_GATEWAY);
    }
    return found.value;
  }

  /** Pone o cambia el mozo de una mesa. Repartir es tarea de quien organiza. */
  @RequirePermission('staff:manage')
  @Post(':id/assign')
  async assign(@Param('id') tableId: string, @Body() body: unknown, @TenantId() tenantId: string) {
    const parsed = z.object({ staffId: z.string().min(1) }).safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const done = await this.assignments.assign(tenantId, tableId, parsed.data.staffId);
    if (done.isErr()) {
      throw new HttpException(done.error, HttpStatus.BAD_GATEWAY);
    }
    return { tableId, staffId: parsed.data.staffId };
  }

  /** Saca el dueño de una mesa: vuelve a verla todo el salón. */
  @RequirePermission('staff:manage')
  @Delete(':id/assign')
  async unassign(@Param('id') tableId: string, @TenantId() tenantId: string) {
    const done = await this.assignments.clear(tenantId, tableId);
    if (done.isErr()) {
      throw new HttpException(done.error, HttpStatus.BAD_GATEWAY);
    }
    return { tableId, staffId: null };
  }


  /**
   * Quién está trabajando ahora.
   *
   * Lo lee el salón para saber si esconder las mesas de los demás, y el panel
   * para mostrar quién entró. Pide `orders:read` porque es información del
   * turno, no una configuración.
   */
  @RequirePermission('orders:read')
  @Get('shifts')
  async listShifts(@TenantId() tenantId: string) {
    const found = await this.shifts.list(tenantId);
    if (found.isErr()) {
      throw new HttpException(found.error, HttpStatus.BAD_GATEWAY);
    }
    return found.value.map((shift) => ({
      staffId: shift.staffId,
      lastSeen: shift.lastSeen.toISOString(),
    }));
  }

  /**
   * Entrar al turno, o renovarlo.
   *
   * Cada uno entra por su cuenta y no lo carga el encargado: quién trabaja hoy
   * lo sabe el mozo, y el encargado puede no estar. Sobre el usuario del token
   * y no sobre un id que venga en el cuerpo — nadie pone a otro en turno.
   */
  @RequirePermission('orders:read')
  @Post('shifts/enter')
  async enterShift(@TenantId() tenantId: string, @Auth() user: AuthContext) {
    const done = await this.shifts.enter(tenantId, user.userId);
    if (done.isErr()) {
      throw new HttpException(done.error, HttpStatus.BAD_GATEWAY);
    }
    return { staffId: user.userId, inShift: true };
  }

  /** Salir del turno: sus mesas vuelven a verlas todos. */
  @RequirePermission('orders:read')
  @Post('shifts/leave')
  async leaveShift(@TenantId() tenantId: string, @Auth() user: AuthContext) {
    const done = await this.shifts.leave(tenantId, user.userId);
    if (done.isErr()) {
      throw new HttpException(done.error, HttpStatus.BAD_GATEWAY);
    }
    return { staffId: user.userId, inShift: false };
  }

  /**
   * Cambia el nombre o la cantidad de lugares.
   *
   * El id no se toca aunque cambie el nombre: de él cuelga el QR impreso y
   * pegado en la mesa. Renombrar "Mesa 5" a "Ventana 2" tiene que dejar el
   * cartelito funcionando, o cada corrección de nombre obligaría a reimprimir.
   */
  @RequirePermission('menu:write')
  @Patch(':id')
  async edit(@Param('id') tableId: string, @Body() body: unknown, @TenantId() tenantId: string) {
    const parsed = z
      .object({
        label: z.string().min(1).max(40),
        seats: z.number().int().min(1).max(30),
      })
      .safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const existente = await this.tables.find(tenantId, tableId);
    if (existente.isErr()) {
      throw new HttpException(existente.error, HttpStatus.NOT_FOUND);
    }

    const saved = await this.tables.save({
      tenantId,
      id: tableId,
      label: parsed.data.label,
      seats: parsed.data.seats,
    });
    if (saved.isErr()) {
      throw new HttpException(saved.error, HttpStatus.BAD_GATEWAY);
    }

    return {
      id: saved.value.id,
      label: saved.value.label,
      seats: saved.value.seats,
      url: this.linkFor(tenantId, saved.value.id, saved.value.secret, Date.now()),
    };
  }

  /**
   * Saca una mesa del salón.
   *
   * Se niega si tiene gente sentada: borrarla dejaría a esa mesa pidiendo
   * contra algo que ya no existe y su cuenta sin dónde cobrarse.
   */
  @RequirePermission('menu:write')
  @Delete(':id')
  async remove(@Param('id') tableId: string, @TenantId() tenantId: string) {
    const done = await this.tables.remove(tenantId, tableId);
    if (done.isErr()) {
      const status =
        done.error.kind === 'TABLE_IN_USE'
          ? HttpStatus.CONFLICT
          : done.error.kind === 'NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.BAD_GATEWAY;
      throw new HttpException(done.error, status);
    }
    return { id: tableId, removed: true };
  }

}
