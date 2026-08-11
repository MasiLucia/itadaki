import { type ImageEditParams, validateEditParams } from '@itadaki/catalog/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';
import { type ImageReader, type ImageRenderer, type ImageWriter, type StoredImage } from './image-ports';
import { type RepositoryError } from './ports';

export type ImageEditFailure =
  | RepositoryError
  | { readonly kind: 'INVALID_PARAMS'; readonly field: string };

export interface UploadImageCommand {
  readonly tenantId: string;
  readonly imageId: string;
  readonly original: Buffer;
  readonly params: ImageEditParams;
  readonly alt: string;
}

/** First upload: stores the original, renders the set, records both. */
export function uploadImage(deps: {
  images: ImageWriter;
  renderer: ImageRenderer;
}) {
  return async (command: UploadImageCommand): Promise<Result<StoredImage, ImageEditFailure>> => {
    const validated = validateEditParams(command.params);
    if (validated.isErr()) {
      return err({
        kind: 'INVALID_PARAMS',
        field: 'field' in validated.error ? validated.error.field : 'crop',
      });
    }

    const stored = await deps.images.saveOriginal(command.tenantId, command.imageId, command.original);
    if (stored.isErr()) {
      return err(stored.error);
    }

    const rendered = await deps.renderer.render(
      command.original,
      validated.value,
      command.imageId,
      command.tenantId,
    );
    if (rendered.isErr()) {
      return err(rendered.error);
    }

    return deps.images
      .saveRecord({
        id: command.imageId,
        tenantId: command.tenantId,
        originalPath: stored.value,
        params: validated.value,
        imageSet: rendered.value,
        alt: command.alt,
      })
      .then((result) => (result.isErr() ? err(result.error) : ok(result.value)));
  };
}

export interface ReeditImageCommand {
  readonly tenantId: string;
  readonly imageId: string;
  readonly params: ImageEditParams;
  readonly alt?: string;
}

/**
 * Re-renders from the stored original with new parameters. Nothing is
 * uploaded again and no quality is lost, because every render starts from
 * the untouched source rather than from the previous output.
 */
export function reeditImage(deps: {
  images: ImageReader & ImageWriter;
  renderer: ImageRenderer;
}) {
  return async (command: ReeditImageCommand): Promise<Result<StoredImage, ImageEditFailure>> => {
    const validated = validateEditParams(command.params);
    if (validated.isErr()) {
      return err({
        kind: 'INVALID_PARAMS',
        field: 'field' in validated.error ? validated.error.field : 'crop',
      });
    }

    const existing = await deps.images.findById(command.tenantId, command.imageId);
    if (existing.isErr()) {
      return err(existing.error);
    }

    const original = await deps.images.readOriginal(command.tenantId, command.imageId);
    if (original.isErr()) {
      return err(original.error);
    }

    const rendered = await deps.renderer.render(
      original.value,
      validated.value,
      command.imageId,
      command.tenantId,
    );
    if (rendered.isErr()) {
      return err(rendered.error);
    }

    const record = await deps.images.saveRecord({
      ...existing.value,
      params: validated.value,
      imageSet: rendered.value,
      alt: command.alt ?? existing.value.alt,
    });

    return record.isErr() ? err(record.error) : ok(record.value);
  };
}
