import { test, expect } from '@playwright/test';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { createAuthedApi, generateE2EToken } from './auth-helper';

interface WebhookTestContext {
  userId1: string;
  userId2: string;
  authToken1: string;
  authToken2: string;
}

test.describe('Webhooks E2E API Tests', () => {
  let testContext: WebhookTestContext;
  const testRunId = Math.random().toString(36).substring(7);

  test.beforeEach(async ({ request }) => {
    const uniqueId = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const userId1 = `e2e-webhook-user1-${testRunId}-${uniqueId}`;
    const userId2 = `e2e-webhook-user2-${testRunId}-${uniqueId}`;
    const token1 = generateE2EToken();
    const token2 = generateE2EToken();

    // Create test users and sessions
    const user1 = await prisma.user.create({
      data: {
        id: userId1,
        email: `e2e-test-1-${Date.now()}-${uniqueId}@test.com`,
        passwordHash: 'hash1',
        role: 'user',
        locale: 'en-US',
      },
    });

    const user2 = await prisma.user.create({
      data: {
        id: userId2,
        email: `e2e-test-2-${Date.now()}-${uniqueId}@test.com`,
        passwordHash: 'hash2',
        role: 'user',
        locale: 'en-US',
      },
    });

    const session1 = await prisma.session.create({
      data: {
        token: token1,
        userId: user1.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const session2 = await prisma.session.create({
      data: {
        token: token2,
        userId: user2.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    testContext = {
      userId1,
      userId2,
      authToken1: session1.token,
      authToken2: session2.token,
    };
  });

  test.afterEach(async () => {
    if (testContext) {
      await prisma.webhookEndpoint.deleteMany({
        where: { ownerUserId: { in: [testContext.userId1, testContext.userId2] } },
      });
      await prisma.session.deleteMany({
        where: { userId: { in: [testContext.userId1, testContext.userId2] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [testContext.userId1, testContext.userId2] } },
      });
    }
  });

  test('complete webhook lifecycle via HTTP API', async ({ request }) => {
    const user1Api = createAuthedApi(request, testContext.authToken1);
    const user2Api = createAuthedApi(request, testContext.authToken2);

    // 1. POST /webhooks - Create webhook and receive secret
    const createResponse = await user1Api.post('/api/v1/webhooks', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        name: 'E2E Test Webhook',
        url: 'https://localhost:3001/test-webhook',
      },
    });

    expect(createResponse.status()).toBe(201);
    const createData = await createResponse.json();
    expect(createData.id).toBeTruthy();
    expect(createData.name).toBe('E2E Test Webhook');
    expect(createData.url).toBe('https://localhost:3001/test-webhook');
    expect(createData.enabled).toBe(true);
    expect(createData.secret).toBeTruthy();
    expect(createData.secret).toMatch(/^[A-F0-9]{64}$/);
    expect(createData.secretEncrypted).toBeUndefined();

    const webhookId = createData.id;

    // 2. GET /webhooks - List webhooks (should NOT include secret/secretEncrypted)
    const listResponse = await user1Api.get('/api/v1/webhooks');

    expect(listResponse.status()).toBe(200);
    const listData = await listResponse.json();
    expect(Array.isArray(listData.data)).toBe(true);
    expect(listData.data.length).toBeGreaterThan(0);
    const foundWebhook = listData.data.find((w: { id: string }) => w.id === webhookId);
    expect(foundWebhook).toBeTruthy();
    expect(foundWebhook.secret).toBeUndefined();
    expect(foundWebhook.secretEncrypted).toBeUndefined();

    // 3. GET /webhooks/{id} - Retrieve webhook details (should NOT include secret/secretEncrypted)
    const getResponse = await user1Api.get(`/api/v1/webhooks/${webhookId}`);

    expect(getResponse.status()).toBe(200);
    const getDetails = await getResponse.json();
    expect(getDetails.id).toBe(webhookId);
    expect(getDetails.secret).toBeUndefined();
    expect(getDetails.secretEncrypted).toBeUndefined();

    // 4. POST /webhooks/{id}/test - Test delivery
    const testResponse = await user1Api.post(`/api/v1/webhooks/${webhookId}/test`);

    expect(testResponse.status()).toBe(200);
    const testData = await testResponse.json();
    expect(testData.webhookId).toBe(webhookId);
    expect(testData.testId).toBeTruthy();
    expect(['delivered', 'failed', 'timeout']).toContain(testData.status);

    // 5. PATCH /webhooks/{id} - Disable webhook
    const disableResponse = await user1Api.patch(`/api/v1/webhooks/${webhookId}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: { enabled: false },
    });

    expect(disableResponse.status()).toBe(200);
    const disabledData = await disableResponse.json();
    expect(disabledData.enabled).toBe(false);

    // 6. POST /webhooks/{id}/test on disabled webhook - Should be rejected
    const testDisabledResponse = await user1Api.post(`/api/v1/webhooks/${webhookId}/test`);

    expect(testDisabledResponse.status()).toBe(409);
    const testDisabledData = await testDisabledResponse.json();
    expect(testDisabledData.error).toBe('WEBHOOK_DISABLED');

    // 7. PATCH /webhooks/{id} - Re-enable webhook
    const enableResponse = await user1Api.patch(`/api/v1/webhooks/${webhookId}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: { enabled: true },
    });

    expect(enableResponse.status()).toBe(200);
    const enabledData = await enableResponse.json();
    expect(enabledData.enabled).toBe(true);

    // 8. User isolation - User2 cannot see User1's webhook
    const user2ListResponse = await user2Api.get('/api/v1/webhooks');

    expect(user2ListResponse.status()).toBe(200);
    const user2ListData = await user2ListResponse.json();
    expect(user2ListData.data.some((w: { id: string }) => w.id === webhookId)).toBe(false);

    // 9. User isolation - User2 cannot GET User1's webhook
    const user2GetResponse = await user2Api.get(`/api/v1/webhooks/${webhookId}`);

    expect(user2GetResponse.status()).toBe(404);

    // 10. User isolation - User2 cannot DELETE User1's webhook
    const user2DeleteResponse = await user2Api.delete(`/api/v1/webhooks/${webhookId}`);

    expect(user2DeleteResponse.status()).toBe(404);

    // 11. User1 deletes webhook (soft-disable)
    const deleteResponse = await user1Api.delete(`/api/v1/webhooks/${webhookId}`);

    expect(deleteResponse.status()).toBe(204);

    // 12. Deleted webhook still in list but marked as disabled
    const finalListResponse = await user1Api.get('/api/v1/webhooks');

    expect(finalListResponse.status()).toBe(200);
    const finalListData = await finalListResponse.json();
    const deletedWebhook = finalListData.data.find((w: { id: string }) => w.id === webhookId);
    expect(deletedWebhook).toBeTruthy();
    expect(deletedWebhook.enabled).toBe(false);
  });

  test('rejects webhook with credentials in URL', async ({ request }) => {
    const user1Api = createAuthedApi(request, testContext.authToken1);
    const response = await user1Api.post('/api/v1/webhooks', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        name: 'Invalid URL',
        url: 'https://user:pass@example.com/webhook',
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('URL_WITH_CREDENTIALS');
  });

  test('rejects HTTP URL in production', async ({ request }) => {
    const user1Api = createAuthedApi(request, testContext.authToken1);
    const response = await user1Api.post('/api/v1/webhooks', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        name: 'HTTP URL',
        url: 'http://example.com/webhook',
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('URL_NOT_HTTPS');
  });

  test('returns 401 without authentication', async ({ request }) => {
    const response = await request.get('/api/v1/webhooks');
    expect(response.status()).toBe(401);
  });

  test('pagination works correctly', async ({ request }) => {
    const user1Api = createAuthedApi(request, testContext.authToken1);
    const response = await user1Api.get('/api/v1/webhooks?limit=1&offset=0');

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.pagination).toBeDefined();
    expect(data.pagination.limit).toBe(1);
    expect(data.pagination.offset).toBe(0);
    expect(typeof data.pagination.total).toBe('number');
  });
});
