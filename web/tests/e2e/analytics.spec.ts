import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

test.describe('Analytics E2E - Real PostgreSQL Persistence', () => {
  let userId1: string;
  let userId2: string;
  let adminUserId: string;
  let token1: string;
  let adminToken: string;
  let clientId1: string;
  let clientId2: string;
  let analyticsDateFrom: string;
  let analyticsDateTo: string;
  let filteredDateFrom: string;

  // SAFETY CHECK: Ensure we're on TEST database only
  test.beforeAll(async () => {
    const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (!dbUrl || !dbUrl.includes('ai_hair_architect_test')) {
      throw new Error(
        '❌ SAFETY CHECK FAILED: E2E tests require ai_hair_architect_test database.\n' +
        `Current DATABASE_URL: ${dbUrl}\n` +
        'Cannot reset production or development database. Aborting tests.'
      );
    }

    // Create test users
    const user1 = await prisma.user.create({
      data: {
        id: `e2e-user1-${Date.now()}`,
        email: `e2e-user1-${Date.now()}@test`,
        passwordHash: 'hash1',
        role: 'analyst',
        locale: 'en',
      },
    });
    userId1 = user1.id;

    const user2 = await prisma.user.create({
      data: {
        id: `e2e-user2-${Date.now()}`,
        email: `e2e-user2-${Date.now()}@test`,
        passwordHash: 'hash2',
        role: 'analyst',
        locale: 'en',
      },
    });
    userId2 = user2.id;

    const admin = await prisma.user.create({
      data: {
        id: `e2e-admin-${Date.now()}`,
        email: `e2e-admin-${Date.now()}@test`,
        passwordHash: 'hash-admin',
        role: 'admin',
        locale: 'en',
      },
    });
    adminUserId = admin.id;

    // Create sessions
    const session1 = await prisma.session.create({
      data: {
        token: `token-e2e-user1-${Date.now()}`,
        userId: userId1,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    token1 = session1.token;

    const adminSession = await prisma.session.create({
      data: {
        token: `token-e2e-admin-${Date.now()}`,
        userId: adminUserId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    adminToken = adminSession.token;

    // Create client
    const client = await prisma.client.create({
      data: {
        id: `e2e-client-${Date.now()}`,
        fullName: 'E2E Test Client',
        ownerUserId: userId1,
      },
    });
    clientId1 = client.id;

    const secondClient = await prisma.client.create({
      data: {
        id: `e2e-client-user2-${Date.now()}`,
        fullName: 'E2E Test Client 2',
        ownerUserId: userId2,
      },
    });
    clientId2 = secondClient.id;

    // Reserve an empty time window so all-scope assertions remain isolated.
    const analyticsWindowMs = 11 * 24 * 60 * 60 * 1000;
    let baseDate = new Date('2100-01-01T00:00:00.000Z');
    while (
      await prisma.analysis.count({
        where: {
          createdAt: {
            gte: baseDate,
            lte: new Date(baseDate.getTime() + analyticsWindowMs),
          },
        },
      })
    ) {
      baseDate = new Date(baseDate.getTime() + 31 * 24 * 60 * 60 * 1000);
    }
    analyticsDateFrom = baseDate.toISOString();
    analyticsDateTo = new Date(baseDate.getTime() + analyticsWindowMs).toISOString();
    filteredDateFrom = new Date(baseDate.getTime() + 9 * 24 * 60 * 60 * 1000).toISOString();

    // Create analyses
    const analyses = [
      {
        id: `e2e-a1-${Date.now()}`,
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
        createdAt: new Date(baseDate.getTime() + 0),
      },
      {
        id: `e2e-a2-${Date.now()}`,
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
        id: `e2e-a3-${Date.now()}`,
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
        id: `e2e-a4-${Date.now()}`,
        clientId: secondClient.id,
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

  test('User1 queries personal analytics and gets correct data', async ({ request }) => {
    const response = await request.get(
      `/api/v1/analytics/metrics?dateFrom=${analyticsDateFrom}&dateTo=${analyticsDateTo}&scope=personal`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('success');
    expect(data.data.summary.totalAnalyses).toBe(3);
    expect(data.data.summary.avgConfidence).toBeCloseTo(0.883, 2);
    expect(data.data.summary.mostCommonHairType).toBe('curly');
    expect(data.data.confidence.min).toBe(0.85);
    expect(data.data.confidence.max).toBe(0.92);
    expect(data.data.confidence.median).toBeDefined();
    expect(data.data.confidence.stdev).toBeDefined();
  });

  test('User1 cannot access User2 analytics (403 Forbidden)', async ({ request }) => {
    const response = await request.get(
      `/api/v1/analytics/metrics?dateFrom=${analyticsDateFrom}&dateTo=${analyticsDateTo}&userId=${userId2}`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );

    expect(response.status()).toBe(403);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test('Admin queries all-user scope and sees all data', async ({ request }) => {
    const response = await request.get(
      `/api/v1/analytics/metrics?dateFrom=${analyticsDateFrom}&dateTo=${analyticsDateTo}&scope=all`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.summary.totalAnalyses).toBe(4);
    expect(data.data.summary.uniqueUsers).toBe(2);
  });

  test('User1 exports CSV without User2 data', async ({ request }) => {
    const response = await request.get(`/api/v1/analytics/export?format=csv&dateFrom=${analyticsDateFrom}&dateTo=${analyticsDateTo}`, {
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/csv');

    const csv = await response.text();
    const lines = csv.split('\n');
    expect(lines[0]).toContain('id,ownerUserId,clientId,hairType,density,confidenceScore,createdAt');
    expect(csv).toContain('curly');
    expect(csv).toContain('wavy');
    expect(csv).not.toContain('straight'); // User2's hair type
  });

  test('User1 cannot export User2 CSV (403 Forbidden)', async ({ request }) => {
    const response = await request.get(
      `/api/v1/analytics/export?format=csv&dateFrom=${analyticsDateFrom}&dateTo=${analyticsDateTo}&userId=${userId2}`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );

    expect(response.status()).toBe(403);
  });

  test('User1 exports personal analytics as JSON', async ({ request }) => {
    const response = await request.get(
      `/api/v1/analytics/export?format=json&dateFrom=${analyticsDateFrom}&dateTo=${analyticsDateTo}`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    const data = await response.json();
    expect(data.status).toBe('success');
    expect(data.data).toHaveLength(3);
    expect(data.data.every((row: { ownerUserId: string }) => row.ownerUserId === userId1)).toBe(true);
    expect(data.meta.exportedAt).toBeDefined();
  });

  test('Admin exports a selected user without leaking other users', async ({ request }) => {
    const response = await request.get(
      `/api/v1/analytics/export?format=json&dateFrom=${analyticsDateFrom}&dateTo=${analyticsDateTo}&userId=${userId1}`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data).toHaveLength(3);
    expect(data.data.every((row: { ownerUserId: string }) => row.ownerUserId === userId1)).toBe(true);
  });

  test('Invalid token returns 401 Unauthorized', async ({ request }) => {
    const response = await request.get(`/api/v1/analytics/metrics?dateFrom=${analyticsDateFrom}&dateTo=${analyticsDateTo}`, {
      headers: { Authorization: 'Bearer invalid-token-xyz' },
    });

    expect(response.status()).toBe(401);
    const data = await response.json();
    expect(data.error).toContain('Unauthorized');
  });

  test('Data persists across multiple requests (real PostgreSQL)', async ({ request }) => {
    // First request
    const response1 = await request.get(
      `/api/v1/analytics/metrics?dateFrom=${analyticsDateFrom}&dateTo=${analyticsDateTo}`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );
    const data1 = await response1.json();
    const count1 = data1.data.summary.totalAnalyses;

    // Second request (after delay)
    await new Promise((resolve) => setTimeout(resolve, 100));

    const response2 = await request.get(
      `/api/v1/analytics/metrics?dateFrom=${analyticsDateFrom}&dateTo=${analyticsDateTo}`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );
    const data2 = await response2.json();
    const count2 = data2.data.summary.totalAnalyses;

    // Data should be identical (persisted in PostgreSQL)
    expect(count1).toBe(count2);
    expect(count2).toBe(3);
  });

  test('Date range filtering works correctly', async ({ request }) => {
    const response = await request.get(
      `/api/v1/analytics/metrics?dateFrom=${filteredDateFrom}&dateTo=${analyticsDateTo}`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );

    expect(response.status()).toBe(200);
    const data = await response.json();
    // Only analyses after 2026-07-10
    expect(data.data.summary.totalAnalyses).toBe(1); // Only wavy on day 10
  });

  test('Empty result set handled gracefully', async ({ request }) => {
    const response = await request.get(
      '/api/v1/analytics/metrics?dateFrom=2025-01-01&dateTo=2025-01-31',
      { headers: { Authorization: `Bearer ${token1}` } }
    );

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.summary.totalAnalyses).toBe(0);
    expect(data.data.summary.avgConfidence).toBe(0);
    expect(data.data.summary.mostCommonHairType).toBeNull();
  });

  test.afterAll(async () => {
    // Cleanup
    await prisma.analysis.deleteMany({ where: { ownerUserId: { in: [userId1, userId2] } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientId1, clientId2] } } });
    await prisma.session.deleteMany({ where: { token: { in: [token1, adminToken] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId1, userId2, adminUserId] } } });
    await prisma.$disconnect();
  });
});
