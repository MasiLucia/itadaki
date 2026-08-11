import 'reflect-metadata';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { USING_DEV_SECRET } from './auth';
import { databaseAvailable } from './database';
import { ErrorFilter } from './error.filter';

const PORT = Number(process.env['PORT'] ?? 3000);

/**
 * Browsers that may call this API.
 *
 * `origin: true` reflects whatever origin asks, which means any website can
 * make authenticated calls from a signed-in user's browser. In development the
 * local apps are allowed by name; in production the list has to be given.
 */
const DEV_ORIGINS = [
  'http://localhost:4200',
  'http://localhost:4300',
  'http://localhost:4400',
  'http://localhost:4500',
];

function allowedOrigins(): string[] {
  const configured = process.env['CORS_ORIGINS'];
  if (configured !== undefined && configured !== '') {
    return configured.split(',').map((origin) => origin.trim()).filter((origin) => origin !== '');
  }

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('CORS_ORIGINS is required in production');
  }
  return DEV_ORIGINS;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const origins = allowedOrigins();
  app.enableCors({
    origin: origins,
    credentials: true,
    // The diner app sends its table token on every scoped request.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Table-Token', 'Idempotency-Key'],
  });
  // Renders unhandled errors as a plain 500 instead of leaking a stack trace.
  app.useGlobalFilters(new ErrorFilter());
  // Base64 originals ride in the JSON body; 15 MB of binary is ~20 MB encoded.
  app.useBodyParser('json', { limit: '25mb' });
  app.setGlobalPrefix('api');
  await app.listen(PORT);

  const usingPostgres = process.env['USE_POSTGRES'] !== 'false';
  const reachable = usingPostgres ? await databaseAvailable() : false;
  const storage = usingPostgres
    ? reachable
      ? 'postgres'
      : 'postgres UNREACHABLE — set USE_POSTGRES=false to run in memory'
    : 'in-memory (data is lost on restart)';

  console.log(`itadaki api listening on http://localhost:${PORT}/api`);
  console.log(`storage: ${storage}`);
  console.log(`cors: ${origins.join(', ')}`);

  if (USING_DEV_SECRET) {
    console.warn('auth: using the development signing key — set AUTH_SECRET before deploying');
  }
}

void bootstrap();
