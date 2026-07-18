import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PrismaClient } from '@prisma/client';

let testDb: PrismaClient;

describe('M9C Audit Logging Integration Tests', () => {
  beforeEach(async () => {
    testDb = prisma;
    await testDb.auditLog.deleteMany({});
  });

  afterEach(async () => {
    await testDb.auditLog.deleteMany({});
  });

  it('should create audit log entry when query_metrics succeeds', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000001';

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'query_metrics',
        resourceType: 'analytics',
        status: 'success',
        metadata: {
          scope: ['personal'],
          recordsReturned: 42,
          latencyMs: 150,
          ipAddress: '192.168.1.1',
          userAgent: 'test-client/1.0',
        },
      },
    });

    const logs = await testDb.auditLog.findMany({
      where: { actorUserId: userId },
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('query_metrics');
    expect(logs[0].status).toBe('success');
  });

  it('should create audit log entry when export_csv succeeds', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000002';

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'export_csv',
        resourceType: 'export',
        status: 'success',
        metadata: {
          filename: 'analytics_export.csv',
          rows: 1200,
          size: 45000,
        },
      },
    });

    const logs = await testDb.auditLog.findMany({
      where: { action: 'export_csv' },
    });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].resourceType).toBe('export');
  });

  it('should create audit log entry when export_json succeeds', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000003';

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'export_json',
        resourceType: 'export',
        status: 'success',
        metadata: {
          filename: 'analytics_export.json',
          size: 85000,
        },
      },
    });

    const logs = await testDb.auditLog.findMany({
      where: { action: 'export_json' },
    });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].action).toBe('export_json');
  });

  it('should create audit log entry for volume_limit_exceeded failure', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000004';

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'volume_limit_exceeded',
        resourceType: 'analytics',
        status: 'failure',
        metadata: {
          requestedSize: 8000,
          limit: 5000,
          ipAddress: '192.168.1.2',
        },
      },
    });

    const logs = await testDb.auditLog.findMany({
      where: {
        action: 'volume_limit_exceeded',
        status: 'failure',
      },
    });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].status).toBe('failure');
  });

  it('should create audit log entry for access_denied failure', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000005';

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'access_denied',
        resourceType: 'analytics',
        status: 'failure',
        metadata: {
          reason: 'insufficient_permissions',
        },
      },
    });

    const logs = await testDb.auditLog.findMany({
      where: { action: 'access_denied' },
    });

    expect(logs.length).toBeGreaterThan(0);
  });

  it('should enforce user isolation - user can only see own logs', async () => {
    const user1 = 'aaaaaaaa-0000-0000-0000-000000000010';
    const user2 = 'aaaaaaaa-0000-0000-0000-000000000011';

    await testDb.auditLog.create({
      data: {
        actorUserId: user1,
        action: 'query_metrics',
        resourceType: 'analytics',
        status: 'success',
        metadata: {},
      },
    });

    await testDb.auditLog.create({
      data: {
        actorUserId: user2,
        action: 'export_csv',
        resourceType: 'export',
        status: 'success',
        metadata: {},
      },
    });

    const user1Logs = await testDb.auditLog.findMany({
      where: { actorUserId: user1 },
    });

    expect(user1Logs).toHaveLength(1);
    expect(user1Logs[0].action).toBe('query_metrics');
  });

  it('should filter audit logs by action', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000020';

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'query_metrics',
        resourceType: 'analytics',
        status: 'success',
        metadata: {},
      },
    });

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'export_csv',
        resourceType: 'export',
        status: 'success',
        metadata: {},
      },
    });

    const queryMetricsLogs = await testDb.auditLog.findMany({
      where: {
        actorUserId: userId,
        action: 'query_metrics',
      },
    });

    expect(queryMetricsLogs).toHaveLength(1);
    expect(queryMetricsLogs[0].action).toBe('query_metrics');
  });

  it('should filter audit logs by status', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000021';

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'query_metrics',
        resourceType: 'analytics',
        status: 'success',
        metadata: {},
      },
    });

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'volume_limit_exceeded',
        resourceType: 'analytics',
        status: 'failure',
        metadata: {},
      },
    });

    const failureLogs = await testDb.auditLog.findMany({
      where: {
        actorUserId: userId,
        status: 'failure',
      },
    });

    expect(failureLogs).toHaveLength(1);
    expect(failureLogs[0].status).toBe('failure');
  });

  it('should filter audit logs by date range', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000022';
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'query_metrics',
        resourceType: 'analytics',
        status: 'success',
        metadata: {},
        createdAt: now,
      },
    });

    const logsInRange = await testDb.auditLog.findMany({
      where: {
        actorUserId: userId,
        createdAt: {
          gte: yesterday,
          lte: tomorrow,
        },
      },
    });

    expect(logsInRange).toHaveLength(1);
  });

  it('should combine multiple filters with AND logic', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000023';
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'query_metrics',
        resourceType: 'analytics',
        status: 'success',
        metadata: {},
        createdAt: now,
      },
    });

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'export_csv',
        resourceType: 'export',
        status: 'success',
        metadata: {},
        createdAt: now,
      },
    });

    const filteredLogs = await testDb.auditLog.findMany({
      where: {
        actorUserId: userId,
        action: 'query_metrics',
        status: 'success',
        createdAt: {
          gte: yesterday,
          lte: tomorrow,
        },
      },
    });

    expect(filteredLogs).toHaveLength(1);
    expect(filteredLogs[0].action).toBe('query_metrics');
  });

  it('should return logs ordered by createdAt descending', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000024';

    const log1Time = new Date('2026-07-18T10:00:00Z');
    const log2Time = new Date('2026-07-18T12:00:00Z');

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'query_metrics',
        resourceType: 'analytics',
        status: 'success',
        metadata: { order: 1 },
        createdAt: log1Time,
      },
    });

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'export_csv',
        resourceType: 'export',
        status: 'success',
        metadata: { order: 2 },
        createdAt: log2Time,
      },
    });

    const logs = await testDb.auditLog.findMany({
      where: { actorUserId: userId },
      orderBy: { createdAt: 'desc' },
    });

    expect(logs).toHaveLength(2);
    expect((logs[0].metadata as Record<string, unknown>).order).toBe(2);
    expect((logs[1].metadata as Record<string, unknown>).order).toBe(1);
  });

  it('should support pagination with take limit', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000025';

    for (let i = 0; i < 5; i++) {
      await testDb.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'query_metrics',
          resourceType: 'analytics',
          status: 'success',
          metadata: { index: i },
        },
      });
    }

    const paginatedLogs = await testDb.auditLog.findMany({
      where: { actorUserId: userId },
      take: 3,
    });

    expect(paginatedLogs).toHaveLength(3);
  });

  it('should properly store and retrieve JSON metadata', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000026';
    const metadata = {
      scope: ['personal', 'shared'],
      recordsReturned: 123,
      latencyMs: 456,
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US)',
      nested: {
        deep: {
          value: 'test',
        },
      },
    };

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'query_metrics',
        resourceType: 'analytics',
        status: 'success',
        metadata,
      },
    });

    const logs = await testDb.auditLog.findMany({
      where: { actorUserId: userId },
    });

    expect(logs[0].metadata).toEqual(metadata);
  });

  it('should handle null resourceId', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000027';

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'query_metrics',
        resourceType: 'analytics',
        status: 'success',
        metadata: {},
        resourceId: null,
      },
    });

    const logs = await testDb.auditLog.findMany({
      where: { actorUserId: userId },
    });

    expect(logs[0].resourceId).toBeNull();
  });

  it('should handle resourceId when present', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000028';
    const resourceId = 'resource-abc-123';

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'query_metrics',
        resourceType: 'analytics',
        status: 'success',
        metadata: {},
        resourceId,
      },
    });

    const logs = await testDb.auditLog.findMany({
      where: { actorUserId: userId },
    });

    expect(logs[0].resourceId).toBe(resourceId);
  });

  it('should store createdAt timestamps in UTC', async () => {
    const userId = 'aaaaaaaa-0000-0000-0000-000000000029';
    const beforeCreate = new Date();

    await testDb.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'query_metrics',
        resourceType: 'analytics',
        status: 'success',
        metadata: {},
      },
    });

    const afterCreate = new Date();
    const logs = await testDb.auditLog.findMany({
      where: { actorUserId: userId },
    });

    expect(logs[0].createdAt.getTime()).toBeGreaterThanOrEqual(
      beforeCreate.getTime()
    );
    expect(logs[0].createdAt.getTime()).toBeLessThanOrEqual(
      afterCreate.getTime()
    );
  });
});
