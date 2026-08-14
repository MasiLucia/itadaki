import { Injectable } from '@nestjs/common';
import { type ImageRenderer } from '@itadaki/catalog/application/server';
import {
  type BlobStorage,
  DiskBlobStorage,
  LocalImageStore,
  PostgresImageStore,
  S3BlobStorage,
  SharpImageRenderer,
} from '@itadaki/catalog/infra';
import { join } from 'node:path';
import { database } from './database';
import { log } from './logger';

const STORAGE_ROOT = process.env['IMAGE_ROOT'] ?? join(process.cwd(), '.image-store');
/**
 * Prefix baked into every image URL, which is then stored in the record.
 *
 * Absolute on purpose: the four apps run on their own origins, so a relative
 * path would resolve against whichever one is showing the photo rather than
 * against the API. Changing it does not rewrite the URLs already saved — set
 * it before the first upload of a deploy.
 */
const PUBLIC_BASE = process.env['IMAGE_BASE_URL'] ?? 'http://localhost:3000/api/images';

/**
 * Where image bytes go.
 *
 * A bucket when one is configured, the local disk otherwise. The disk is fine
 * for a single instance and wrong for two: an image uploaded to one is a 404
 * on the other, and a redeploy takes the whole menu's photos with it. In
 * production that trade-off has to be a decision, not an accident, so it is
 * announced at boot either way.
 */
function resolveBlobStorage(): BlobStorage {
  const bucket = S3BlobStorage.fromEnvironment();
  if (bucket !== null) {
    log.info('imágenes en bucket S3');
    return bucket;
  }

  if (process.env['NODE_ENV'] === 'production') {
    log.warn(
      'imágenes en disco local: se pierden al redesplegar y no funcionan con más de una instancia — configurá S3_BUCKET',
      { root: STORAGE_ROOT },
    );
  }
  return new DiskBlobStorage(STORAGE_ROOT);
}

const blobs = resolveBlobStorage();

@Injectable()
export class ImagesService {
  readonly store =
    process.env['USE_POSTGRES'] !== 'false'
      ? new PostgresImageStore(database, blobs)
      : new LocalImageStore(STORAGE_ROOT);

  readonly renderer: ImageRenderer = new SharpImageRenderer(blobs, PUBLIC_BASE);
}
