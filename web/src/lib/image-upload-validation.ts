export const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_FILE_SIZE = 8 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 24 * 1024 * 1024;
export const MAX_IMAGES = 4;

export const MIME_MAGIC_BYTES: Record<string, Uint8Array> = {
  'image/jpeg': new Uint8Array([0xff, 0xd8, 0xff]),
  'image/png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  'image/webp': new Uint8Array([0x52, 0x49, 0x46, 0x46]),
};

export interface UploadValidationError {
  code: 'INVALID_MIMETYPE' | 'FILE_TOO_LARGE' | 'TOTAL_TOO_LARGE' | 'TOO_MANY_FILES' | 'INVALID_MAGIC_BYTES' | 'CORRUPTED_FILE' | 'UNSUPPORTED_FORMAT' | 'ANIMATED_FILE';
  message: string;
}

export function validateUploadBatch(
  files: File[],
  existingTotalSize: number = 0
): UploadValidationError | null {
  if (files.length === 0) return null;
  if (files.length > MAX_IMAGES) {
    return { code: 'TOO_MANY_FILES', message: `Maximum ${MAX_IMAGES} images allowed` };
  }

  let totalSize = existingTotalSize;
  for (const file of files) {
    if (!ALLOWED_MIMETYPES.includes(file.type as typeof ALLOWED_MIMETYPES[number])) {
      return { code: 'INVALID_MIMETYPE', message: `Unsupported format: ${file.type}` };
    }
    if (file.size > MAX_FILE_SIZE) {
      return { code: 'FILE_TOO_LARGE', message: `File too large: ${file.name} (${file.size} > ${MAX_FILE_SIZE})` };
    }
    totalSize += file.size;
  }

  if (totalSize > MAX_TOTAL_SIZE) {
    return { code: 'TOTAL_TOO_LARGE', message: `Total size exceeds ${MAX_TOTAL_SIZE}` };
  }

  return null;
}

export async function validateMagicBytes(buffer: ArrayBuffer, mimeType: string): Promise<boolean> {
  const expected = MIME_MAGIC_BYTES[mimeType];
  if (!expected) return false;

  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < expected.length; i++) {
    if (bytes[i] !== expected[i]) return false;
  }
  return true;
}

export function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[^a-z0-9._-]/gi, '_')
    .substring(0, 255);
}
