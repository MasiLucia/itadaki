import {
  type ImageReader,
  type ImageRenderer,
  type ImageWriter,
  type StoredImage,
} from '@itadaki/catalog/application/server';
import { type RepositoryError } from '@itadaki/catalog/application';
import { type ImageEditParams, type ImageSet } from '@itadaki/catalog/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type BlobStorage, DiskBlobStorage } from './blob-storage';
import sharp from 'sharp';
import { renderImageSet, toImageSet } from './image-renderer';

/**
 * Disk-backed store standing in for S3/MinIO. The layout mirrors what an
 * object store would use, so swapping in a bucket client changes only this file.
 */
export class LocalImageStore implements ImageReader, ImageWriter {
  private readonly records = new Map<string, StoredImage>();
  private hydrated = false;

  constructor(private readonly rootDir: string) {}

  /**
   * Rebuilds the index from disk on first read. Without this the rendered
   * files survive a restart but the menu forgets they exist.
   */
  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;

    try {
      const tenants = await readdir(this.rootDir, { withFileTypes: true });
      for (const tenant of tenants.filter((entry) => entry.isDirectory())) {
        const images = await readdir(join(this.rootDir, tenant.name), { withFileTypes: true });
        for (const image of images.filter((entry) => entry.isDirectory())) {
          try {
            const raw = await readFile(join(this.rootDir, tenant.name, image.name, 'record.json'), 'utf-8');
            const record = JSON.parse(raw) as StoredImage;
            this.records.set(this.key(tenant.name, image.name), record);
          } catch {
            // A directory without a record is a half-finished render; skip it.
          }
        }
      }
    } catch {
      // No store yet; the first upload creates it.
    }
  }

  private key(tenantId: string, imageId: string): string {
    return `${tenantId}/${imageId}`;
  }

  private dirFor(tenantId: string, imageId: string): string {
    return join(this.rootDir, tenantId, imageId);
  }

  async saveOriginal(
    tenantId: string,
    imageId: string,
    data: Buffer,
  ): Promise<Result<string, RepositoryError>> {
    try {
      const dir = this.dirFor(tenantId, imageId);
      await mkdir(dir, { recursive: true });
      const path = join(dir, 'original');
      await writeFile(path, data);
      return ok(path);
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: `could not store original: ${String(error)}` });
    }
  }

  async readOriginal(tenantId: string, imageId: string): Promise<Result<Buffer, RepositoryError>> {
    try {
      return ok(await readFile(join(this.dirFor(tenantId, imageId), 'original')));
    } catch {
      return err({ kind: 'NOT_FOUND', id: imageId });
    }
  }

  async saveRecord(image: StoredImage): Promise<Result<StoredImage, RepositoryError>> {
    this.records.set(this.key(image.tenantId, image.id), image);
    try {
      const dir = this.dirFor(image.tenantId, image.id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'record.json'), JSON.stringify(image, null, 2));
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: `could not persist record: ${String(error)}` });
    }
    return ok(image);
  }

  async findById(tenantId: string, imageId: string): Promise<Result<StoredImage, RepositoryError>> {
    await this.hydrate();
    const found = this.records.get(this.key(tenantId, imageId));
    return found === undefined ? err({ kind: 'NOT_FOUND', id: imageId }) : ok(found);
  }

  /** Variant bytes for the HTTP layer to serve. */
  async readVariant(
    tenantId: string,
    imageId: string,
    file: string,
  ): Promise<Result<Buffer, RepositoryError>> {
    try {
      return ok(await readFile(join(this.dirFor(tenantId, imageId), file)));
    } catch {
      return err({ kind: 'NOT_FOUND', id: file });
    }
  }
}

export class SharpImageRenderer implements ImageRenderer {
  private readonly blobs: BlobStorage;

  constructor(
    storage: BlobStorage | string,
    private readonly publicBase: string,
  ) {
    // A plain path still works, so existing callers keep their behaviour.
    this.blobs = typeof storage === 'string' ? new DiskBlobStorage(storage) : storage;
  }

  async render(
    original: Buffer,
    params: ImageEditParams,
    imageId: string,
    tenantId: string,
  ): Promise<Result<ImageSet, RepositoryError>> {
    try {
      // Strip EXIF before anything else: orientation is baked in by rotate(),
      // and the remaining metadata (GPS, device) never reaches disk.
      const clean = await sharp(original).rotate().toBuffer();

      const rendered = await renderImageSet(clean, params);

      // Same key shape the store reads back from, so disk and bucket agree.
      await Promise.all(
        rendered.variants.map((variant) =>
          this.blobs.put(
            `${tenantId}/${imageId}/${variant.width}.${variant.format}`,
            variant.data,
          ),
        ),
      );

      // The URL must match the route that serves it (`/images/:id/:file`);
      // the tenant travels as a query parameter, not a path segment.
      return ok(
        toImageSet(
          rendered,
          (variant) =>
            `${this.publicBase}/${imageId}/${variant.width}.${variant.format}?tenant=${tenantId}`,
          '',
        ),
      );
    } catch (error) {
      return err({ kind: 'CONFLICT', detail: `render failed: ${String(error)}` });
    }
  }
}
