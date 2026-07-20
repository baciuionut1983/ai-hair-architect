import { describe, it, expect } from 'vitest';
import {
  generateSecret,
  encryptSecret,
  decryptSecret,
  hmacSignPayload,
  verifyHmacSignature,
  getMasterKeyFromEnv,
} from '@/lib/webhook-crypto';

const testMasterKey = Buffer.from('a'.repeat(64), 'hex'); // 32 bytes
const testUserId = '12345678-1234-1234-1234-123456789012';

describe('Webhook Crypto', () => {
  describe('generateSecret', () => {
    it('generates 64 character hex string', () => {
      const secret = generateSecret();
      expect(secret).toMatch(/^[A-F0-9]{64}$/);
    });

    it('generates different secrets on each call', () => {
      const secret1 = generateSecret();
      const secret2 = generateSecret();
      expect(secret1).not.toBe(secret2);
    });
  });

  describe('encryptSecret', () => {
    it('encrypts plaintext secret', () => {
      const plaintext = generateSecret();
      const encrypted = encryptSecret(plaintext, testUserId, testMasterKey);
      expect(encrypted).toMatch(/^v1:.+:.+:.+$/);
    });

    it('produces different ciphertexts for same plaintext (different nonce)', () => {
      const plaintext = generateSecret();
      const encrypted1 = encryptSecret(plaintext, testUserId, testMasterKey);
      const encrypted2 = encryptSecret(plaintext, testUserId, testMasterKey);
      expect(encrypted1).not.toBe(encrypted2);
    });
  });

  describe('decryptSecret', () => {
    it('decrypts correctly with same user ID', () => {
      const plaintext = generateSecret();
      const encrypted = encryptSecret(plaintext, testUserId, testMasterKey);
      const decrypted = decryptSecret(encrypted, testUserId, testMasterKey);
      expect(decrypted).toBe(plaintext);
    });

    it('fails to decrypt with different user ID', () => {
      const plaintext = generateSecret();
      const encrypted = encryptSecret(plaintext, testUserId, testMasterKey);
      const differentUserId = '87654321-4321-4321-4321-210987654321';

      expect(() => decryptSecret(encrypted, differentUserId, testMasterKey)).toThrow();
    });

    it('fails with invalid format', () => {
      expect(() => decryptSecret('invalid', testUserId, testMasterKey)).toThrow();
    });

    it('fails with wrong version', () => {
      expect(() => decryptSecret('v2:abc:def:ghi', testUserId, testMasterKey)).toThrow();
    });
  });

  describe('hmacSignPayload', () => {
    it('generates consistent signature for same inputs', () => {
      const payload = '{"event":"test"}';
      const timestamp = '2026-07-18T12:00:00.000Z';
      const secret = generateSecret();

      const sig1 = hmacSignPayload(payload, timestamp, secret);
      const sig2 = hmacSignPayload(payload, timestamp, secret);

      expect(sig1).toBe(sig2);
    });

    it('generates different signature for different payload', () => {
      const timestamp = '2026-07-18T12:00:00.000Z';
      const secret = generateSecret();

      const sig1 = hmacSignPayload('{"event":"test1"}', timestamp, secret);
      const sig2 = hmacSignPayload('{"event":"test2"}', timestamp, secret);

      expect(sig1).not.toBe(sig2);
    });

    it('signature starts with sha256=', () => {
      const payload = '{"event":"test"}';
      const timestamp = '2026-07-18T12:00:00.000Z';
      const secret = generateSecret();

      const sig = hmacSignPayload(payload, timestamp, secret);
      expect(sig).toMatch(/^sha256=/);
    });

    it('signature includes base64 after =', () => {
      const payload = '{"event":"test"}';
      const timestamp = '2026-07-18T12:00:00.000Z';
      const secret = generateSecret();

      const sig = hmacSignPayload(payload, timestamp, secret);
      const base64Part = sig.replace('sha256=', '');
      expect(base64Part).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
  });

  describe('verifyHmacSignature', () => {
    it('verifies correct signature', () => {
      const payload = '{"event":"test"}';
      const timestamp = '2026-07-18T12:00:00.000Z';
      const secret = generateSecret();

      const signature = hmacSignPayload(payload, timestamp, secret);
      const isValid = verifyHmacSignature(payload, timestamp, signature, secret);

      expect(isValid).toBe(true);
    });

    it('rejects signature from different payload', () => {
      const timestamp = '2026-07-18T12:00:00.000Z';
      const secret = generateSecret();

      const signature = hmacSignPayload('{"event":"test1"}', timestamp, secret);
      const isValid = verifyHmacSignature('{"event":"test2"}', timestamp, signature, secret);

      expect(isValid).toBe(false);
    });

    it('rejects signature from different secret', () => {
      const payload = '{"event":"test"}';
      const timestamp = '2026-07-18T12:00:00.000Z';
      const secret1 = generateSecret();
      const secret2 = generateSecret();

      const signature = hmacSignPayload(payload, timestamp, secret1);
      const isValid = verifyHmacSignature(payload, timestamp, signature, secret2);

      expect(isValid).toBe(false);
    });

    it('rejects signature from different timestamp', () => {
      const payload = '{"event":"test"}';
      const secret = generateSecret();

      const signature = hmacSignPayload(payload, '2026-07-18T12:00:00.000Z', secret);
      const isValid = verifyHmacSignature(payload, '2026-07-18T13:00:00.000Z', signature, secret);

      expect(isValid).toBe(false);
    });

    it('rejects tampered signature', () => {
      const payload = '{"event":"test"}';
      const timestamp = '2026-07-18T12:00:00.000Z';
      const secret = generateSecret();

      const signature = hmacSignPayload(payload, timestamp, secret);
      const tamperedSignature = signature.replace(/.$/, 'A');

      const isValid = verifyHmacSignature(payload, timestamp, tamperedSignature, secret);

      expect(isValid).toBe(false);
    });
  });

  describe('getMasterKeyFromEnv', () => {
    it('throws if WEBHOOK_SECRET_ENCRYPTION_KEY not set', () => {
      const originalEnv = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
      delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;

      try {
        expect(() => getMasterKeyFromEnv()).toThrow('WEBHOOK_SECRET_ENCRYPTION_KEY environment variable is required');
      } finally {
        process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalEnv;
      }
    });

    it('throws if key is not valid Base64', () => {
      const originalEnv = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = 'not-valid-base64!!!';

      try {
        expect(() => getMasterKeyFromEnv()).toThrow();
      } finally {
        process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalEnv;
      }
    });

    it('throws if decoded key is not 32 bytes', () => {
      const originalEnv = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.from('short').toString('base64');

      try {
        expect(() => getMasterKeyFromEnv()).toThrow();
      } finally {
        process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalEnv;
      }
    });
  });
});
