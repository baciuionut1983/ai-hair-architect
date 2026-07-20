import crypto from 'crypto';

const ENCRYPTION_VERSION = 'v1';
const IV_LENGTH = 12; // bytes
const AUTH_TAG_LENGTH = 16; // bytes
const KEY_LENGTH = 32; // bytes (256 bits)

export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function encryptSecret(
  plaintext: string,
  ownerUserId: string,
  masterKey: Buffer,
): string {
  if (masterKey.length !== KEY_LENGTH) {
    throw new Error(`Master key must be exactly ${KEY_LENGTH} bytes`);
  }

  const nonce = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintextBuffer = Buffer.from(plaintext, 'hex');
  const additionalData = Buffer.from(ownerUserId);

  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, nonce);
  cipher.setAAD(additionalData);

  let encrypted = cipher.update(plaintextBuffer);
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  const ivBase64 = Buffer.from(nonce).toString('base64');
  const authTagBase64 = authTag.toString('base64');
  const ciphertextBase64 = encrypted.toString('base64');

  return `${ENCRYPTION_VERSION}:${ivBase64}:${authTagBase64}:${ciphertextBase64}`;
}

export function decryptSecret(
  encrypted: string,
  ownerUserId: string,
  masterKey: Buffer,
): string {
  if (masterKey.length !== KEY_LENGTH) {
    throw new Error(`Master key must be exactly ${KEY_LENGTH} bytes`);
  }

  const parts = encrypted.split(':');
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) {
    throw new Error('Invalid secret format');
  }

  let nonce: Buffer;
  let ciphertext: Buffer;
  let authTag: Buffer;

  try {
    nonce = Buffer.from(parts[1], 'base64');
    authTag = Buffer.from(parts[2], 'base64');
    ciphertext = Buffer.from(parts[3], 'base64');
  } catch {
    throw new Error('Invalid secret encoding');
  }

  if (nonce.length !== IV_LENGTH) {
    throw new Error(`Invalid nonce length: expected ${IV_LENGTH}, got ${nonce.length}`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`);
  }

  const additionalData = Buffer.from(ownerUserId);

  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, nonce);
  decipher.setAAD(additionalData);
  decipher.setAuthTag(authTag);

  try {
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('hex').toUpperCase();
  } catch {
    throw new Error('Secret decryption failed: authentication tag mismatch or corrupted data');
  }
}

export function hmacSignPayload(
  payload: string,
  timestamp: string,
  secret: string,
): string {
  const canonicalString = `${timestamp}.${payload}`;
  const hmac = crypto.createHmac('sha256', Buffer.from(secret, 'hex'));
  hmac.update(canonicalString, 'utf-8');
  const digest = hmac.digest('base64');
  return `sha256=${digest}`;
}

export function verifyHmacSignature(
  payload: string,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  const expectedSignature = hmacSignPayload(payload, timestamp, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

export function getMasterKeyFromEnv(): Buffer {
  const keyString = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;

  if (!keyString) {
    throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY environment variable is required');
  }

  let keyBuffer: Buffer;
  try {
    keyBuffer = Buffer.from(keyString, 'base64');
  } catch {
    throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY must be valid Base64');
  }

  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(
      `WEBHOOK_SECRET_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH} bytes (256 bits), got ${keyBuffer.length}`,
    );
  }

  return keyBuffer;
}
