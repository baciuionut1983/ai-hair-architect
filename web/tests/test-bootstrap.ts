import crypto from 'crypto';

export function ensureWebhookSecretEncryptionKey(): string {
  if (process.env.WEBHOOK_SECRET_ENCRYPTION_KEY) {
    return process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  }

  const key = crypto.randomBytes(32).toString('base64');
  process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = key;
  return key;
}

function preferTestDatabaseForTests(): void {
  if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }
}

ensureWebhookSecretEncryptionKey();
preferTestDatabaseForTests();
