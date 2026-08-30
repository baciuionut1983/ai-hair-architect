import sharp from 'sharp';
import { describe, it, expect, vi } from 'vitest';
import { ImageProcessingError, stripExif, normalizeImage, processImageForStorage } from './image-normalizer';

// Stage 4 (EXIF / Image Orientation Hardening) -- real fixtures with GENUINE
// embedded EXIF Orientation tags, authored via sharp itself (empirically
// confirmed in this stage to actually write a real, readable Orientation
// tag even on a synthetic sharp `create:{}` canvas -- never assumed). This
// is what the pre-existing tests in this file lacked: every prior
// "orientation" test either fed sharp deliberately-undecodable byte
// fragments (asserting nothing about real orientation handling) or silently
// skipped its own assertion via `.catch(() => null)` + `if (result)`. Those
// gaps are exactly why the real double-rotation bug (Stage 3's live
// browser finding) went undetected until a real photo was visually
// inspected in an actual browser.
async function authorJpegFixture(width: number, height: number, orientation?: number): Promise<Buffer> {
  const pipeline = sharp({ create: { width, height, channels: 3, background: { r: 12, g: 34, b: 56 } } }).jpeg();
  return orientation === undefined ? pipeline.toBuffer() : pipeline.withMetadata({ orientation }).toBuffer();
}

async function readRawMetadata(buffer: Buffer) {
  const meta = await sharp(buffer).metadata();
  return { width: meta.width, height: meta.height, orientation: meta.orientation, hasExif: Boolean(meta.exif), hasIcc: Boolean(meta.icc) };
}

describe('Image Normalization', () => {
  describe('stripExif', () => {
    it('removes EXIF data from JPEG', async () => {
      const jpegWithExif = Buffer.from([
        0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00,
        0x00, 0x49, 0x49, 0x2a, 0x00,
      ]);

      const result = await stripExif(jpegWithExif);
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    // Stage 4 -- the real, previously-missing assertion: a genuine,
    // decodable JPEG with a real Orientation=6 EXIF tag must have NO EXIF
    // block at all in stripExif()'s own output, read back fresh (never
    // trusting the function's own return value as proof of its own effect).
    it('genuinely removes a real EXIF Orientation tag from a decodable JPEG, verified by a fresh independent read', async () => {
      const fixture = await authorJpegFixture(40, 30, 6);
      expect((await readRawMetadata(fixture)).orientation).toBe(6); // sanity: the fixture really has the tag

      const stripped = await stripExif(fixture);
      const strippedMeta = await readRawMetadata(stripped);
      expect(strippedMeta.hasExif).toBe(false);
      expect(strippedMeta.orientation).toBeUndefined();
      // stripExif alone never rotates pixels -- only normalizeImage does.
      expect(strippedMeta.width).toBe(40);
      expect(strippedMeta.height).toBe(30);
    });
  });

  describe('normalizeImage -- orientation test matrix (Stage 4)', () => {
    // Real fixtures per required orientation value + the no-tag case,
    // authored on a landscape (wide) canvas so a genuine physical rotation
    // (orientations 5/6/7/8) is independently observable via a width/height
    // swap, not just a claimed return value.
    const cases: Array<{ label: string; orientation: number | undefined; expectSwappedDimensions: boolean }> = [
      { label: 'Orientation 1 (upright, no rotation needed)', orientation: 1, expectSwappedDimensions: false },
      { label: 'Orientation 3 (180 degrees)', orientation: 3, expectSwappedDimensions: false },
      { label: 'Orientation 6 (90 degrees CW -- the exact real-world case that triggered this stage)', orientation: 6, expectSwappedDimensions: true },
      { label: 'Orientation 8 (270 degrees / 90 CCW)', orientation: 8, expectSwappedDimensions: true },
      { label: 'No Orientation tag present at all', orientation: undefined, expectSwappedDimensions: false },
    ];

    for (const { label, orientation, expectSwappedDimensions } of cases) {
      it(`${label}: physically correct pixels, orientation:1 return value, NO stale/any orientation tag survives`, async () => {
        const AUTHORED_WIDTH = 48;
        const AUTHORED_HEIGHT = 32;
        const fixture = await authorJpegFixture(AUTHORED_WIDTH, AUTHORED_HEIGHT, orientation);

        const result = await normalizeImage(fixture, 'image/jpeg');

        // The function's own reported orientation is always the normalized
        // value -- this was already true before Stage 4; what Stage 4 adds
        // is verifying the OUTPUT BYTES actually agree with it.
        expect(result.orientation).toBe(1);

        const expectedWidth = expectSwappedDimensions ? AUTHORED_HEIGHT : AUTHORED_WIDTH;
        const expectedHeight = expectSwappedDimensions ? AUTHORED_WIDTH : AUTHORED_HEIGHT;
        expect(result.width).toBe(expectedWidth);
        expect(result.height).toBe(expectedHeight);

        // The load-bearing Stage 4 assertion: a FRESH, independent sharp()
        // read of the actual returned buffer -- not the function's own
        // self-reported field -- must show no orientation tag (the stale-tag
        // bug) and no EXIF/ICC block at all (the "don't unnecessarily retain
        // metadata" requirement).
        const fresh = await readRawMetadata(result.buffer);
        expect(fresh.width).toBe(expectedWidth);
        expect(fresh.height).toBe(expectedHeight);
        expect(fresh.orientation).toBeUndefined();
        expect(fresh.hasExif).toBe(false);
        expect(fresh.hasIcc).toBe(false);
      });
    }

    it('a portrait-authored, upright (orientation 1) image is left exactly as-is (no accidental rotation)', async () => {
      const fixture = await authorJpegFixture(30, 48, 1);
      const result = await normalizeImage(fixture, 'image/jpeg');
      expect(result.width).toBe(30);
      expect(result.height).toBe(48);
      expect((await readRawMetadata(result.buffer)).hasExif).toBe(false);
    });

    it('handles various orientations', async () => {
      const pngData = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);

      const result = await normalizeImage(pngData, 'image/png').catch(() => null);
      if (result) {
        expect(result.orientation).toBe(1);
      }
    });

    // Regression coverage for the production VipsJpeg incident: a genuinely
    // undecodable buffer must still fail (failOn: 'none' only tolerates
    // non-fatal warnings, not the total absence of image data) -- but the
    // failure must reach callers as a safe, generic ImageProcessingError,
    // never the raw sharp/libvips error text (which used to leak straight
    // into the upload API response before this fix).
    it('throws ImageProcessingError (not a raw sharp/libvips error) for data with no decodable image content', async () => {
      const notActuallyAnImage = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);

      await expect(normalizeImage(notActuallyAnImage, 'image/jpeg')).rejects.toBeInstanceOf(ImageProcessingError);
    });

    it('the thrown error carries a safe, generic message with no library-internal detail leaked', async () => {
      const notActuallyAnImage = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(normalizeImage(notActuallyAnImage, 'image/jpeg')).rejects.toMatchObject({
          message: 'Could not process this image. Please try a different photo.',
        });
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('logs the real diagnostic detail server-side (safe fields only, never the image buffer) when processing fails', async () => {
      const notActuallyAnImage = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await normalizeImage(notActuallyAnImage, 'image/jpeg').catch(() => undefined);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string);
      expect(logged).toMatchObject({ gate: 'IMAGE_NORMALIZATION', status: 'FAILED', mimeType: 'image/jpeg' });
      expect(logged.bufferSizeBytes).toBe(notActuallyAnImage.length);
      consoleErrorSpy.mockRestore();
    });
  });

  // Stage 4 -- the single most important regression proof for the ordering
  // fix: processImageForStorage() must call normalizeImage() DIRECTLY on
  // the original buffer, never through a (correctly-stripping) stripExif()
  // pre-pass, or the Orientation signal normalizeImage needs would already
  // be gone by the time it runs, and real rotation would silently stop
  // happening for every future upload. This drives the FULL, real,
  // production entry point -- the same function image-analysis-service.ts
  // (uploads) and photo-preview-output-storage.ts (generated images) both
  // call -- never normalizeImage() in isolation.
  describe('processImageForStorage -- full pipeline (Stage 4 ordering-hazard regression)', () => {
    it('actually rotates a real Orientation=6 photo end-to-end and leaves no stale tag on the final stored bytes', async () => {
      const fixture = await authorJpegFixture(48, 32, 6);

      const processed = await processImageForStorage(fixture, 'image/jpeg');

      // Dimensions swapped -- proof a REAL physical rotation happened, not
      // just a claimed metadata value.
      expect(processed.width).toBe(32);
      expect(processed.height).toBe(48);
      expect(processed.orientation).toBe(1);
      expect(processed.exifStripped).toBe(true);

      const fresh = await readRawMetadata(processed.buffer);
      expect(fresh.width).toBe(32);
      expect(fresh.height).toBe(48);
      expect(fresh.orientation).toBeUndefined();
      expect(fresh.hasExif).toBe(false);
    });

    it('an upright (Orientation 1) photo is stored with unchanged dimensions and still no EXIF survives', async () => {
      const fixture = await authorJpegFixture(48, 32, 1);
      const processed = await processImageForStorage(fixture, 'image/jpeg');
      expect(processed.width).toBe(48);
      expect(processed.height).toBe(32);
      expect((await readRawMetadata(processed.buffer)).hasExif).toBe(false);
    });

    // The generated-image path (task #8/#11): persistGeneratedPhotoPreviewImage
    // (photo-preview-output-storage.ts) calls this exact same function on a
    // provider's returned bytes -- PNG output has no EXIF-orientation concept
    // at all, so the meaningful assertion here is that the SAME pipeline that
    // fixes JPEG orientation handles a PNG input correctly and introduces no
    // stale orientation of its own.
    it('a PNG (the generated-image path -- providers can return PNG) round-trips through the same fixed pipeline correctly', async () => {
      const pngFixture = await sharp({ create: { width: 64, height: 96, channels: 3, background: { r: 5, g: 6, b: 7 } } }).png().toBuffer();
      const processed = await processImageForStorage(pngFixture, 'image/png');
      expect(processed.width).toBe(64);
      expect(processed.height).toBe(96);
      expect(processed.orientation).toBe(1);
      expect((await readRawMetadata(processed.buffer)).hasExif).toBe(false);
    });
  });
});
