import { Injectable } from '@nestjs/common';
import { type ImageRenderer } from '@itadaki/catalog/application/server';
import { LocalImageStore, PostgresImageStore, SharpImageRenderer } from '@itadaki/catalog/infra';
import { join } from 'node:path';
import { database } from './database';

const STORAGE_ROOT = process.env['IMAGE_ROOT'] ?? join(process.cwd(), '.image-store');
const PUBLIC_BASE = process.env['IMAGE_BASE_URL'] ?? 'http://localhost:3100/api/images';

@Injectable()
export class ImagesService {
  readonly store =
    process.env['USE_POSTGRES'] !== 'false'
      ? new PostgresImageStore(database, STORAGE_ROOT)
      : new LocalImageStore(STORAGE_ROOT);

  readonly renderer: ImageRenderer = new SharpImageRenderer(STORAGE_ROOT, PUBLIC_BASE);
}
