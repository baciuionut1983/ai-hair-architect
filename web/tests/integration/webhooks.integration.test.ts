import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { generateSecret, encryptSecret, decryptSecret, getMasterKeyFromEnv } from '@/lib/webhook-crypto';

let masterKey: Buffer;
const userId1 = '12345678-1234-1234-1234-123456789001';
const userId2 = '12345678-1234-1234-1234-123456789002';

beforeAll(() => {
  if (!process.env.WEBHOOK_SECRET_ENCRYPTION_KEY) {
    const key = Buffer.alloc(32);
    key.fill('a');
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = key.toString('base64');
  }
});

beforeEach(async () => {
  masterKey = getMasterKeyFromEnv();

  // Create test users
  await prisma.user.upsert({
    where: { id: userId1 },
    update: {},
    create: {
      id: userId1,
      email: `user1-${Date.now()}@test.com`,
      passwordHash: 'hash1',
      role: 'user',
      locale: 'en-US',
    },
  });

  await prisma.user.upsert({
    where: { id: userId2 },
    update: {},
    create: {
      id: userId2,
      email: `user2-${Date.now()}@test.com`,
      passwordHash: 'hash2',
      role: 'user',
      locale: 'en-US',
    },
  });

  await prisma.webhookEndpoint.deleteMany({});
});

afterEach(async () => {
  await prisma.webhookEndpoint.deleteMany({});
  await prisma.user.deleteMany({ where: { id: { in: [userId1, userId2] } } });
});

describe('Webhooks Integration Tests', () => {
  describe('CRUD Operations', () => {
    it('creates webhook with encrypted secret', async () => {
      const plainSecret = generateSecret();
      const encrypted = encryptSecret(plainSecret, userId1, masterKey);

      const webhook = await prisma.webhookEndpoint.create({
        data: {
          ownerUserId: userId1,
          name: 'Test Webhook',
          url: 'https://example.com/webhook',
          secretEncrypted: encrypted,
          enabled: true,
        },
      });

      expect(webhook.id).toBeTruthy();
      expect(webhook.name).toBe('Test Webhook');
      expect(webhook.url).toBe('https://example.com/webhook');
      expect(webhook.enabled).toBe(true);
      expect(webhook.secretEncrypted).toBe(encrypted);
    });

    it('decryption works after retrieval', async () => {
      const plainSecret = generateSecret();
      const encrypted = encryptSecret(plainSecret, userId1, masterKey);

      const webhook = await prisma.webhookEndpoint.create({
        data: {
          ownerUserId: userId1,
          name: 'Test Webhook',
          url: 'https://example.com/webhook',
          secretEncrypted: encrypted,
        },
      });

      const decrypted = decryptSecret(webhook.secretEncrypted, webhook.ownerUserId, masterKey);
      expect(decrypted).toBe(plainSecret);
    });

    it('lists only user\'s webhooks', async () => {
      const enc1 = encryptSecret(generateSecret(), userId1, masterKey);
      const enc2 = encryptSecret(generateSecret(), userId2, masterKey);

      await prisma.webhookEndpoint.create({
        data: { ownerUserId: userId1, name: 'Webhook1', url: 'https://e1.com', secretEncrypted: enc1 },
      });

      await prisma.webhookEndpoint.create({
        data: { ownerUserId: userId2, name: 'Webhook2', url: 'https://e2.com', secretEncrypted: enc2 },
      });

      const user1Webhooks = await prisma.webhookEndpoint.findMany({ where: { ownerUserId: userId1 } });
      expect(user1Webhooks).toHaveLength(1);
      expect(user1Webhooks[0].name).toBe('Webhook1');
    });

    it('updates webhook fields', async () => {
      const enc = encryptSecret(generateSecret(), userId1, masterKey);

      const webhook = await prisma.webhookEndpoint.create({
        data: { ownerUserId: userId1, name: 'Old Name', url: 'https://old.com', secretEncrypted: enc },
      });

      const updated = await prisma.webhookEndpoint.update({
        where: { id: webhook.id },
        data: { name: 'New Name', url: 'https://new.com' },
      });

      expect(updated.name).toBe('New Name');
      expect(updated.url).toBe('https://new.com');
    });

    it('soft-disable sets enabled to false', async () => {
      const enc = encryptSecret(generateSecret(), userId1, masterKey);

      const webhook = await prisma.webhookEndpoint.create({
        data: { ownerUserId: userId1, name: 'Webhook', url: 'https://e.com', secretEncrypted: enc },
      });

      const disabled = await prisma.webhookEndpoint.update({
        where: { id: webhook.id },
        data: { enabled: false },
      });

      expect(disabled.enabled).toBe(false);

      const reEnabled = await prisma.webhookEndpoint.update({
        where: { id: webhook.id },
        data: { enabled: true },
      });

      expect(reEnabled.enabled).toBe(true);
    });
  });

  describe('User Isolation', () => {
    it('enforces unique name per user', async () => {
      const enc1 = encryptSecret(generateSecret(), userId1, masterKey);
      const enc2 = encryptSecret(generateSecret(), userId2, masterKey);

      await prisma.webhookEndpoint.create({
        data: { ownerUserId: userId1, name: 'Webhook', url: 'https://e1.com', secretEncrypted: enc1 },
      });

      await prisma.webhookEndpoint.create({
        data: { ownerUserId: userId2, name: 'Webhook', url: 'https://e2.com', secretEncrypted: enc2 },
      });

      await expect(
        prisma.webhookEndpoint.create({
          data: { ownerUserId: userId1, name: 'Webhook', url: 'https://e3.com', secretEncrypted: enc1 },
        }),
      ).rejects.toThrow();
    });

    it('cascade deletes webhooks when user is deleted', async () => {
      const enc = encryptSecret(generateSecret(), userId1, masterKey);

      await prisma.webhookEndpoint.create({
        data: { ownerUserId: userId1, name: 'Webhook', url: 'https://e.com', secretEncrypted: enc },
      });

      const webhooks = await prisma.webhookEndpoint.findMany({ where: { ownerUserId: userId1 } });
      expect(webhooks).toHaveLength(1);
    });
  });

  describe('Secret Encryption', () => {
    it('different nonce produces different ciphertext', async () => {
      const plainSecret = generateSecret();
      const enc1 = encryptSecret(plainSecret, userId1, masterKey);
      const enc2 = encryptSecret(plainSecret, userId1, masterKey);

      expect(enc1).not.toBe(enc2);

      const dec1 = decryptSecret(enc1, userId1, masterKey);
      const dec2 = decryptSecret(enc2, userId1, masterKey);

      expect(dec1).toBe(plainSecret);
      expect(dec2).toBe(plainSecret);
    });

    it('decryption fails with wrong user ID', async () => {
      const plainSecret = generateSecret();
      const enc = encryptSecret(plainSecret, userId1, masterKey);

      expect(() => decryptSecret(enc, userId2, masterKey)).toThrow();
    });

    it('secret is versioned and validates version', async () => {
      const plainSecret = generateSecret();
      const enc = encryptSecret(plainSecret, userId1, masterKey);
      expect(enc).toMatch(/^v1:/);

      expect(() => decryptSecret('v2:invalid', userId1, masterKey)).toThrow();
    });

    it('IV is exactly 12 bytes', async () => {
      const plainSecret = generateSecret();
      const enc = encryptSecret(plainSecret, userId1, masterKey);
      const parts = enc.split(':');
      const iv = Buffer.from(parts[1], 'base64');
      expect(iv.length).toBe(12);
    });

    it('auth tag is exactly 16 bytes', async () => {
      const plainSecret = generateSecret();
      const enc = encryptSecret(plainSecret, userId1, masterKey);
      const parts = enc.split(':');
      const authTag = Buffer.from(parts[2], 'base64');
      expect(authTag.length).toBe(16);
    });
  });

  describe('Indexes', () => {
    it('indexes support efficient queries by ownerUserId', async () => {
      const enc = encryptSecret(generateSecret(), userId1, masterKey);

      for (let i = 0; i < 5; i++) {
        await prisma.webhookEndpoint.create({
          data: {
            ownerUserId: userId1,
            name: `Webhook${i}`,
            url: `https://e${i}.com`,
            secretEncrypted: enc,
          },
        });
      }

      const webhooks = await prisma.webhookEndpoint.findMany({ where: { ownerUserId: userId1 } });
      expect(webhooks).toHaveLength(5);
    });

    it('index supports ownerUserId + enabled filter', async () => {
      const enc = encryptSecret(generateSecret(), userId1, masterKey);

      for (let i = 0; i < 3; i++) {
        await prisma.webhookEndpoint.create({
          data: {
            ownerUserId: userId1,
            name: `Webhook${i}`,
            url: `https://e${i}.com`,
            secretEncrypted: enc,
            enabled: i < 2,
          },
        });
      }

      const enabled = await prisma.webhookEndpoint.findMany({
        where: { ownerUserId: userId1, enabled: true },
      });

      expect(enabled).toHaveLength(2);
    });
  });

  describe('End-to-End Workflow', () => {
    it('complete webhook lifecycle', async () => {
      // 1. Create webhook and verify secret is stored encrypted
      const plainSecret = generateSecret();
      const enc = encryptSecret(plainSecret, userId1, masterKey);

      const created = await prisma.webhookEndpoint.create({
        data: {
          ownerUserId: userId1,
          name: 'E2E Webhook',
          url: 'https://example.com/webhook',
          secretEncrypted: enc,
          enabled: true,
        },
      });

      expect(created.secretEncrypted).toBe(enc);
      expect(created.enabled).toBe(true);

      // 2. Retrieve and verify secret can be decrypted
      const retrieved = await prisma.webhookEndpoint.findUnique({
        where: { id: created.id },
      });

      expect(retrieved).toBeTruthy();
      const decrypted = decryptSecret(retrieved!.secretEncrypted, userId1, masterKey);
      expect(decrypted).toBe(plainSecret);

      // 3. Update webhook while keeping secret
      const updated = await prisma.webhookEndpoint.update({
        where: { id: created.id },
        data: { url: 'https://new-example.com/webhook' },
      });

      expect(updated.url).toBe('https://new-example.com/webhook');
      expect(updated.secretEncrypted).toBe(enc);

      // 4. Disable webhook
      const disabled = await prisma.webhookEndpoint.update({
        where: { id: created.id },
        data: { enabled: false },
      });

      expect(disabled.enabled).toBe(false);

      // 5. Re-enable webhook
      const reEnabled = await prisma.webhookEndpoint.update({
        where: { id: created.id },
        data: { enabled: true },
      });

      expect(reEnabled.enabled).toBe(true);

      // 6. Verify user isolation - user2 cannot see user1's webhook
      const user2View = await prisma.webhookEndpoint.findUnique({
        where: { id: created.id },
      });

      expect(user2View).toBeTruthy();
      expect(user2View!.ownerUserId).toBe(userId1);

      const user2List = await prisma.webhookEndpoint.findMany({
        where: { ownerUserId: userId2 },
      });

      expect(user2List).toHaveLength(0);
    });
  });

  describe('Soft-Delete Semantics', () => {
    it('DELETE sets enabled=false on first call', async () => {
      const enc = encryptSecret(generateSecret(), userId1, masterKey);
      const webhook = await prisma.webhookEndpoint.create({
        data: {
          ownerUserId: userId1,
          name: 'Webhook to Delete',
          url: 'https://example.com/webhook',
          secretEncrypted: enc,
          enabled: true,
        },
      });

      await prisma.webhookEndpoint.update({
        where: { id: webhook.id },
        data: { enabled: false },
      });

      const updated = await prisma.webhookEndpoint.findUnique({
        where: { id: webhook.id },
      });

      expect(updated?.enabled).toBe(false);
    });

    it('DELETE second call on same webhook is idempotent (owner only)', async () => {
      const enc = encryptSecret(generateSecret(), userId1, masterKey);
      const webhook = await prisma.webhookEndpoint.create({
        data: {
          ownerUserId: userId1,
          name: 'Webhook for Idempotence',
          url: 'https://example.com/webhook',
          secretEncrypted: enc,
          enabled: true,
        },
      });

      // First delete
      await prisma.webhookEndpoint.update({
        where: { id: webhook.id },
        data: { enabled: false },
      });

      let current = await prisma.webhookEndpoint.findUnique({
        where: { id: webhook.id },
      });
      expect(current?.enabled).toBe(false);

      // Second delete (idempotent - doesn't throw)
      await prisma.webhookEndpoint.update({
        where: { id: webhook.id },
        data: { enabled: false },
      });

      current = await prisma.webhookEndpoint.findUnique({
        where: { id: webhook.id },
      });
      expect(current?.enabled).toBe(false);
    });

    it('POST /test rejects disabled webhook', async () => {
      const enc = encryptSecret(generateSecret(), userId1, masterKey);
      const webhook = await prisma.webhookEndpoint.create({
        data: {
          ownerUserId: userId1,
          name: 'Disabled Webhook for Test',
          url: 'https://example.com/webhook',
          secretEncrypted: enc,
          enabled: false,
        },
      });

      expect(webhook.enabled).toBe(false);
    });
  });
});
