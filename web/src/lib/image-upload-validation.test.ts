import { describe, it, expect } from 'vitest';
import {
  validateUploadBatch,
  validateMagicBytes,
  sanitizeFileName,
  MAX_FILE_SIZE,
  MAX_IMAGES,
} from './image-upload-validation';

describe('Image Upload Validation', () => {
  describe('validateUploadBatch', () => {
    it('accepts valid batch', () => {
      const files = [
        new File([Buffer.alloc(1000)], 'test.jpg', { type: 'image/jpeg' }),
      ];
      const result = validateUploadBatch(files);
      expect(result).toBeNull();
    });

    it('rejects too many files', () => {
      const files = Array.from({ length: MAX_IMAGES + 1 }, (_, i) =>
        new File([Buffer.alloc(1000)], `test${i}.jpg`, { type: 'image/jpeg' })
      );
      const result = validateUploadBatch(files);
      expect(result?.code).toBe('TOO_MANY_FILES');
    });

    it('rejects file too large', () => {
      const files = [
        new File([Buffer.alloc(MAX_FILE_SIZE + 1)], 'test.jpg', { type: 'image/jpeg' }),
      ];
      const result = validateUploadBatch(files);
      expect(result?.code).toBe('FILE_TOO_LARGE');
    });

    it('rejects invalid mimetype', () => {
      const files = [
        new File([Buffer.alloc(1000)], 'test.svg', { type: 'image/svg+xml' }),
      ];
      const result = validateUploadBatch(files);
      expect(result?.code).toBe('INVALID_MIMETYPE');
    });
  });

  describe('validateMagicBytes', () => {
    it('validates jpeg magic bytes', async () => {
      const buffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const valid = await validateMagicBytes(buffer.buffer, 'image/jpeg');
      expect(valid).toBe(true);
    });

    it('validates png magic bytes', async () => {
      const buffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
      const valid = await validateMagicBytes(buffer.buffer, 'image/png');
      expect(valid).toBe(true);
    });

    it('rejects invalid magic bytes', async () => {
      const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      const valid = await validateMagicBytes(buffer.buffer, 'image/jpeg');
      expect(valid).toBe(false);
    });
  });

  describe('sanitizeFileName', () => {
    it('removes special characters', () => {
      const name = sanitizeFileName('test<>|*.jpg');
      expect(name).not.toMatch(/[<>|*]/);
    });

    it('preserves safe characters', () => {
      const name = sanitizeFileName('my-photo_001.jpg');
      expect(name).toBe('my-photo_001.jpg');
    });
  });
});
