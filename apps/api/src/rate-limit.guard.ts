import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimiter, type RateLimitRule } from '@itadaki/shared/domain';
import { createHash } from 'node:crypto';
import { type AuthedRequest } from './auth';

/**
 * Named limits, so a route says what it is protecting against rather than
 * carrying two bare numbers.
 */
export const LIMITS = {
  /** Password guessing. Deliberately tight; a real person retypes a few times. */
  login: { limit: 10, windowMs: 15 * 60_000 },
  /** Reset mail floods — each attempt sends an email to someone's inbox. */
  passwordReset: { limit: 5, windowMs: 60 * 60_000 },
  /** Automated restaurant creation, which would fill the tenant table. */
  signUp: { limit: 5, windowMs: 60 * 60_000 },
  /**
   * Diner traffic. Generous: a table of six tapping through a menu is normal,
   * and throttling real customers mid-order is worse than the abuse it stops.
   */
  diner: { limit: 120, windowMs: 60_000 },
  /**
   * Adivinar el código de una mesa.
   *
   * Se cuenta por mesa y no por IP, que es lo que importa acá: al atacante le
   * sobran direcciones, pero el código que quiere romper es de una sola mesa.
   *
   * Treinta por minuto deja entrar de golpe a una mesa larga de cumpleaños
   * —veinte personas escaneando juntas— y al que prueba a ciegas le deja
   * medio millón de minutos por delante para un código de seis dígitos.
   */
  join: { limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type LimitName = keyof typeof LIMITS;

export const RATE_LIMIT = 'itadaki:rate-limit';
export const RateLimit = (name: LimitName): MethodDecorator => SetMetadata(RATE_LIMIT, name);

const PRUNE_EVERY_MS = 10 * 60_000;

/**
 * Per-caller request limits.
 *
 * In-process on purpose: one API instance is the current deployment, and a
 * shared Redis counter would be infrastructure to run and monitor for a
 * problem nobody has yet. Behind several instances each would enforce its own
 * share of the limit — worth revisiting then, not now.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiters = new Map<LimitName, RateLimiter>();
  private lastPrune = Date.now();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const name = this.reflector.getAllAndOverride<LimitName>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (name === undefined) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const decision = this.limiterFor(name).hit(this.keyFor(request, name), Date.now());
    this.maybePrune();

    if (!decision.allowed) {
      const response = context.switchToHttp().getResponse<{
        setHeader?: (name: string, value: string) => void;
      }>();
      response.setHeader?.('Retry-After', String(decision.retryAfterSeconds));

      throw new HttpException(
        { kind: 'TOO_MANY_REQUESTS', retryAfterSeconds: decision.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /**
   * What counts as one caller.
   *
   * Login and reset are keyed by address as well as IP: a whole restaurant
   * behind one connection must not be locked out because someone else on that
   * network mistyped their password.
   */
  private keyFor(request: AuthedRequest, name: LimitName): string {
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    if (name === 'login' || name === 'passwordReset') {
      const body = request.body as { email?: unknown } | undefined;
      const email = typeof body?.email === 'string' ? body.email.toLowerCase() : '';
      return `${name}:${ip}:${email}`;
    }

    // Sentarse en la mesa se cuenta por mesa, sin la IP: quien prueba códigos
    // a ciegas cambia de dirección cuando quiere, pero no cambia de mesa. El
    // token identifica una y es lo que hay antes de validar nada.
    if (name === 'join') {
      const body = request.body as { tableToken?: unknown } | undefined;
      const token = typeof body?.tableToken === 'string' ? body.tableToken : '';
      return `${name}:${createHash('sha256').update(token).digest('base64url')}`;
    }

    return `${name}:${ip}`;
  }

  private limiterFor(name: LimitName): RateLimiter {
    const existing = this.limiters.get(name);
    if (existing !== undefined) return existing;

    const created = new RateLimiter(LIMITS[name]);
    this.limiters.set(name, created);
    return created;
  }

  /** Sweeps expired windows so the counters cannot grow without bound. */
  private maybePrune(): void {
    const now = Date.now();
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;

    this.lastPrune = now;
    for (const limiter of this.limiters.values()) limiter.prune(now);
  }
}
