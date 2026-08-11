import { type ImageEditParams, type ImageSet } from '@itadaki/catalog/domain';
import { type Result } from '@itadaki/shared/domain';
import { type RepositoryError } from './ports';

/** One stored image: the untouched original plus the params last applied. */
export interface StoredImage {
  readonly id: string;
  readonly tenantId: string;
  readonly originalPath: string;
  readonly params: ImageEditParams;
  readonly imageSet: ImageSet;
  readonly alt: string;
}

export interface ImageReader {
  findById(tenantId: string, imageId: string): Promise<Result<StoredImage, RepositoryError>>;
}

export interface ImageWriter {
  /** Persists the original once; re-edits reuse it rather than re-uploading. */
  saveOriginal(tenantId: string, imageId: string, data: Buffer): Promise<Result<string, RepositoryError>>;
  saveRecord(image: StoredImage): Promise<Result<StoredImage, RepositoryError>>;
  readOriginal(tenantId: string, imageId: string): Promise<Result<Buffer, RepositoryError>>;
}

/** Renders the derivative set. Kept behind a port so sharp stays in infra. */
export interface ImageRenderer {
  render(
    original: Buffer,
    params: ImageEditParams,
    imageId: string,
    tenantId: string,
  ): Promise<Result<ImageSet, RepositoryError>>;
}
