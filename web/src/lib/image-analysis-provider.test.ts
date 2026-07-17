import { describe, it, expect } from 'vitest';
import { MockDeterministicProvider, ManualOnlyProvider } from './image-analysis-provider';

describe('Image Analysis Providers', () => {
  describe('MockDeterministicProvider', () => {
    it('returns deterministic results', async () => {
      const provider = new MockDeterministicProvider();
      const buffer = Buffer.from('test image data');

      const result1 = await provider.analyze({
        imageBuffer: buffer,
        mimeType: 'image/jpeg',
        userId: 'user-1',
        clientId: 'client-1',
      });

      const result2 = await provider.analyze({
        imageBuffer: buffer,
        mimeType: 'image/jpeg',
        userId: 'user-2',
        clientId: 'client-2',
      });

      expect(result1.result.hairType).toBe(result2.result.hairType);
      expect(result1.result.density).toBe(result2.result.density);
    });

    it('produces valid confidence scores', async () => {
      const provider = new MockDeterministicProvider();
      const result = await provider.analyze({
        imageBuffer: Buffer.from('test'),
        mimeType: 'image/jpeg',
        userId: 'user',
        clientId: 'client',
      });

      Object.values(result.confidences).forEach(conf => {
        expect(conf).toBeGreaterThanOrEqual(0);
        expect(conf).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('ManualOnlyProvider', () => {
    it('returns all unknown values', async () => {
      const provider = new ManualOnlyProvider();
      const result = await provider.analyze();

      expect(result.result.hairType).toBe('unknown');
      expect(result.result.density).toBe('unknown');
      expect(Object.values(result.confidences).every(c => c === 0)).toBe(true);
    });

    it('indicates manual review required', async () => {
      const provider = new ManualOnlyProvider();
      const result = await provider.analyze();

      expect(result.warnings).toContain('Manual review required for all fields');
    });
  });
});
