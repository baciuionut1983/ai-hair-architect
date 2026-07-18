import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const baseUrl = 'http://localhost:3000';

test.describe('Analytics E2E - Real PostgreSQL Persistence', () => {
  let userId1: string;
  let userId2: string;
  let adminUserId: string;
  let token1: string;
  let adminToken: string;

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

    // Reset test database
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Session" CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Analysis" CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Client" CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');

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
        name: 'E2E Test Client',
        ownerUserId: userId1,
      },
    });

    // Create analyses
    const baseDate = new Date('2026-07-01T00:00:00Z');
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

  test('User1 queries personal analytics and gets correct data', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-07-01&dateTo=2026-07-31&scope=personal`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('success');
    expect(data.data.summary.totalAnalyses).toBe(3);
    expect(data.data.summary.mostCommonHairType).toBe('curly');
  });

  test('User1 cannot access User2 analytics (403 Forbidden)', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-07-01&dateTo=2026-07-31&userId=${userId2}`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test('Admin queries all-user scope and sees all data', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-07-01&dateTo=2026-07-31&scope=all`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.summary.totalAnalyses).toBe(4);
    expect(data.data.summary.uniqueUsers).toBe(2);
  });

  test('User1 exports CSV without User2 data', async () => {
    const response = await fetch(`${baseUrl}/api/v1/analytics/export?format=csv`, {
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');

    const csv = await response.text();
    const lines = csv.split('\n');
    expect(lines[0]).toContain('id,ownerUserId,clientId,hairType,density,confidenceScore,createdAt');
    expect(csv).toContain('curly');
    expect(csv).toContain('wavy');
    expect(csv).not.toContain('straight'); // User2's hair type
  });

  test('User1 cannot export User2 CSV (403 Forbidden)', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/analytics/export?format=csv&userId=${userId2}`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );

    expect(response.status).toBe(403);
  });

  test('Invalid token returns 401 Unauthorized', async () => {
    const response = await fetch(`${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-07-01&dateTo=2026-07-31`, {
      headers: { Authorization: 'Bearer invalid-token-xyz' },
    });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toContain('Unauthorized');
  });

  test('Data persists across multiple requests (real PostgreSQL)', async () => {
    // First request
    const response1 = await fetch(
      `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-07-01&dateTo=2026-07-31`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );
    const data1 = await response1.json();
    const count1 = data1.data.summary.totalAnalyses;

    // Second request (after delay)
    await new Promise((resolve) => setTimeout(resolve, 100));

    const response2 = await fetch(
      `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-07-01&dateTo=2026-07-31`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );
    const data2 = await response2.json();
    const count2 = data2.data.summary.totalAnalyses;

    // Data should be identical (persisted in PostgreSQL)
    expect(count1).toBe(count2);
    expect(count2).toBe(3);
  });

  test('Date range filtering works correctly', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/analytics/metrics?dateFrom=2026-07-10&dateTo=2026-07-31`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    // Only analyses after 2026-07-10
    expect(data.data.summary.totalAnalyses).toBe(1); // Only wavy on day 10
  });

  test('Empty result set handled gracefully', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/analytics/metrics?dateFrom=2025-01-01&dateTo=2025-01-31`,
      { headers: { Authorization: `Bearer ${token1}` } }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.summary.totalAnalyses).toBe(0);
    expect(data.data.summary.avgConfidence).toBe(0);
    expect(data.data.summary.mostCommonHairType).toBeNull();
  });

  test.afterAll(async () => {
    // Cleanup
    await prisma.session.deleteMany({ where: { token: { startsWith: 'token-e2e' } } });
    await prisma.analysis.deleteMany({ where: { id: { startsWith: 'e2e-a' } } });
    await prisma.client.deleteMany({ where: { id: { startsWith: 'e2e-client' } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: 'e2e' } } });
    await prisma.$disconnect();
  });
});
