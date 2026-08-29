import sharp from 'sharp';

export interface NormalizedImageResult {
  buffer: Buffer;
  mimeType: string;
  orientation: number;
  width: number;
  height: number;
}

// Thrown only with a safe, generic, user-facing message -- the real
// sharp/libvips error (which can be verbose but is never sensitive: it
// describes file structure, never image content or secrets) is logged
// server-side by the caller before this is thrown.
export class ImageProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

// sharp/libvips defaults to treating certain non-fatal JPEG warnings (e.g.
// trailing data after EOI, unusual restart markers, or partial metadata --
// all common in real phone/camera JPEGs, especially iOS exports with MPF/
// Live Photo trailers) as hard failures. `failOn: 'none'` matches the
// leniency every browser's own JPEG decoder already has -- a photo a
// browser can render is not "corrupted" just because libvips is stricter
// by default. A file with genuinely no decodable image data still throws
// (there is nothing lenient about zero pixels), so this does not weaken
// rejection of truly invalid files.
const SHARP_INPUT_OPTIONS = { failOn: 'none' as const };

export async function normalizeImage(buffer: Buffer, mimeType: string): Promise<NormalizedImageResult> {
  let img: sharp.Sharp;
  let orientation: number;
  try {
    img = sharp(buffer, SHARP_INPUT_OPTIONS);
    const metadata = await img.metadata();
    orientation = metadata.orientation || 1;
  } catch (error) {
    logImageProcessingFailure('metadata_read', buffer.length, mimeType, error);
    throw new ImageProcessingError('Could not process this image. Please try a different photo.');
  }

  let rotationDegrees = 0;
  switch (orientation) {
    case 2:
      img = img.flop();
      break;
    case 3:
      rotationDegrees = 180;
      break;
    case 4:
      img = img.flip();
      break;
    case 5:
      rotationDegrees = 90;
      img = img.flop();
      break;
    case 6:
      rotationDegrees = 90;
      break;
    case 7:
      rotationDegrees = 270;
      img = img.flop();
      break;
    case 8:
      rotationDegrees = 270;
      break;
  }

  if (rotationDegrees > 0) {
    img = img.rotate(rotationDegrees);
  }

  try {
    const normalizedBuffer = await img.withMetadata({ density: 72 }).toBuffer();
    const newMetadata = await sharp(normalizedBuffer, SHARP_INPUT_OPTIONS).metadata();

    return {
      buffer: normalizedBuffer,
      mimeType,
      orientation: 1,
      width: newMetadata.width || 0,
      height: newMetadata.height || 0,
    };
  } catch (error) {
    logImageProcessingFailure('re_encode', buffer.length, mimeType, error);
    throw new ImageProcessingError('Could not process this image. Please try a different photo.');
  }
}

export async function stripExif(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer, SHARP_INPUT_OPTIONS).withMetadata({ density: 72 }).toBuffer();
  } catch {
    return buffer;
  }
}

// Structured, safe-fields-only diagnostic log (same convention as
// storage-readiness-canary.ts's logOutcome) -- never the image buffer
// itself, only its size and the sharp/libvips error text (which describes
// file structure, never image content or secrets).
function logImageProcessingFailure(stage: 'metadata_read' | 're_encode', bufferSizeBytes: number, mimeType: string, error: unknown): void {
  console.error(
    JSON.stringify({
      gate: 'IMAGE_NORMALIZATION',
      status: 'FAILED',
      stage,
      mimeType,
      bufferSizeBytes,
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
    }),
  );
}

export async function processImageForStorage(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; orientation: number; exifStripped: boolean; width: number; height: number }> {
  const noExifBuffer = await stripExif(buffer);
  const normalized = await normalizeImage(noExifBuffer, mimeType);

  // Technical Visual Map, Stage 5B -- width/height of the FINAL
  // normalized/re-encoded bytes (the same ones actually persisted and later
  // served) were already computed by normalizeImage() above; threading them
  // through here is the only change needed -- never recomputed independently.
  return {
    buffer: normalized.buffer,
    orientation: normalized.orientation,
    exifStripped: true,
    width: normalized.width,
    height: normalized.height,
  };
}
