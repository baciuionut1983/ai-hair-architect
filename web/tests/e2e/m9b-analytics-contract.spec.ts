import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

test.describe('M9B Analytics API - Contract Tests', () => {
  let testToken: string;
  let testUserId: string;

  test.beforeAll(async () => {
    testUserId = randomUUID();
    testToken = randomUUID();
    const user = await prisma.user.create({
      data: {
        id: testUserId,
        email: `contract-${testUserId}@test`,
        passwordHash: 'hash',
        role: 'analyst',
        locale: 'en',
      },
    });
    testUserId = user.id;

    await prisma.session.create({
      data: {
        token: testToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.session.deleteMany({ where: { token: testToken } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
    await prisma.$disconnect();
  });

  test.describe('GET /api/v1/analytics/metrics - Input Validation', () => {
    test('should return 401 without Authorization header', async ({ request }) => {
      const response = await request.get('/api/v1/analytics/metrics?dateFrom=2026-06-01&dateTo=2026-07-31');
      expect(response.status()).toBe(401);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    test('should return 400 without dateFrom parameter', async ({ request }) => {
      const response = await request.get('/api/v1/analytics/metrics?dateTo=2026-07-31', {
        headers: { Authorization: `Bearer ${testToken}` },
      });
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('dateFrom');
    });

    test('should return 400 without dateTo parameter', async ({ request }) => {
      const response = await request.get('/api/v1/analytics/metrics?dateFrom=2026-06-01', {
        headers: { Authorization: `Bearer ${testToken}` },
      });
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('dateTo');
    });

    test('should return 400 with invalid date format', async ({ request }) => {
      const response = await request.get(
        '/api/v1/analytics/metrics?dateFrom=invalid&dateTo=2026-07-31',
        { headers: { Authorization: `Bearer ${testToken}` } },
      );
      expect(response.status()).toBe(400);
    });

    test('should return 400 when dateFrom > dateTo', async ({ request }) => {
      const response = await request.get(
        '/api/v1/analytics/metrics?dateFrom=2026-08-01&dateTo=2026-06-01',
        { headers: { Authorization: `Bearer ${testToken}` } },
      );
      expect(response.status()).toBe(400);
    });

    test('should return 403 when non-admin requests scope=all', async ({ request }) => {
      const response = await request.get(
        '/api/v1/analytics/metrics?dateFrom=2026-06-01&dateTo=2026-07-31&scope=all',
        { headers: { Authorization: `Bearer ${testToken}` } },
      );
      expect(response.status()).toBe(403);
    });

    test('should return 403 when requesting another user data as non-admin', async ({ request }) => {
      const response = await request.get(
        '/api/v1/analytics/metrics?dateFrom=2026-06-01&dateTo=2026-07-31&userId=other-user-id',
        { headers: { Authorization: `Bearer ${testToken}` } },
      );
      expect(response.status()).toBe(403);
    });
  });

  test.describe('GET /api/v1/analytics/export - Input Validation', () => {
    test('should return 401 without Authorization header', async ({ request }) => {
      const response = await request.get('/api/v1/analytics/export?format=csv');
      expect(response.status()).toBe(401);
    });

    test('should return 400 without format parameter', async ({ request }) => {
      const response = await request.get('/api/v1/analytics/export', {
        headers: { Authorization: `Bearer ${testToken}` },
      });
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('format');
    });

    test('should return 400 with invalid format', async ({ request }) => {
      const response = await request.get('/api/v1/analytics/export?format=pdf', {
        headers: { Authorization: `Bearer ${testToken}` },
      });
      expect(response.status()).toBe(400);
    });

    test('should return 403 when requesting another user export as non-admin', async ({ request }) => {
      const response = await request.get('/api/v1/analytics/export?format=csv&userId=other-user-id', {
        headers: { Authorization: `Bearer ${testToken}` },
      });
      expect(response.status()).toBe(403);
    });
  });
});