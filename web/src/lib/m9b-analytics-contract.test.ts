import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('M9B Analytics API - Contract Tests', () => {
  let testToken: string;
  const baseUrl = 'http://localhost:3000';

  beforeAll(async () => {
    // Create test user and session with valid token in database
    const user = await prisma.user.create({
      data: {
        id: `contract-${Date.now()}`,
        email: `contract-${Date.now()}@test`,
        passwordHash: 'hash',
        role: 'analyst',
        locale: 'en',
      },
    });

    const session = await prisma.session.create({
      data: {
        token: `contract-${Date.now()}`,
        userId: user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    testToken = session.token;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { token: { startsWith: 'contract-' } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: 'contract-' } } });
    await prisma.$disconnect();
  });

  describe('GET /api/v1/analytics/metrics - Input Validation', () => {
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
    });

    it('should return 400 when dateFrom > dateTo', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-08-01&dateTo=2026-06-01`,
        { headers: { Authorization: `Bearer ${testToken}` } }
      );
      expect(response.status).toBe(400);
    });

    it('should return 403 when non-admin requests scope=all', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-06-01&dateTo=2026-07-31&scope=all`,
        { headers: { Authorization: `Bearer ${testToken}` } }
      );
      expect(response.status).toBe(403);
    });

    it('should return 403 when requesting another user data as non-admin', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-06-01&dateTo=2026-07-31&userId=other-user-id`,
        { headers: { Authorization: `Bearer ${testToken}` } }
      );
      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/v1/analytics/export - Input Validation', () => {
    it('should return 401 without Authorization header', async () => {
      const response = await fetch(`${baseUrl}/api/v1/analytics/export?format=csv`);
      expect(response.status).toBe(401);
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
    });

    it('should return 403 when requesting another user export as non-admin', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/export?format=csv&userId=other-user-id`,
        { headers: { Authorization: `Bearer ${testToken}` } }
      );
      expect(response.status).toBe(403);
    });
  });
});
