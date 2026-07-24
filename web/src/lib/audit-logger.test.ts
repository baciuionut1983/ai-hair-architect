import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuditLogger, AuditEvent } from '@/lib/audit-logger';
import { prisma } from '@/lib/prisma';

type AuditLogCreateResult = Awaited<ReturnType<typeof prisma.auditLog.create>>;

vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
  },
}));

describe('AuditLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should log query_metrics success event', async () => {
    const event: AuditEvent = {
      actorUserId: 'user-123',
      action: 'query_metrics',
      resourceType: 'analytics',
      status: 'success',
      metadata: { recordsReturned: 42, latencyMs: 150 },
    };

    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as AuditLogCreateResult);
    await AuditLogger.log(event);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'user-123',
        action: 'query_metrics',
        resourceType: 'analytics',
        status: 'success',
        metadata: { recordsReturned: 42, latencyMs: 150 },
        resourceId: null,
      }),
    });
  });

  it('should log export_csv action', async () => {
    const event: AuditEvent = {
      actorUserId: 'user-456',
      action: 'export_csv',
      resourceType: 'export',
      status: 'success',
      metadata: { filename: 'data.csv', rows: 1000 },
    };

    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as AuditLogCreateResult);
    await AuditLogger.log(event);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'export_csv',
        resourceType: 'export',
      }),
    });
  });

  it('should log export_json action', async () => {
    const event: AuditEvent = {
      actorUserId: 'user-789',
      action: 'export_json',
      resourceType: 'export',
      status: 'success',
      metadata: { size: 5000 },
    };

    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as AuditLogCreateResult);
    await AuditLogger.log(event);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'export_json',
      }),
    });
  });

  it('should log volume_limit_exceeded failure', async () => {
    const event: AuditEvent = {
      actorUserId: 'user-999',
      action: 'volume_limit_exceeded',
      resourceType: 'analytics',
      status: 'failure',
      metadata: { requestedSize: 10000, limit: 5000 },
    };

    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as AuditLogCreateResult);
    await AuditLogger.log(event);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'volume_limit_exceeded',
        status: 'failure',
      }),
    });
  });

  it('should log access_denied failure', async () => {
    const event: AuditEvent = {
      actorUserId: 'user-111',
      action: 'access_denied',
      resourceType: 'analytics',
      status: 'failure',
      metadata: { reason: 'insufficient_permissions' },
    };

    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as AuditLogCreateResult);
    await AuditLogger.log(event);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'access_denied',
        status: 'failure',
      }),
    });
  });

  it('should handle resourceId when provided', async () => {
    const event: AuditEvent = {
      actorUserId: 'user-222',
      action: 'query_metrics',
      resourceType: 'analytics',
      resourceId: 'resource-abc123',
      status: 'success',
      metadata: {},
    };

    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as AuditLogCreateResult);
    await AuditLogger.log(event);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resourceId: 'resource-abc123',
      }),
    });
  });

  it('should set resourceId to null when not provided', async () => {
    const event: AuditEvent = {
      actorUserId: 'user-333',
      action: 'query_metrics',
      resourceType: 'analytics',
      status: 'success',
      metadata: {},
    };

    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as AuditLogCreateResult);
    await AuditLogger.log(event);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resourceId: null,
      }),
    });
  });

  it('should never throw on database errors', async () => {
    const event: AuditEvent = {
      actorUserId: 'user-444',
      action: 'query_metrics',
      resourceType: 'analytics',
      status: 'success',
      metadata: {},
    };

    const dbError = new Error('Database connection failed');
    vi.mocked(prisma.auditLog.create).mockRejectedValueOnce(dbError);

    await expect(AuditLogger.log(event)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[AUDIT_ERROR] Failed to log audit event: Database connection failed')
    );
  });

  it('should handle non-Error exceptions gracefully', async () => {
    const event: AuditEvent = {
      actorUserId: 'user-555',
      action: 'query_metrics',
      resourceType: 'analytics',
      status: 'success',
      metadata: {},
    };

    vi.mocked(prisma.auditLog.create).mockRejectedValueOnce('Unknown error');

    await expect(AuditLogger.log(event)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('should support complex metadata objects', async () => {
    const event: AuditEvent = {
      actorUserId: 'user-666',
      action: 'query_metrics',
      resourceType: 'analytics',
      status: 'success',
      metadata: {
        scope: ['personal'],
        recordsReturned: 150,
        latencyMs: 234,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      },
    };

    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as AuditLogCreateResult);
    await AuditLogger.log(event);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          scope: ['personal'],
          latencyMs: 234,
        }),
      }),
    });
  });

  it('should preserve all AuditEvent fields in database call', async () => {
    const event: AuditEvent = {
      actorUserId: 'user-777',
      action: 'export_csv',
      resourceType: 'export',
      resourceId: 'export-xyz',
      status: 'success',
      metadata: { format: 'csv', rows: 500 },
    };

    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as AuditLogCreateResult);
    await AuditLogger.log(event);

    const callArgs = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(callArgs.data).toEqual({
      actorUserId: 'user-777',
      action: 'export_csv',
      resourceType: 'export',
      resourceId: 'export-xyz',
      status: 'success',
      metadata: { format: 'csv', rows: 500 },
    });
  });
});
