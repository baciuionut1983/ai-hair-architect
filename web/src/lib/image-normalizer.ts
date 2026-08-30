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
    // Stage 4 fix -- deliberately NO .withMetadata() call here. Calling
    // .withMetadata() at all (even with only `{ density: 72 }`, as this used
    // to do) tells sharp to carry the ORIGINAL input's EXIF block -- Orientation
    // tag included -- through onto the output. That is the exact, confirmed
    // root cause of the real-browser "source and AI Photo Preview both render
    // rotated" bug: img.rotate(rotationDegrees) above already physically
    // rotates the pixel matrix to the correct, upright orientation, but the
    // stale Orientation tag (e.g. 6) survived unchanged in the output bytes,
    // causing every EXIF-aware consumer (browsers included) to rotate an
    // already-correct image a SECOND time. Omitting .withMetadata() entirely
    // is sharp's own documented default behavior for stripping ALL metadata
    // (EXIF -- including Orientation and GPS -- plus the ICC profile) from
    // the output, which both fixes the stale tag and satisfies "do not
    // unnecessarily retain sensitive/unneeded EXIF metadata" in one change.
    // Empirically verified (Stage 4 reproduction): the re-encoded buffer's
    // OWN fresh sharp().metadata() read now reports no orientation tag at
    // all (i.e. defaults to 1) and no EXIF/ICC block, while width/height
    // still correctly reflect the already-rotated pixel matrix -- exactly
    // the invariant this stage requires. `density` (previously hardcoded to
    // 72) is dropped along with the rest of the metadata: it is a print-DPI
    // hint with no effect on how any <img> tag renders in a browser, and no
    // test or caller in this codebase reads it.
    const normalizedBuffer = await img.toBuffer();
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

// Stage 4 fix -- same root fix as normalizeImage() above (no .withMetadata()
// call), so this function's own behavior now actually matches its name.
// This is no longer called from processImageForStorage() below (see that
// function's own comment for why) -- kept exported for any standalone
// metadata-stripping need and for its own direct test coverage.
export async function stripExif(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer, SHARP_INPUT_OPTIONS).toBuffer();
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
  // Stage 4 fix -- calls normalizeImage() DIRECTLY on the original buffer,
  // never through a stripExif() pre-pass. This is a deliberate ordering
  // fix, not just a redundancy cleanup: normalizeImage() must read the
  // ORIGINAL EXIF Orientation tag to know how much to physically rotate the
  // pixel matrix (its very first step is `metadata.orientation`). Running
  // a (correctly working) exif-stripping pass BEFORE that would destroy the
  // orientation signal before normalizeImage ever sees it, so no rotation
  // would ever be applied -- silently storing every future photo in its raw,
  // possibly-sideways physical orientation. (Today, before this stage,
  // stripExif() happened to be a no-op due to the SAME withMetadata() bug
  // fixed above, which is why this ordering hazard was not yet observable --
  // fixing stripExif() in place without ALSO removing it from this call
  // chain would have introduced a strictly worse regression than the bug
  // this stage fixes.) normalizeImage()'s own final encode step (fixed
  // above) already fully strips metadata from its OWN output, so a separate
  // stripping pass here is unnecessary as well as unsafe.
  const normalized = await normalizeImage(buffer, mimeType);

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
