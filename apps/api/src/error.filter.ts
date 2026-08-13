import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { type Response } from 'express';
import { incidentId, log } from './logger';

/**
 * Turns anything unhandled into a plain 500.
 *
 * Nest's default renders the exception, which leaks file paths, SQL and table
 * names to whoever triggered it. The detail still reaches the server log,
 * where it is useful and not public.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    // Deliberate errors already carry a safe, chosen shape.
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const request = host.switchToHttp().getRequest<{
      method?: string;
      url?: string;
      auth?: { tenantId?: string };
    }>();

    // Returned to the caller and logged here, so someone reading the error on
    // their phone can name the exact line that caused it.
    const incident = incidentId();

    log.error('unhandled error', {
      incident,
      method: request.method,
      // The path only; a query string can carry a table token.
      path: request.url?.split('?')[0],
      tenantId: request.auth?.tenantId,
      detail: exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    });

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ kind: 'INTERNAL_ERROR', incident });
  }
}
