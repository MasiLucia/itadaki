import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { type Response } from 'express';
import { Public } from './auth';
import { databaseAvailable } from './database';

/**
 * Liveness and readiness for whatever runs this.
 *
 * Public and unauthenticated: a load balancer has no credentials, and the
 * response says nothing an attacker could not learn by sending a request.
 */
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  /** Cheap liveness probe: the process is up and answering. */
  @Public()
  @Get()
  live() {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  /**
   * Readiness: whether this instance can actually serve traffic.
   *
   * Answers 503 when the database is unreachable so an orchestrator stops
   * routing to it instead of letting every request fail one by one.
   */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const usingPostgres = process.env['USE_POSTGRES'] !== 'false';
    const database = usingPostgres ? await databaseAvailable() : true;

    if (!database) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'degraded', database: false };
    }
    return { status: 'ok', database: true };
  }
}
