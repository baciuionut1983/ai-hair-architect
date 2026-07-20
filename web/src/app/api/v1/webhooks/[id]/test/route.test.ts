import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  webhookEndpoint: {
    findUnique: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/middleware/analytics-auth', () => ({
  validateAnalyticsAccess: vi.fn(),
  createAuthErrorResponse: vi.fn(),
  AnalyticsAuthError: class AnalyticsAuthError extends Error {},
}));

vi.mock('@/lib/webhook-crypto', () => ({
  decryptSecret: vi.fn(),
  hmacSignPayload: vi.fn(),
  getMasterKeyFromEnv: vi.fn(),
}));

vi.mock('@/lib/webhook-safe-http-client', () => ({
  sendWebhookRequestSafe: vi.fn(),
  WebhookSafeHttpError: class WebhookSafeHttpError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { validateAnalyticsAccess } from '@/middleware/analytics-auth';
import { decryptSecret, hmacSignPayload, getMasterKeyFromEnv } from '@/lib/webhook-crypto';
import { sendWebhookRequestSafe } from '@/lib/webhook-safe-http-client';

describe('POST /api/v1/webhooks/[id]/test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAnalyticsAccess).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getMasterKeyFromEnv).mockReturnValue(Buffer.alloc(32));
    vi.mocked(decryptSecret).mockReturnValue('plain-secret');
    vi.mocked(hmacSignPayload).mockReturnValue('sha256=signature');
    vi.mocked(prisma.webhookEndpoint.findUnique).mockResolvedValue({
      id: 'webhook-1',
      ownerUserId: 'user-1',
      enabled: true,
      url: 'https://example.com/webhook',
      secretEncrypted: 'v1:encrypted',
    } as never);
  });

  it('reports upstream 500 responses as failed deliveries', async () => {
    vi.mocked(sendWebhookRequestSafe).mockResolvedValue({
      statusCode: 500,
      responseTimeMs: 42,
      truncated: false,
    });

    const response = await POST({} as never, { params: Promise.resolve({ id: 'webhook-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('failed');
    expect(body.httpStatus).toBe(500);
    expect(body.error).toBe('WEBHOOK_UPSTREAM_ERROR');
    expect(body.webhookId).toBe('webhook-1');
  });
});