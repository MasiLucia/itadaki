import { type RepositoryError } from '@itadaki/catalog/application';
import { type ImageReader, type ImageWriter, type StoredImage } from '@itadaki/catalog/application/server';
import { type Result, err, ok } from '@itadaki/shared/domain';
import { type Database } from '@itadaki/shared/persistence';
import { type BlobStorage, DiskBlobStorage } from './blob-storage';

interface ImageRow {
  id: string;
  tenant_id: string;
  original_path: string;
  params: StoredImage['params'];
  image_set: StoredImage['imageSet'];
  alt: string;
}

/**
 * Image records live in Postgres; the bytes go wherever storage says.
 *
 * Keeping the original plus its parameters is what makes re-editing
 * non-destructive. Where those bytes sit — local disk or a bucket — is the
 * caller's decision, so running two API instances does not need a code change.
 */
export class PostgresImageStore implements ImageReader, ImageWriter {
  private readonly blobs: BlobStorage;

  constructor(
    private readonly db: Database,
    storage: BlobStorage | string,
  ) {
    // A plain path still works, so existing callers keep their behaviour.
    this.blobs = typeof storage === 'string' ? new DiskBlobStorage(storage) : storage;
  }

  private keyFor(tenantId: string, imageId: string, file: string): string {
    return `${tenantId}/${imageId}/${file}`;
  }

  async saveOriginal(
    tenantId: string,
    imageId: string,
    data: Buffer,
  ): Promise<Result<string, RepositoryError>> {
    try {
      const key = this.keyFor(tenantId, imageId, 'original');
      await this.blobs.put(key, data);
      return ok(key);
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: String(error) });
    }
  }

  async readOriginal(tenantId: string, imageId: string): Promise<Result<Buffer, RepositoryError>> {
    try {
      return ok(await this.blobs.get(this.keyFor(tenantId, imageId, 'original')));
    } catch {
      return err({ kind: 'NOT_FOUND', id: imageId });
    }
  }

  async readVariant(
    tenantId: string,
    imageId: string,
    file: string,
  ): Promise<Result<Buffer, RepositoryError>> {
    try {
      return ok(await this.blobs.get(this.keyFor(tenantId, imageId, file)));
    } catch {
      return err({ kind: 'NOT_FOUND', id: file });
    }
  }

  async saveRecord(image: StoredImage): Promise<Result<StoredImage, RepositoryError>> {
    try {
      await this.db.withTenant(image.tenantId, async (client) => {
        await client.query(
          `INSERT INTO images (tenant_id, id, original_path, params, image_set, alt, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6, now())
           ON CONFLICT (tenant_id, id) DO UPDATE SET
             params = EXCLUDED.params,
             image_set = EXCLUDED.image_set,
             alt = EXCLUDED.alt,
             updated_at = now()`,
          [
            image.tenantId,
            image.id,
            image.originalPath,
            JSON.stringify(image.params),
            JSON.stringify(image.imageSet),
            image.alt,
          ],
        );
      });
      return ok(image);
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: String(error) });
    }
  }

  async findById(tenantId: string, imageId: string): Promise<Result<StoredImage, RepositoryError>> {
    try {
      const rows = await this.db.withTenant(tenantId, async (client) => {
        const result = await client.query<ImageRow>('SELECT * FROM images WHERE id = $1', [imageId]);
        return result.rows;
      });

      const row = rows[0];
      if (row === undefined) {
        return err({ kind: 'NOT_FOUND', id: imageId });
      }
      return ok({
        id: row.id,
        tenantId: row.tenant_id,
        originalPath: row.original_path,
        params: row.params,
        imageSet: row.image_set,
        alt: row.alt,
      });
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: String(error) });
    }
  }
}
