/**
 * Server-only surface. These ports traffic in Buffers, so they stay out of the
 * main barrel — importing them from a browser app would pull node types in.
 */
export {
  type StoredImage,
  type ImageReader,
  type ImageWriter,
  type ImageRenderer,
} from './lib/image-ports';
export {
  uploadImage,
  reeditImage,
  type UploadImageCommand,
  type ReeditImageCommand,
  type ImageEditFailure,
} from './lib/edit-product-image';
