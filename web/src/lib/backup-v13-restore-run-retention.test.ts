import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import { __testUtils as maintenanceTestUtils } from "@/lib/backup-v13-restore-run-maintenance";

const dbNow = new Date("2026-07-23T10:00:00.000Z");

const prismaMock = vi.hoisted(() => ({
  opsBackupRestoreRun: {
    count: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  opsBackupRestoreMaintenanceRun: {
    count: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  opsBackupRestoreRetentionRun: {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const auditMock = vi.hoisted(() => ({
  writeOpsAuditEvent: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: vi.fn(() => true),
  prisma: prismaMock,
}));

vi.mock("@/lib/ops-persistence", () => auditMock);

import { runBackupRestoreRunRetention, __testUtils } from "./backup-v13-restore-run-retention";

describe("backup-v13-restore-run-retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.setSystemTime(dbNow);

    prismaMock.opsBackupRestoreRun.count.mockResolvedValue(0);
    prismaMock.opsBackupRestoreRun.findMany.mockResolvedValue([]);
    prismaMock.opsBackupRestoreRun.deleteMany.mockResolvedValue({ count: 0 });

    prismaMock.opsBackupRestoreMaintenanceRun.count.mockResolvedValue(0);
    prismaMock.opsBackupRestoreMaintenanceRun.findMany.mockResolvedValue([]);
    prismaMock.opsBackupRestoreMaintenanceRun.deleteMany.mockResolvedValue({ count: 0 });

    prismaMock.opsBackupRestoreRetentionRun.findUnique.mockResolvedValue(null);
    prismaMock.opsBackupRestoreRetentionRun.create.mockResolvedValue({ id: "ret-1" });
    prismaMock.opsBackupRestoreRetentionRun.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.opsBackupRestoreRetentionRun.update.mockResolvedValue({});

    prismaMock.auditLog.create.mockResolvedValue({ id: "audit-1" });
    auditMock.writeOpsAuditEvent.mockResolvedValue(undefined);

    prismaMock.$transaction.mockImplementation(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const tx = {
        opsBackupRestoreRun: prismaMock.opsBackupRestoreRun,
        opsBackupRestoreMaintenanceRun: prismaMock.opsBackupRestoreMaintenanceRun,
        opsBackupRestoreRetentionRun: prismaMock.opsBackupRestoreRetentionRun,
        auditLog: prismaMock.auditLog,
        $queryRaw: vi.fn()
          .mockResolvedValueOnce([{ acquired: true }])
          .mockResolvedValueOnce([{ now: dbNow }]),
      } as unknown as Prisma.TransactionClient;

      return callback(tx);
    });
  });

  it("enforces policy version and batch limits", async () => {
    await expect(
      runBackupRestoreRunRetention({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-1",
        request: {
          mode: "dry_run",
          policyVersion: "m13f-v0" as "m13f-v1",
          batchLimit: 500,
        },
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_RETENTION_POLICY_VERSION_INVALID", httpStatus: 400 });

    await expect(
      runBackupRestoreRunRetention({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-1",
        request: {
          mode: "dry_run",
          policyVersion: "m13f-v1",
          batchLimit: 0,
        },
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_RETENTION_BATCH_LIMIT_INVALID", httpStatus: 400 });
  });

  it("returns dry-run summary with exact bounded counts and zero mutation", async () => {
    prismaMock.opsBackupRestoreRun.count.mockResolvedValue(2);
    prismaMock.opsBackupRestoreRun.findMany.mockResolvedValue([{ id: "run-b" }, { id: "run-a" }]);
    prismaMock.opsBackupRestoreMaintenanceRun.count.mockResolvedValue(1);
    prismaMock.opsBackupRestoreMaintenanceRun.findMany.mockResolvedValue([{ id: "maint-1" }]);

    const response = await runBackupRestoreRunRetention({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      correlationRequestId: "req-1",
      request: {
        mode: "dry_run",
        policyVersion: "m13f-v1",
        batchLimit: 500,
      },
    });

    expect(response).toMatchObject({
      mode: "dry_run",
      policyVersion: "m13f-v1",
      batchLimit: 500,
      summary: {
        restoreRunCandidatesCount: 2,
        maintenanceRunCandidatesCount: 1,
        totalCandidatesCount: 3,
      },
    });
    expect(response.retentionFingerprint).toBe(
      __testUtils.computeRetentionFingerprint({
        ownerUserId: "owner-1",
        evaluationTime: dbNow.toISOString(),
        policyVersion: "m13f-v1",
        batchLimit: 500,
        candidateRestoreRunIds: ["run-a", "run-b"],
        candidateMaintenanceRunIds: ["maint-1"],
      }),
    );

    expect(prismaMock.opsBackupRestoreRetentionRun.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("enforces exact retention and idempotency fingerprint canonical payloads", () => {
    const retention = __testUtils.computeRetentionFingerprint({
      ownerUserId: "owner-1",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      policyVersion: "m13f-v1",
      batchLimit: 500,
      candidateRestoreRunIds: ["run-a", "run-b"],
      candidateMaintenanceRunIds: ["maint-1"],
    });

    const idempotency = __testUtils.computeIdempotencyFingerprint({
      ownerUserId: "owner-1",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      policyVersion: "m13f-v1",
      batchLimit: 500,
      retentionFingerprint: retention,
      acknowledgeDeletion: true,
    });

    expect(retention).toMatch(/^[0-9a-f]{64}$/);
    expect(idempotency).toMatch(/^[0-9a-f]{64}$/);
    expect(idempotency).not.toBe(retention);
  });

  it("uses deterministic restore-first batch allocation with global max 500", async () => {
    prismaMock.opsBackupRestoreRun.count.mockResolvedValue(700);
    const restoreRows = Array.from({ length: 500 }, (_, index) => ({ id: `run-${String(index + 1).padStart(3, "0")}` }));
    prismaMock.opsBackupRestoreRun.findMany.mockResolvedValue(restoreRows);
    prismaMock.opsBackupRestoreMaintenanceRun.count.mockResolvedValue(999);
    prismaMock.opsBackupRestoreMaintenanceRun.findMany.mockResolvedValue([]);

    const response = await runBackupRestoreRunRetention({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      correlationRequestId: "req-1",
      request: {
        mode: "dry_run",
        policyVersion: "m13f-v1",
        batchLimit: 500,
      },
    });

    expect(response.summary.restoreRunCandidatesCount).toBe(500);
    expect(response.summary.maintenanceRunCandidatesCount).toBe(0);
    expect(response.summary.totalCandidatesCount).toBe(500);
    expect(response.summary.eligibleBeyondBatchRestoreRunCount).toBe(200);
    expect(prismaMock.opsBackupRestoreRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ finishedAt: "asc" }, { id: "asc" }],
        take: 500,
      }),
    );
  });

  it("returns completed replay and never reruns", async () => {
    prismaMock.opsBackupRestoreRetentionRun.findUnique.mockResolvedValue({
      id: "ret-1",
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      status: "completed",
      policyVersion: "m13f-v1",
      batchLimit: 500,
      evaluationTime: dbNow,
      retentionFingerprint: "a".repeat(64),
      executionIdempotencyKey: "key-1",
      idempotencyFingerprint: __testUtils.computeIdempotencyFingerprint({
        ownerUserId: "owner-1",
        evaluationTime: "2026-07-23T10:00:00.000Z",
        policyVersion: "m13f-v1",
        batchLimit: 500,
        retentionFingerprint: "a".repeat(64),
        acknowledgeDeletion: true,
      }),
      advisoryLockKey: "1",
      candidateRestoreRunCount: 0,
      candidateMaintenanceRunCount: 0,
      deletedRestoreRunCount: 0,
      deletedMaintenanceRunCount: 0,
      finalErrorCode: null,
      startedAt: dbNow,
      finishedAt: dbNow,
    });

    const response = await runBackupRestoreRunRetention({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      correlationRequestId: "req-1",
      request: {
        mode: "execution",
        policyVersion: "m13f-v1",
        batchLimit: 500,
        evaluationTime: "2026-07-23T10:00:00.000Z",
        retentionFingerprint: "a".repeat(64),
        executionIdempotencyKey: "key-1",
        acknowledgeDeletion: true,
      },
    });

    expect(response).toMatchObject({ mode: "execution", replayed: true, runId: "ret-1" });
    expect(prismaMock.opsBackupRestoreRetentionRun.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("maps idempotency running and failed replay conflicts", async () => {
    const idempotencyFingerprint = __testUtils.computeIdempotencyFingerprint({
      ownerUserId: "owner-1",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      policyVersion: "m13f-v1",
      batchLimit: 500,
      retentionFingerprint: "a".repeat(64),
      acknowledgeDeletion: true,
    });

    prismaMock.opsBackupRestoreRetentionRun.findUnique.mockResolvedValueOnce({
      id: "ret-1",
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      status: "running",
      policyVersion: "m13f-v1",
      batchLimit: 500,
      evaluationTime: dbNow,
      retentionFingerprint: "a".repeat(64),
      executionIdempotencyKey: "key-1",
      idempotencyFingerprint,
      advisoryLockKey: "1",
      candidateRestoreRunCount: 0,
      candidateMaintenanceRunCount: 0,
      deletedRestoreRunCount: 0,
      deletedMaintenanceRunCount: 0,
      finalErrorCode: null,
      startedAt: dbNow,
      finishedAt: null,
    });

    await expect(
      runBackupRestoreRunRetention({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-1",
        request: {
          mode: "execution",
          policyVersion: "m13f-v1",
          batchLimit: 500,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          retentionFingerprint: "a".repeat(64),
          executionIdempotencyKey: "key-1",
          acknowledgeDeletion: true,
        },
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_RETENTION_IDEMPOTENCY_RUNNING", httpStatus: 409 });

    prismaMock.opsBackupRestoreRetentionRun.findUnique.mockResolvedValueOnce({
      id: "ret-2",
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      status: "failed",
      policyVersion: "m13f-v1",
      batchLimit: 500,
      evaluationTime: dbNow,
      retentionFingerprint: "a".repeat(64),
      executionIdempotencyKey: "key-1",
      idempotencyFingerprint,
      advisoryLockKey: "1",
      candidateRestoreRunCount: 0,
      candidateMaintenanceRunCount: 0,
      deletedRestoreRunCount: 0,
      deletedMaintenanceRunCount: 0,
      finalErrorCode: "BACKUP_RESTORE_RETENTION_TRANSACTION_FAILED",
      startedAt: dbNow,
      finishedAt: dbNow,
    });

    await expect(
      runBackupRestoreRunRetention({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-2",
        request: {
          mode: "execution",
          policyVersion: "m13f-v1",
          batchLimit: 500,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          retentionFingerprint: "a".repeat(64),
          executionIdempotencyKey: "key-1",
          acknowledgeDeletion: true,
        },
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_RETENTION_IDEMPOTENCY_FAILED_REPLAY", httpStatus: 409 });
  });

  it("handles P2002 race by replay resolution", async () => {
    const idempotencyFingerprint = __testUtils.computeIdempotencyFingerprint({
      ownerUserId: "owner-1",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      policyVersion: "m13f-v1",
      batchLimit: 500,
      retentionFingerprint: "a".repeat(64),
      acknowledgeDeletion: true,
    });

    prismaMock.opsBackupRestoreRetentionRun.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    prismaMock.opsBackupRestoreRetentionRun.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "ret-2",
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        status: "failed",
        policyVersion: "m13f-v1",
        batchLimit: 500,
        evaluationTime: dbNow,
        retentionFingerprint: "a".repeat(64),
        executionIdempotencyKey: "key-1",
        idempotencyFingerprint,
        advisoryLockKey: "1",
        candidateRestoreRunCount: 0,
        candidateMaintenanceRunCount: 0,
        deletedRestoreRunCount: 0,
        deletedMaintenanceRunCount: 0,
        finalErrorCode: "BACKUP_RESTORE_RETENTION_TRANSACTION_FAILED",
        startedAt: dbNow,
        finishedAt: dbNow,
      });

    await expect(
      runBackupRestoreRunRetention({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-1",
        request: {
          mode: "execution",
          policyVersion: "m13f-v1",
          batchLimit: 500,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          retentionFingerprint: "a".repeat(64),
          executionIdempotencyKey: "key-1",
          acknowledgeDeletion: true,
        },
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_RETENTION_IDEMPOTENCY_FAILED_REPLAY", httpStatus: 409 });
  });

  it("returns 200 completed for empty execution batch and writes success audit atomically", async () => {
    const dryRun = await runBackupRestoreRunRetention({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      correlationRequestId: "req-dry",
      request: {
        mode: "dry_run",
        policyVersion: "m13f-v1",
        batchLimit: 500,
      },
    });

    const response = await runBackupRestoreRunRetention({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      correlationRequestId: "req-exec",
      request: {
        mode: "execution",
        policyVersion: "m13f-v1",
        batchLimit: 500,
        evaluationTime: dryRun.evaluationTime,
        retentionFingerprint: dryRun.retentionFingerprint,
        executionIdempotencyKey: "key-1",
        acknowledgeDeletion: true,
      },
    });

    expect(response).toMatchObject({
      mode: "execution",
      status: "completed",
      deletedCounts: { restoreRunsDeleted: 0, maintenanceRunsDeleted: 0 },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("fails on exact-count mismatch and marks same ledger failed", async () => {
    prismaMock.opsBackupRestoreRun.count.mockResolvedValue(1);
    prismaMock.opsBackupRestoreRun.findMany.mockResolvedValue([{ id: "run-1" }]);
    prismaMock.opsBackupRestoreRun.deleteMany.mockResolvedValue({ count: 0 });

    const dryRun = await runBackupRestoreRunRetention({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      correlationRequestId: "req-dry",
      request: {
        mode: "dry_run",
        policyVersion: "m13f-v1",
        batchLimit: 500,
      },
    });

    await expect(
      runBackupRestoreRunRetention({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-exec",
        request: {
          mode: "execution",
          policyVersion: "m13f-v1",
          batchLimit: 500,
          evaluationTime: dryRun.evaluationTime,
          retentionFingerprint: dryRun.retentionFingerprint,
          executionIdempotencyKey: "key-2",
          acknowledgeDeletion: true,
        },
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_RETENTION_TRANSACTION_FAILED", httpStatus: 500 });

    expect(prismaMock.opsBackupRestoreRetentionRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    );
  });

  it("maps unknown 4xx domain errors to explicit public domain conflict", async () => {
    prismaMock.$transaction.mockImplementation(async () => {
      throw new BackupArtifactError("SOME_DOMAIN_4XX", 422, "domain");
    });

    await expect(
      runBackupRestoreRunRetention({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-exec",
        request: {
          mode: "execution",
          policyVersion: "m13f-v1",
          batchLimit: 500,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          retentionFingerprint: "a".repeat(64),
          executionIdempotencyKey: "key-9",
          acknowledgeDeletion: true,
        },
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_RETENTION_DOMAIN_CONFLICT", httpStatus: 409 });
  });

  it("uses shared governance lock key derivation and owner-specific separation", () => {
    const a = __testUtils.deriveAdvisoryLockKey("owner-1");
    const b = __testUtils.deriveAdvisoryLockKey("owner-1");
    const c = __testUtils.deriveAdvisoryLockKey("owner-2");

    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(typeof BigInt(a)).toBe("bigint");
  });

  it("matches M13E and M13F advisory lock keys for the same owner", () => {
    const owner = "owner-1";
    expect(__testUtils.deriveAdvisoryLockKey(owner)).toBe(maintenanceTestUtils.deriveAdvisoryLockKey(owner));
  });
});
