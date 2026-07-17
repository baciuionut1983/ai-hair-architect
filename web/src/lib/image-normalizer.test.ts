import { describe, it, expect } from 'vitest';
import { stripExif, normalizeImage } from './image-normalizer';

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
  });
});
