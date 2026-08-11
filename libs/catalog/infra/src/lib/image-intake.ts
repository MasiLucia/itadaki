import { type Result, err, ok } from '@itadaki/shared/domain';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export type IntakeError =
  | { readonly kind: 'TOO_LARGE'; readonly bytes: number; readonly limit: number }
  | { readonly kind: 'EMPTY_FILE' }
  | { readonly kind: 'UNSUPPORTED_TYPE'; readonly detected: string };

export type DetectedType = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'unknown';

const startsWith = (buffer: Buffer, bytes: readonly number[], offset = 0): boolean =>
  bytes.every((byte, index) => buffer[offset + index] === byte);

/**
 * Identifies the real format from the file's magic bytes. A filename or a
 * client-supplied Content-Type can claim anything; the bytes cannot.
 */
export function detectImageType(buffer: Buffer): DetectedType {
  if (buffer.length < 12) return 'unknown';

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return 'gif';

  // RIFF....WEBP
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }

  // ....ftypavif / ftypavis
  if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }

  return 'unknown';
}

const ACCEPTED: readonly DetectedType[] = ['jpeg', 'png', 'webp', 'avif'];

/** Gate every upload before it reaches sharp. */
export function validateUpload(buffer: Buffer): Result<DetectedType, IntakeError> {
  if (buffer.length === 0) {
    return err({ kind: 'EMPTY_FILE' });
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return err({ kind: 'TOO_LARGE', bytes: buffer.length, limit: MAX_UPLOAD_BYTES });
  }

  const detected = detectImageType(buffer);
  if (!ACCEPTED.includes(detected)) {
    return err({ kind: 'UNSUPPORTED_TYPE', detected });
  }

  return ok(detected);
}
