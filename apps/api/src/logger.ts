/**
 * One log line per event, as JSON.
 *
 * Not a logging library: the whole need is that a hosted log viewer can filter
 * by tenant and follow one request, which plain text cannot do. Anything that
 * later ships these somewhere replaces this file and nothing else.
 *
 * Never log a table token, a password, or an Authorization header — a log
 * viewer is read by more people than a database is.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  readonly [key: string]: string | number | boolean | null | undefined;
}

const write = (level: LogLevel, message: string, fields: LogFields): void => {
  const line = JSON.stringify({
    level,
    message,
    at: new Date().toISOString(),
    ...fields,
  });

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export const log = {
  info: (message: string, fields: LogFields = {}) => write('info', message, fields),
  warn: (message: string, fields: LogFields = {}) => write('warn', message, fields),
  error: (message: string, fields: LogFields = {}) => write('error', message, fields),
};

/**
 * Short id printed with a 500 and logged beside the stack trace.
 *
 * Lets someone reading the error on their phone say "dice fallo abc123" and
 * have that land on one exact line in the log.
 */
export function incidentId(): string {
  return Math.random().toString(36).slice(2, 8);
}
