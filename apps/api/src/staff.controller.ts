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
import { ROLES, type Role, validateCredentials } from '@itadaki/identity/domain';
import { hashPassword } from '@itadaki/identity/infra';
import { z } from 'zod';
import { Auth, type AuthContext, RequirePermission, TenantId,
  forgetActiveState,
} from './auth';
import { StaffService } from './staff.service';

const inviteSchema = z.object({
  email: z.string().min(1).max(120),
  password: z.string().min(1).max(200),
  displayName: z.string().min(1).max(60),
  // OWNER is deliberately absent: transferring ownership is not an invite.
  role: z.enum(['MANAGER', 'KITCHEN', 'WAITER']),
});

const activeSchema = z.object({ active: z.boolean() });

/** Team management for a restaurant. Gated on `staff:manage`, so owners and managers only. */
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /** Roles the panel may offer, so the UI never invents one the API rejects. */
  @RequirePermission('staff:manage')
  @Get('roles')
  roles() {
    return ROLES.filter((role) => role !== 'OWNER');
  }

  @RequirePermission('staff:manage')
  @Get()
  async list(@TenantId() tenantId: string) {
    const found = await this.staff.store.listForTenant(tenantId);
    if (found.isErr()) {
      throw new HttpException(found.error, HttpStatus.BAD_GATEWAY);
    }
    return found.value;
  }

  /**
   * Creates an account for a colleague.
   *
   * The owner sets the first password and passes it on: a restaurant hiring a
   * cook on a Friday night needs them working now, not waiting on an email
   * that may never arrive. Password reset is still a gap — see the README.
   */
  @RequirePermission('staff:manage')
  @Post()
  async invite(@Body() body: unknown, @TenantId() tenantId: string) {
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const checked = validateCredentials(parsed.data.email, parsed.data.password);
    if (checked.isErr()) {
      throw new HttpException(checked.error, HttpStatus.BAD_REQUEST);
    }

    const created = await this.staff.store.create({
      id: crypto.randomUUID(),
      tenantId,
      email: checked.value.email,
      displayName: parsed.data.displayName.trim(),
      role: parsed.data.role as Role,
      active: true,
      passwordHash: await hashPassword(checked.value.password),
    });

    if (created.isErr()) {
      // The email index spans every restaurant, so this is the likely clash.
      const taken = /duplicate key|unique/i.test(JSON.stringify(created.error));
      throw new HttpException(
        taken ? { kind: 'EMAIL_TAKEN', email: checked.value.email } : created.error,
        taken ? HttpStatus.CONFLICT : HttpStatus.BAD_GATEWAY,
      );
    }
    return created.value;
  }

  /** Revokes or restores access; the account itself is kept for the audit trail. */
  @RequirePermission('staff:manage')
  @Patch(':id/active')
  async setActive(
    @Param('id') userId: string,
    @Body() body: unknown,
    @TenantId() tenantId: string,
    @Auth() auth: AuthContext,
  ) {
    const parsed = activeSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    // Locking yourself out of your own restaurant has no undo from the UI.
    if (userId === auth.userId) {
      throw new HttpException({ kind: 'CANNOT_DEACTIVATE_SELF' }, HttpStatus.CONFLICT);
    }

    const updated = await this.staff.store.setActive(tenantId, userId, parsed.data.active);
    if (updated.isErr()) {
      throw new HttpException(updated.error, HttpStatus.NOT_FOUND);
    }

    // Takes effect now rather than whenever the cached state ages out: the
    // person doing this is standing in front of the screen expecting it to.
    forgetActiveState(tenantId, userId);
    return updated.value;
  }
}
