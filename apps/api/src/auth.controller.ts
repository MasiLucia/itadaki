import { Body, Controller, Get, HttpException, HttpStatus, Post } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  type Role,
  describeSubscription,
  normaliseEmail,
  permissionsOf,
  prepareTenant,
  uniqueSlug,
  validateCredentials,
  validatePassword,
} from '@itadaki/identity/domain';
import {
  RESET_TOKEN_MINUTES,
  digestOf,
  hashPassword,
  isGoogleError,
  newResetToken,
  signToken,
  verifyGoogleIdToken,
  verifyPassword,
} from '@itadaki/identity/infra';
import { z } from 'zod';
import { ADMIN_APP_URL, AUTH_SECRET, Auth, type AuthContext, Public, SESSION_HOURS } from './auth';
import { RateLimit } from './rate-limit.guard';
import { StaffService } from './staff.service';
import { TenantsService } from './tenants.service';
import { ResetsService } from './resets.service';
import { GoogleService } from './google.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly staff: StaffService,
    private readonly tenants: TenantsService,
    private readonly resets: ResetsService,
    private readonly google: GoogleService,
  ) {}

  @Public()
  @RateLimit('login')
  @Post('login')
  async login(@Body() body: unknown) {
    const parsed = z
      .object({ email: z.string().min(1).max(120), password: z.string().min(1).max(200) })
      .safeParse(body);
    if (!parsed.success) {
      throw new HttpException({ kind: 'INVALID_CREDENTIALS' }, HttpStatus.UNAUTHORIZED);
    }

    const checked = validateCredentials(parsed.data.email, parsed.data.password);
    // A malformed address and a wrong password answer identically: telling
    // them apart would let someone enumerate registered emails.
    if (checked.isErr()) {
      throw new HttpException({ kind: 'INVALID_CREDENTIALS' }, HttpStatus.UNAUTHORIZED);
    }

    const found = await this.staff.store.findByEmail(checked.value.email);
    if (found.isErr()) {
      throw new HttpException({ kind: 'INVALID_CREDENTIALS' }, HttpStatus.UNAUTHORIZED);
    }

    const matches = await verifyPassword(checked.value.password, found.value.passwordHash);
    if (!matches) {
      throw new HttpException({ kind: 'INVALID_CREDENTIALS' }, HttpStatus.UNAUTHORIZED);
    }

    const expiresAt = Date.now() + SESSION_HOURS * 3_600_000;
    const token = signToken(
      {
        userId: found.value.id,
        tenantId: found.value.tenantId,
        role: found.value.role,
        displayName: found.value.displayName,
        expiresAt,
      },
      AUTH_SECRET,
    );

    return {
      token,
      expiresAt,
      user: {
        id: found.value.id,
        displayName: found.value.displayName,
        role: found.value.role,
        tenantId: found.value.tenantId,
        permissions: permissionsOf(found.value.role),
      },
    };
  }

  /**
   * Registers a restaurant and its first owner.
   *
   * Public by necessity: this is the one call made by someone who does not yet
   * have an account. It returns a session so signing up lands the owner
   * straight in the panel rather than at a login form.
   */
  @Public()
  @RateLimit('signUp')
  @Post('signup')
  async signUp(@Body() body: unknown) {
    const parsed = z
      .object({
        restaurant: z.string().min(1).max(80),
        email: z.string().min(1).max(120),
        password: z.string().min(1).max(200),
        displayName: z.string().min(1).max(60).optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const named = prepareTenant(parsed.data.restaurant);
    if (named.isErr()) {
      throw new HttpException(named.error, HttpStatus.BAD_REQUEST);
    }

    const checked = validateCredentials(parsed.data.email, parsed.data.password);
    if (checked.isErr()) {
      throw new HttpException(checked.error, HttpStatus.BAD_REQUEST);
    }

    const taken = await this.tenants.store.takenSlugs(named.value.slug);
    if (taken.isErr()) {
      throw new HttpException(taken.error, HttpStatus.BAD_GATEWAY);
    }
    const slug = uniqueSlug(named.value.slug, taken.value);

    const created = await this.tenants.store.signUp({
      // Slug doubles as the id: it is already unique and stays readable in logs.
      tenantId: slug,
      name: named.value.name,
      slug,
      currency: 'ARS',
      staff: {
        id: crypto.randomUUID(),
        email: checked.value.email,
        displayName: parsed.data.displayName?.trim() ?? checked.value.email.split('@')[0] ?? 'dueño',
        passwordHash: await hashPassword(checked.value.password),
        role: 'OWNER',
      },
    });

    if (created.isErr()) {
      const status =
        created.error.kind === 'EMAIL_TAKEN' ? HttpStatus.CONFLICT : HttpStatus.BAD_GATEWAY;
      throw new HttpException(created.error, status);
    }

    const { tenant, owner } = created.value;
    const expiresAt = Date.now() + SESSION_HOURS * 3_600_000;
    const token = signToken(
      {
        userId: owner.id,
        tenantId: owner.tenantId,
        role: owner.role,
        displayName: owner.displayName,
        expiresAt,
      },
      AUTH_SECRET,
    );

    return {
      token,
      expiresAt,
      restaurant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      user: {
        id: owner.id,
        displayName: owner.displayName,
        role: owner.role,
        tenantId: owner.tenantId,
        permissions: permissionsOf(owner.role),
      },
    };
  }

  /** Lets the panel show or hide the Google button without guessing. */
  @Public()
  @Get('providers')
  providers() {
    return { google: this.google.enabled ? { clientId: this.google.clientId } : null };
  }

  /**
   * Signs in with a Google ID token, registering the restaurant if asked.
   *
   * An address that already has an account signs into it: Google proved the
   * person owns that mailbox, and the alternative — refusing, or creating a
   * duplicate — would strand someone outside their own restaurant.
   */
  @Public()
  @RateLimit('login')
  @Post('google')
  async google_(@Body() body: unknown) {
    if (!this.google.enabled) {
      throw new HttpException({ kind: 'GOOGLE_NOT_CONFIGURED' }, HttpStatus.NOT_IMPLEMENTED);
    }

    const parsed = z
      .object({
        idToken: z.string().min(1).max(4000),
        /** Only used when the address has no account yet. */
        restaurant: z.string().min(1).max(80).optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const identity = verifyGoogleIdToken(parsed.data.idToken, {
      clientId: this.google.clientId,
      keys: await this.google.keys(),
      now: new Date(),
    });
    if (isGoogleError(identity)) {
      throw new HttpException({ kind: 'INVALID_GOOGLE_TOKEN' }, HttpStatus.UNAUTHORIZED);
    }

    const existing = await this.staff.store.findByEmail(identity.email);
    if (existing.isOk()) {
      return this.sessionFor(existing.value);
    }

    // No account: this is a signup, and it needs a restaurant to create.
    if (parsed.data.restaurant === undefined) {
      throw new HttpException(
        { kind: 'NEEDS_RESTAURANT', email: identity.email, name: identity.name },
        HttpStatus.CONFLICT,
      );
    }

    const named = prepareTenant(parsed.data.restaurant);
    if (named.isErr()) {
      throw new HttpException(named.error, HttpStatus.BAD_REQUEST);
    }

    const taken = await this.tenants.store.takenSlugs(named.value.slug);
    if (taken.isErr()) {
      throw new HttpException(taken.error, HttpStatus.BAD_GATEWAY);
    }
    const slug = uniqueSlug(named.value.slug, taken.value);

    const created = await this.tenants.store.signUp({
      tenantId: slug,
      name: named.value.name,
      slug,
      currency: 'ARS',
      staff: {
        id: crypto.randomUUID(),
        email: identity.email,
        displayName: identity.name,
        // Unguessable filler: this account signs in through Google, and a
        // password reset is what turns on the email-and-password path.
        passwordHash: await hashPassword(randomBytes(32).toString('base64url')),
        role: 'OWNER',
      },
    });

    if (created.isErr()) {
      const status =
        created.error.kind === 'EMAIL_TAKEN' ? HttpStatus.CONFLICT : HttpStatus.BAD_GATEWAY;
      throw new HttpException(created.error, status);
    }

    const { tenant, owner } = created.value;
    return {
      ...this.sessionFor(owner),
      restaurant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    };
  }

  /** One place that mints a session, so every entry point issues the same shape. */
  private sessionFor(user: {
    id: string;
    tenantId: string;
    role: Role;
    displayName: string;
  }) {
    const expiresAt = Date.now() + SESSION_HOURS * 3_600_000;
    return {
      token: signToken(
        {
          userId: user.id,
          tenantId: user.tenantId,
          role: user.role,
          displayName: user.displayName,
          expiresAt,
        },
        AUTH_SECRET,
      ),
      expiresAt,
      user: {
        id: user.id,
        displayName: user.displayName,
        role: user.role,
        tenantId: user.tenantId,
        permissions: permissionsOf(user.role),
      },
    };
  }

  /**
   * Starts a password reset.
   *
   * Always answers the same way, whether or not the address is registered:
   * a different response for an unknown email would turn this into a way to
   * find out who has an account.
   */
  @Public()
  @RateLimit('passwordReset')
  @Post('forgot-password')
  async forgotPassword(@Body() body: unknown) {
    const parsed = z.object({ email: z.string().min(1).max(120) }).safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const email = normaliseEmail(parsed.data.email);
    const found = await this.staff.store.findByEmail(email);

    if (found.isOk()) {
      const { token, digest } = newResetToken();
      const expiresAt = new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000);

      const saved = await this.resets.store.create(
        digest,
        { tenantId: found.value.tenantId, userId: found.value.id },
        expiresAt,
      );

      if (saved.isOk()) {
        const link = `${ADMIN_APP_URL}/?reset=${encodeURIComponent(token)}`;
        await this.resets.mailer.send({
          to: found.value.email,
          subject: 'Cambiá tu contraseña de ITADAKI',
          body: [
            `Hola ${found.value.displayName},`,
            '',
            'Pediste cambiar tu contraseña. Entrá acá para elegir una nueva:',
            link,
            '',
            `El link vence en ${RESET_TOKEN_MINUTES} minutos y se puede usar una sola vez.`,
            'Si no fuiste vos, ignorá este mensaje: tu contraseña sigue igual.',
          ].join('\n'),
        });
      }
    }

    return { sent: true };
  }

  /** Completes a reset. The link is single-use and expires on its own. */
  @Public()
  @RateLimit('passwordReset')
  @Post('reset-password')
  async resetPassword(@Body() body: unknown) {
    const parsed = z
      .object({ token: z.string().min(1).max(200), password: z.string().min(1).max(200) })
      .safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    // Checked before the token is spent, so a weak password does not burn a
    // valid link and force the person to request another one.
    const checked = validatePassword(parsed.data.password);
    if (checked.isErr()) {
      throw new HttpException(checked.error, HttpStatus.BAD_REQUEST);
    }

    const consumed = await this.resets.store.consume(
      digestOf(parsed.data.token),
      await hashPassword(parsed.data.password),
      new Date(),
    );

    if (consumed.isErr()) {
      throw new HttpException({ kind: 'INVALID_TOKEN' }, HttpStatus.BAD_REQUEST);
    }
    return { reset: true };
  }

  /**
   * Trial state for the signed-in restaurant.
   *
   * Its own endpoint rather than a field on `/me`: the panel polls this after
   * a failed write to explain a 403, and `/me` is cached on boot.
   */
  @Get('subscription')
  async subscription(@Auth() auth: AuthContext) {
    const found = await this.tenants.store.subscriptionFor(auth.tenantId);
    if (found.isErr()) {
      // Unknown state reads as active: never warn a paying customer by mistake.
      return { status: 'ACTIVE', trialEndsAt: null, daysLeft: null };
    }

    const described = describeSubscription(found.value, new Date());
    return {
      status: described.status,
      trialEndsAt: described.trialEndsAt?.toISOString() ?? null,
      daysLeft: described.daysLeft,
    };
  }

  /** Confirms a token is still good and returns who it belongs to. */
  @Get('me')
  me(@Auth() auth: AuthContext) {
    return {
      id: auth.userId,
      displayName: auth.displayName,
      role: auth.role,
      tenantId: auth.tenantId,
      permissions: permissionsOf(auth.role),
    };
  }
}
