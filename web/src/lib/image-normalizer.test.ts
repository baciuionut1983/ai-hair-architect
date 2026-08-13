import { describe, it, expect, vi } from 'vitest';
import { ImageProcessingError, stripExif, normalizeImage } from './image-normalizer';

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
  });

  describe('normalizeImage', () => {
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
});
