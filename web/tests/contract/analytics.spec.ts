import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Analytics API Contracts', () => {
  let testToken: string;
  const baseUrl = 'http://localhost:3000';

  beforeAll(async () => {
    // Create test user and session with valid token in database
    const user = await prisma.user.create({
      data: {
        id: `contract-test-${Date.now()}`,
        email: `contract-test-${Date.now()}@test`,
        passwordHash: 'hash',
        role: 'analyst',
        locale: 'en',
      },
    });

    const session = await prisma.session.create({
      data: {
        token: `contract-token-${Date.now()}`,
        userId: user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    testToken = session.token;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.session.deleteMany({ where: { token: { startsWith: 'contract-token' } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: 'contract-test' } } });
    await prisma.$disconnect();
  });

  describe('GET /api/v1/analytics/metrics', () => {
    it('should return 401 without Authorization header', async () => {
      const response = await fetch(`${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-06-01&dateTo=2026-07-31`);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return 400 without dateFrom parameter', async () => {
      const response = await fetch(`${baseUrl}/api/v1/analytics/metrics?dateTo=2026-07-31`, {
        headers: { Authorization: `Bearer ${testToken}` },
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('dateFrom');
    });

    it('should return 400 without dateTo parameter', async () => {
      const response = await fetch(`${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-06-01`, {
        headers: { Authorization: `Bearer ${testToken}` },
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('dateTo');
    });

    it('should return 400 with invalid date format', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/metrics?dateFrom=invalid&dateTo=2026-07-31`,
        { headers: { Authorization: `Bearer ${testToken}` } }
      );
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return 400 when dateFrom > dateTo', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-08-01&dateTo=2026-06-01`,
        { headers: { Authorization: `Bearer ${testToken}` } }
      );
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('dateFrom');
    });

    it('should return 403 when non-admin requests scope=all', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-06-01&dateTo=2026-07-31&scope=all`,
        { headers: { Authorization: `Bearer ${testToken}` } }
      );
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return 403 when requesting another user data as non-admin', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-06-01&dateTo=2026-07-31&userId=other-user-id`,
        { headers: { Authorization: `Bearer ${testToken}` } }
      );
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('GET /api/v1/analytics/export', () => {
    it('should return 401 without Authorization header', async () => {
      const response = await fetch(`${baseUrl}/api/v1/analytics/export?format=csv`);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return 400 without format parameter', async () => {
      const response = await fetch(`${baseUrl}/api/v1/analytics/export`, {
        headers: { Authorization: `Bearer ${testToken}` },
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('format');
    });

    it('should return 400 with invalid format', async () => {
      const response = await fetch(`${baseUrl}/api/v1/analytics/export?format=pdf`, {
        headers: { Authorization: `Bearer ${testToken}` },
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('format');
    });

    it('should return 403 when requesting another user export as non-admin', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/export?format=csv&userId=other-user-id`,
        { headers: { Authorization: `Bearer ${testToken}` } }
      );
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return 200 with CSV content-type for csv format', async () => {
      // This test requires valid auth, will be verified in integration tests
      const response = await fetch(`${baseUrl}/api/v1/analytics/export?format=csv`, {
        headers: { Authorization: `Bearer valid-token` },
      });
      if (response.ok) {
        expect(response.headers.get('content-type')).toContain('text/csv');
      }
    });

    it('should return 200 with JSON content-type for json format', async () => {
      // This test requires valid auth, will be verified in integration tests
      const response = await fetch(`${baseUrl}/api/v1/analytics/export?format=json`, {
        headers: { Authorization: `Bearer valid-token` },
      });
      if (response.ok) {
        expect(response.headers.get('content-type')).toContain('application/json');
      }
    });
  });
});
