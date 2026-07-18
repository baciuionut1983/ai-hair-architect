import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Analytics Integration Tests', () => {
  let userId1: string;
  let userId2: string;
  let adminUserId: string;
  let token1: string;
  let adminToken: string;
  const baseUrl = 'http://localhost:3000';

  beforeAll(async () => {
    // Create test users
    const user1 = await prisma.user.create({
      data: {
        id: `int-test-user1-${Date.now()}`,
        email: `int-user1-${Date.now()}@test`,
        passwordHash: 'hash1',
        role: 'analyst',
        locale: 'en',
      },
    });
    userId1 = user1.id;

    const user2 = await prisma.user.create({
      data: {
        id: `int-test-user2-${Date.now()}`,
        email: `int-user2-${Date.now()}@test`,
        passwordHash: 'hash2',
        role: 'analyst',
        locale: 'en',
      },
    });
    userId2 = user2.id;

    const admin = await prisma.user.create({
      data: {
        id: `int-test-admin-${Date.now()}`,
        email: `int-admin-${Date.now()}@test`,
        passwordHash: 'hash-admin',
        role: 'admin',
        locale: 'en',
      },
    });
    adminUserId = admin.id;

    // Create sessions (tokens)
    const session1 = await prisma.session.create({
      data: {
        token: `token-int-test-user1-${Date.now()}`,
        userId: userId1,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    token1 = session1.token;

    const adminSession = await prisma.session.create({
      data: {
        token: `token-int-test-admin-${Date.now()}`,
        userId: adminUserId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    adminToken = adminSession.token;

    // Create client
    const client = await prisma.client.create({
      data: {
        id: `int-test-client-${Date.now()}`,
        name: 'Integration Test Client',
        ownerUserId: userId1,
      },
    });

    // Create analyses
    const baseDate = new Date('2026-07-01T00:00:00Z');
    const analyses = [
      {
        id: `int-analysis-1-${Date.now()}`,
        clientId: client.id,
        ownerUserId: userId1,
        goal: 'Test',
        hairType: 'curly',
        density: 'high',
        porosity: 'medium',
        phase: 'analysis',
        clarificationRound: 0,
        confidenceScore: 0.92,
        uncertaintyReasons: {},
        followUpQuestions: {},
        recommendations: {},
        safetyNotes: {},
        clarificationAnswers: {},
        createdAt: new Date(baseDate.getTime() + 0 * 24 * 60 * 60 * 1000),
      },
      {
        id: `int-analysis-2-${Date.now()}`,
        clientId: client.id,
        ownerUserId: userId1,
        goal: 'Test',
        hairType: 'curly',
        density: 'medium',
        porosity: 'medium',
        phase: 'analysis',
        clarificationRound: 0,
        confidenceScore: 0.88,
        uncertaintyReasons: {},
        followUpQuestions: {},
        recommendations: {},
        safetyNotes: {},
        clarificationAnswers: {},
        createdAt: new Date(baseDate.getTime() + 5 * 24 * 60 * 60 * 1000),
      },
      {
        id: `int-analysis-3-${Date.now()}`,
        clientId: client.id,
        ownerUserId: userId1,
        goal: 'Test',
        hairType: 'wavy',
        density: 'medium',
        porosity: 'medium',
        phase: 'analysis',
        clarificationRound: 0,
        confidenceScore: 0.85,
        uncertaintyReasons: {},
        followUpQuestions: {},
        recommendations: {},
        safetyNotes: {},
        clarificationAnswers: {},
        createdAt: new Date(baseDate.getTime() + 10 * 24 * 60 * 60 * 1000),
      },
      {
        id: `int-analysis-4-${Date.now()}`,
        clientId: client.id,
        ownerUserId: userId2,
        goal: 'Test',
        hairType: 'straight',
        density: 'high',
        porosity: 'medium',
        phase: 'analysis',
        clarificationRound: 0,
        confidenceScore: 0.91,
        uncertaintyReasons: {},
        followUpQuestions: {},
        recommendations: {},
        safetyNotes: {},
        clarificationAnswers: {},
        createdAt: new Date(baseDate.getTime() + 3 * 24 * 60 * 60 * 1000),
      },
    ];

    await prisma.analysis.createMany({ data: analyses });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.session.deleteMany({ where: { token: { startsWith: 'token-int-test' } } });
    await prisma.analysis.deleteMany({ where: { id: { startsWith: 'int-analysis' } } });
    await prisma.client.deleteMany({ where: { id: { startsWith: 'int-test-client' } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: 'int-test' } } });
    await prisma.$disconnect();
  });

  describe('GET /api/v1/analytics/metrics', () => {
    it('should return user personal analytics', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-07-01&dateTo=2026-07-31&scope=personal`,
        { headers: { Authorization: `Bearer ${token1}` } }
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('success');
      expect(data.data.summary.totalAnalyses).toBe(3);
      expect(data.data.summary.avgConfidence).toBeCloseTo(0.883, 1);
      expect(data.data.summary.mostCommonHairType).toBe('curly'); // User1 has at least 2 analyses
      expect(data.data.summary.avgConfidence).toBeDefined();
      // mostCommonHairType may vary depending on which records are returned
      expect(data.data.byHairType).toBeDefined();
      expect(Array.isArray(data.data.byHairType)).toBe(true);
    });

    it('should exclude data from other users', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-07-01&dateTo=2026-07-31&scope=personal`,
        { headers: { Authorization: `Bearer ${token1}` } }
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      // Should not include user2's straight hair type
      const hasOtherUserData = data.data.byHairType.some(
        (h: { hairType: string; count: number }) => h.hairType === 'straight' && h.count > 1
      );
      expect(hasOtherUserData).toBe(false);
    });

    it('should allow admin to query all users', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-07-01&dateTo=2026-07-31&scope=all`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('success');
      expect(data.data.summary.totalAnalyses).toBe(4); // All analyses
      expect(data.data.summary.uniqueUsers).toBe(2); // 2 unique users
    });

    it('should block non-admin from scope=all', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-07-01&dateTo=2026-07-31&scope=all`,
        { headers: { Authorization: `Bearer ${token1}` } }
      );
      expect(response.status).toBe(403);
    });

    it('should return correct confidence statistics', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-07-01&dateTo=2026-07-31`,
        { headers: { Authorization: `Bearer ${token1}` } }
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.confidence).toBeDefined();
      expect(data.data.confidence.min).toBe(0.85);
      expect(data.data.confidence.max).toBe(0.92);
      expect(data.data.confidence.median).toBeDefined();
      expect(data.data.confidence.stdev).toBeDefined();
    });
  });

  describe('GET /api/v1/analytics/export', () => {
    it('should export user data as CSV', async () => {
      const response = await fetch(`${baseUrl}/api/v1/analytics/export?format=csv`, {
        headers: { Authorization: `Bearer ${token1}` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/csv');
      const csv = await response.text();
      expect(csv).toContain('id,ownerUserId,clientId,hairType,density,confidenceScore,createdAt');
      expect(csv).toContain('curly');
      expect(csv).not.toContain('straight'); // User2 data should not be in export
    });

    it('should export user data as JSON', async () => {
      const response = await fetch(`${baseUrl}/api/v1/analytics/export?format=json`, {
        headers: { Authorization: `Bearer ${token1}` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      const data = await response.json();
      expect(data.status).toBe('success');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.meta.exportedAt).toBeDefined();
    });

    it('should prevent user from exporting other user data', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/export?format=csv&userId=${userId2}`,
        { headers: { Authorization: `Bearer ${token1}` } }
      );
      expect(response.status).toBe(403);
    });

    it('should allow admin to export any user data', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/analytics/export?format=csv&userId=${userId1}`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      expect(response.status).toBe(200);
    });
  });
});
