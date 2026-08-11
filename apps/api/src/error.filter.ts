import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { type Response } from 'express';

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

    const request = host.switchToHttp().getRequest<{ method?: string; url?: string }>();
    console.error(
      `unhandled error on ${request.method ?? '?'} ${request.url ?? '?'}`,
      exception instanceof Error ? exception.stack : exception,
    );

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ kind: 'INTERNAL_ERROR' });
  }
}
