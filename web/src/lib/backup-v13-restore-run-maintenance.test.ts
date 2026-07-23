import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";

const dbNow = new Date("2026-07-23T10:00:00.000Z");

const prismaMock = vi.hoisted(() => ({
  opsBackupRestoreRun: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  opsBackupRestoreMaintenanceRun: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
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

import { runBackupRestoreRunMaintenance, __testUtils } from "./backup-v13-restore-run-maintenance";

function buildExecutionRequest(overrides?: Partial<{
  staleThresholdMinutes: number;
  evaluationTime: string;
  maintenanceFingerprint: string;
  acknowledgeMutation: true;
  executionIdempotencyKey: string;
}>) {
  return {
    mode: "execution" as const,
    staleThresholdMinutes: 30,
    evaluationTime: "2026-07-23T10:00:00.000Z",
    maintenanceFingerprint: "a".repeat(64),
    acknowledgeMutation: true as const,
    executionIdempotencyKey: "key-1",
    ...overrides,
  };
}

describe("backup-v13-restore-run-maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.setSystemTime(dbNow);
    prismaMock.opsBackupRestoreRun.findMany.mockResolvedValue([]);
    prismaMock.opsBackupRestoreRun.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.opsBackupRestoreMaintenanceRun.findUnique.mockResolvedValue(null);
    prismaMock.opsBackupRestoreMaintenanceRun.create.mockResolvedValue({ id: "maint-1" });
    prismaMock.opsBackupRestoreMaintenanceRun.update.mockResolvedValue({});
    auditMock.writeOpsAuditEvent.mockResolvedValue(undefined);
    prismaMock.$transaction.mockImplementation(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const tx = {
        opsBackupRestoreRun: prismaMock.opsBackupRestoreRun,
        $queryRaw: vi.fn()
          .mockResolvedValueOnce([{ acquired: true }])
          .mockResolvedValueOnce([{ now: dbNow }]),
      } as unknown as Prisma.TransactionClient;

      return callback(tx);
    });
  });

  it("returns dry-run evaluationTime, fingerprint, and zero-mutation summary", async () => {
    prismaMock.opsBackupRestoreRun.findMany.mockResolvedValue([
      { id: "run-b", startedAt: new Date("2026-07-23T08:00:00.000Z") },
      { id: "run-a", startedAt: new Date("2026-07-23T07:00:00.000Z") },
    ]);

    const response = await runBackupRestoreRunMaintenance({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      correlationRequestId: "req-1",
      request: {
        mode: "dry_run",
        staleThresholdMinutes: 30,
      },
    });

    expect(response).toMatchObject({
      mode: "dry_run",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      summary: {
        candidateCount: 2,
        reconciledCount: 2,
      },
    });
    expect(response.maintenanceFingerprint).toBe(
      __testUtils.computeMaintenanceFingerprint({
        ownerUserId: "owner-1",
        evaluationTime: "2026-07-23T10:00:00.000Z",
        staleThresholdMinutes: 30,
        candidateRestoreRunIds: ["run-a", "run-b"],
      }),
    );
    expect(prismaMock.opsBackupRestoreMaintenanceRun.create).not.toHaveBeenCalled();
    expect(prismaMock.opsBackupRestoreRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 500,
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("rejects uppercase maintenanceFingerprint", async () => {
    await expect(
      runBackupRestoreRunMaintenance({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-1",
        request: {
          mode: "execution",
          staleThresholdMinutes: 30,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          maintenanceFingerprint: "A".repeat(64),
          acknowledgeMutation: true,
          executionIdempotencyKey: "key-1",
        },
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_MAINTENANCE_FINGERPRINT_INVALID", httpStatus: 400 });
  });

  it("rejects short, long, nonhex, and whitespace fingerprints", async () => {
    const invalidFingerprints = [
      "a".repeat(63),
      "a".repeat(65),
      `${"a".repeat(63)}g`,
      ` ${"a".repeat(64)}`,
      `${"a".repeat(64)} `,
    ];

    for (const maintenanceFingerprint of invalidFingerprints) {
      await expect(
        runBackupRestoreRunMaintenance({
          ownerUserId: "owner-1",
          actorUserId: "owner-1",
          correlationRequestId: "req-1",
          request: buildExecutionRequest({ maintenanceFingerprint }),
        }),
      ).rejects.toMatchObject({ code: "BACKUP_RESTORE_MAINTENANCE_FINGERPRINT_INVALID", httpStatus: 400 });
    }
  });

  it("rejects execution evaluationTime variants that violate strict UTC format or window", async () => {
    const invalidEvaluationTimes = [
      "2026-07-23T10:00:00.000",
      "2026-07-23T10:00:00.000+00:00",
      "2026-07-23T10:00:00Z",
      " 2026-07-23T10:00:00.000Z",
      "2026-07-23T10:00:00.000Z ",
      "2026-07-23T10:00:01.000Z",
      "2026-07-23T09:29:59.999Z",
    ];

    for (const evaluationTime of invalidEvaluationTimes) {
      await expect(
        runBackupRestoreRunMaintenance({
          ownerUserId: "owner-1",
          actorUserId: "owner-1",
          correlationRequestId: "req-1",
          request: buildExecutionRequest({ evaluationTime }),
        }),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/^BACKUP_RESTORE_MAINTENANCE_EVALUATION_TIME_(INVALID|EXPIRED)$/),
        httpStatus: 400,
      });
    }
  });

  it("uses canonical payload order and matches explicit expected fingerprint hash", () => {
    const fingerprint = __testUtils.computeMaintenanceFingerprint({
      ownerUserId: "owner-1",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      staleThresholdMinutes: 30,
      candidateRestoreRunIds: ["run-a", "run-b"],
    });

    expect(fingerprint).toBe("05d96a0443006ffcf0a59b4e4b19f7d05c390cb78daaa3fd0026cff79eab9ba9");
  });

  it("changes fingerprint when any canonical field changes", () => {
    const baseline = __testUtils.computeMaintenanceFingerprint({
      ownerUserId: "owner-1",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      staleThresholdMinutes: 30,
      candidateRestoreRunIds: ["run-a", "run-b"],
    });
    const differentOwner = __testUtils.computeMaintenanceFingerprint({
      ownerUserId: "owner-2",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      staleThresholdMinutes: 30,
      candidateRestoreRunIds: ["run-a", "run-b"],
    });
    const differentTime = __testUtils.computeMaintenanceFingerprint({
      ownerUserId: "owner-1",
      evaluationTime: "2026-07-23T10:00:01.000Z",
      staleThresholdMinutes: 30,
      candidateRestoreRunIds: ["run-a", "run-b"],
    });
    const differentThreshold = __testUtils.computeMaintenanceFingerprint({
      ownerUserId: "owner-1",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      staleThresholdMinutes: 31,
      candidateRestoreRunIds: ["run-a", "run-b"],
    });
    const differentCandidates = __testUtils.computeMaintenanceFingerprint({
      ownerUserId: "owner-1",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      staleThresholdMinutes: 30,
      candidateRestoreRunIds: ["run-a", "run-c"],
    });

    expect(differentOwner).not.toBe(baseline);
    expect(differentTime).not.toBe(baseline);
    expect(differentThreshold).not.toBe(baseline);
    expect(differentCandidates).not.toBe(baseline);
  });

  it("marks stale started runs indeterminate and writes aggregated audit", async () => {
    prismaMock.opsBackupRestoreRun.findMany.mockResolvedValue([
      { id: "run-2", startedAt: new Date("2026-07-23T08:59:00.000Z") },
      { id: "run-1", startedAt: new Date("2026-07-23T08:58:00.000Z") },
    ]);
    prismaMock.opsBackupRestoreRun.updateMany.mockResolvedValue({ count: 2 });
    const maintenanceFingerprint = __testUtils.computeMaintenanceFingerprint({
      ownerUserId: "owner-1",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      staleThresholdMinutes: 30,
      candidateRestoreRunIds: ["run-1", "run-2"],
    });

    const response = await runBackupRestoreRunMaintenance({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      correlationRequestId: "req-1",
      request: {
        mode: "execution",
        staleThresholdMinutes: 30,
        evaluationTime: "2026-07-23T10:00:00.000Z",
        maintenanceFingerprint,
        acknowledgeMutation: true,
        executionIdempotencyKey: "key-1",
      },
    });

    expect(response).toMatchObject({
      mode: "execution",
      runId: "maint-1",
      status: "completed",
      replayed: false,
      summary: { candidateCount: 2, reconciledCount: 2 },
    });
    expect(prismaMock.opsBackupRestoreRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "indeterminate",
          finalErrorCode: "BACKUP_RESTORE_RUN_STALE_INDETERMINATE",
        }),
      }),
    );
    expect(auditMock.writeOpsAuditEvent).toHaveBeenCalledTimes(2);
    expect(auditMock.writeOpsAuditEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: "ops.backup.restore_run.reconciled_indeterminate",
        metadata: expect.objectContaining({
          maintenanceRunId: "maint-1",
          candidateCount: 2,
          reconciledCount: 2,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          staleThresholdMinutes: 30,
        }),
      }),
      expect.anything(),
      { strict: true },
    );
    expect(auditMock.writeOpsAuditEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: "ops.backup.restore_run_maintenance.completed",
        metadata: expect.objectContaining({
          maintenanceRunId: "maint-1",
          candidateCount: 2,
          reconciledCount: 2,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          staleThresholdMinutes: 30,
        }),
      }),
      expect.anything(),
      { strict: true },
    );
  });

  it("uses owner-scoped started-only stale query with deterministic ordering and batch limit", async () => {
    await runBackupRestoreRunMaintenance({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      correlationRequestId: "req-1",
      request: {
        mode: "dry_run",
        staleThresholdMinutes: 30,
      },
    });

    expect(prismaMock.opsBackupRestoreRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerUserId: "owner-1",
          status: "started",
          startedAt: { lte: new Date("2026-07-23T09:30:00.000Z") },
        }),
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
        take: 500,
      }),
    );
  });

  it("reconciles at most 500 candidates and fingerprints the exact selected batch", async () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({
      id: `run-${String(index + 1).padStart(3, "0")}`,
      startedAt: new Date("2026-07-23T08:00:00.000Z"),
    }));
    prismaMock.opsBackupRestoreRun.findMany.mockResolvedValue(rows);
    prismaMock.opsBackupRestoreRun.updateMany.mockResolvedValue({ count: 500 });
    const maintenanceFingerprint = __testUtils.computeMaintenanceFingerprint({
      ownerUserId: "owner-1",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      staleThresholdMinutes: 30,
      candidateRestoreRunIds: rows.map((row) => row.id),
    });

    const response = await runBackupRestoreRunMaintenance({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      correlationRequestId: "req-1",
      request: buildExecutionRequest({ maintenanceFingerprint }),
    });

    expect(response.summary).toEqual({ candidateCount: 500, reconciledCount: 500 });
    expect(response.maintenanceFingerprint).toBe(maintenanceFingerprint);
  });

  it("fails closed when running ledger cannot be created", async () => {
    prismaMock.opsBackupRestoreMaintenanceRun.create.mockRejectedValue(new Error("db down"));

    await expect(
      runBackupRestoreRunMaintenance({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-1",
        request: {
          mode: "execution",
          staleThresholdMinutes: 30,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          maintenanceFingerprint: "a".repeat(64),
          acknowledgeMutation: true,
          executionIdempotencyKey: "key-1",
        },
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_MAINTENANCE_UNAVAILABLE", httpStatus: 500 });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("marks ledger failed on advisory lock conflict and preserves original error", async () => {
    prismaMock.$transaction.mockImplementation(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const tx = {
        opsBackupRestoreRun: prismaMock.opsBackupRestoreRun,
        $queryRaw: vi.fn().mockResolvedValue([{ acquired: false }]),
      } as unknown as Prisma.TransactionClient;
      return callback(tx);
    });

    await expect(
      runBackupRestoreRunMaintenance({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-1",
        request: {
          mode: "execution",
          staleThresholdMinutes: 30,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          maintenanceFingerprint: __testUtils.computeMaintenanceFingerprint({
            ownerUserId: "owner-1",
            evaluationTime: "2026-07-23T10:00:00.000Z",
            staleThresholdMinutes: 30,
            candidateRestoreRunIds: [],
          }),
          acknowledgeMutation: true,
          executionIdempotencyKey: "key-1",
        },
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_MAINTENANCE_LOCK_CONFLICT", httpStatus: 409 });

    expect(prismaMock.opsBackupRestoreMaintenanceRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", finalErrorCode: "BACKUP_RESTORE_MAINTENANCE_LOCK_CONFLICT" }),
      }),
    );
  });

  it("preserves original error when failed-status persistence also fails", async () => {
    prismaMock.opsBackupRestoreMaintenanceRun.update.mockRejectedValueOnce(new Error("failed update down"));
    prismaMock.$transaction.mockImplementation(async () => {
      throw new BackupArtifactError("BACKUP_RESTORE_MAINTENANCE_LOCK_CONFLICT", 409, "conflict");
    });

    await expect(
      runBackupRestoreRunMaintenance({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-1",
        request: buildExecutionRequest({
          maintenanceFingerprint: __testUtils.computeMaintenanceFingerprint({
            ownerUserId: "owner-1",
            evaluationTime: "2026-07-23T10:00:00.000Z",
            staleThresholdMinutes: 30,
            candidateRestoreRunIds: [],
          }),
        }),
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_MAINTENANCE_LOCK_CONFLICT", httpStatus: 409 });
  });

  it("marks ledger failed with domain conflict code for post-insert 4xx errors", async () => {
    prismaMock.$transaction.mockImplementation(async () => {
      throw new BackupArtifactError("SOME_DOMAIN_CONFLICT", 409, "domain conflict");
    });

    await expect(
      runBackupRestoreRunMaintenance({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-1",
        request: buildExecutionRequest({ maintenanceFingerprint: __testUtils.computeMaintenanceFingerprint({
          ownerUserId: "owner-1",
          evaluationTime: "2026-07-23T10:00:00.000Z",
          staleThresholdMinutes: 30,
          candidateRestoreRunIds: [],
        }) }),
      }),
    ).rejects.toMatchObject({ code: "SOME_DOMAIN_CONFLICT", httpStatus: 409 });

    expect(prismaMock.opsBackupRestoreMaintenanceRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ finalErrorCode: "BACKUP_RESTORE_MAINTENANCE_DOMAIN_CONFLICT" }) }),
    );
  });

  it("marks ledger failed with transaction-failed code for unexpected failures", async () => {
    prismaMock.$transaction.mockImplementation(async () => {
      throw new Error("tx exploded");
    });

    await expect(
      runBackupRestoreRunMaintenance({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-1",
        request: buildExecutionRequest({ maintenanceFingerprint: __testUtils.computeMaintenanceFingerprint({
          ownerUserId: "owner-1",
          evaluationTime: "2026-07-23T10:00:00.000Z",
          staleThresholdMinutes: 30,
          candidateRestoreRunIds: [],
        }) }),
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR", httpStatus: 500 });

    expect(prismaMock.opsBackupRestoreMaintenanceRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ finalErrorCode: "BACKUP_RESTORE_MAINTENANCE_TRANSACTION_FAILED" }) }),
    );
  });

  it("marks ledger failed on fingerprint mismatch with zero mutations", async () => {
    prismaMock.opsBackupRestoreRun.findMany.mockResolvedValue([
      { id: "run-1", startedAt: new Date("2026-07-23T08:00:00.000Z") },
    ]);

    await expect(
      runBackupRestoreRunMaintenance({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-1",
        request: {
          mode: "execution",
          staleThresholdMinutes: 30,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          maintenanceFingerprint: "a".repeat(64),
          acknowledgeMutation: true,
          executionIdempotencyKey: "key-1",
        },
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_MAINTENANCE_FINGERPRINT_MISMATCH", httpStatus: 409 });

    expect(prismaMock.opsBackupRestoreRun.updateMany).not.toHaveBeenCalled();
  });

  it("returns completed replay for same idempotency fingerprint", async () => {
    prismaMock.opsBackupRestoreMaintenanceRun.findUnique.mockResolvedValue({
      id: "maint-1",
      ownerUserId: "owner-1",
      status: "completed",
      staleThresholdMinutes: 30,
      evaluationTime: dbNow,
      maintenanceFingerprint: "a".repeat(64),
      executionIdempotencyKey: "key-1",
      idempotencyFingerprint: __testUtils.computeIdempotencyFingerprint({
        ownerUserId: "owner-1",
        evaluationTime: "2026-07-23T10:00:00.000Z",
        staleThresholdMinutes: 30,
        maintenanceFingerprint: "a".repeat(64),
      }),
      advisoryLockKey: "1",
      candidatesScanned: 4,
      candidatesReconciledIndeterminate: 3,
      finalErrorCode: null,
      startedAt: dbNow,
      finishedAt: dbNow,
    });

    const response = await runBackupRestoreRunMaintenance({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      correlationRequestId: "req-1",
      request: {
        mode: "execution",
        staleThresholdMinutes: 30,
        evaluationTime: "2026-07-23T10:00:00.000Z",
        maintenanceFingerprint: "a".repeat(64),
        acknowledgeMutation: true,
        executionIdempotencyKey: "key-1",
      },
    });

    expect(response).toMatchObject({
      mode: "execution",
      runId: "maint-1",
      replayed: true,
      summary: { candidateCount: 4, reconciledCount: 3 },
    });
    expect(prismaMock.opsBackupRestoreMaintenanceRun.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("returns idempotency key mismatch conflict and never reruns", async () => {
    prismaMock.opsBackupRestoreMaintenanceRun.findUnique.mockResolvedValue({
      id: "maint-1",
      ownerUserId: "owner-1",
      status: "completed",
      staleThresholdMinutes: 30,
      evaluationTime: dbNow,
      maintenanceFingerprint: "a".repeat(64),
      executionIdempotencyKey: "key-1",
      idempotencyFingerprint: "b".repeat(64),
      advisoryLockKey: "1",
      candidatesScanned: 1,
      candidatesReconciledIndeterminate: 1,
      finalErrorCode: null,
      startedAt: dbNow,
      finishedAt: dbNow,
    });

    await expect(
      runBackupRestoreRunMaintenance({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-1",
        request: buildExecutionRequest(),
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_MAINTENANCE_IDEMPOTENCY_KEY_MISMATCH", httpStatus: 409 });

    expect(prismaMock.opsBackupRestoreMaintenanceRun.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("returns running conflict replay when completed update failed after commit", async () => {
    const maintenanceFingerprint = __testUtils.computeMaintenanceFingerprint({
      ownerUserId: "owner-1",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      staleThresholdMinutes: 30,
      candidateRestoreRunIds: [],
    });

    prismaMock.opsBackupRestoreMaintenanceRun.update.mockRejectedValueOnce(new Error("cannot update completed"));
    prismaMock.opsBackupRestoreMaintenanceRun.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "maint-1",
      ownerUserId: "owner-1",
      status: "running",
      staleThresholdMinutes: 30,
      evaluationTime: dbNow,
      maintenanceFingerprint,
      executionIdempotencyKey: "key-1",
      idempotencyFingerprint: __testUtils.computeIdempotencyFingerprint({
        ownerUserId: "owner-1",
        evaluationTime: "2026-07-23T10:00:00.000Z",
        staleThresholdMinutes: 30,
        maintenanceFingerprint,
      }),
      advisoryLockKey: "1",
      candidatesScanned: 0,
      candidatesReconciledIndeterminate: 0,
      finalErrorCode: null,
      startedAt: dbNow,
      finishedAt: null,
    });

    const first = await runBackupRestoreRunMaintenance({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      correlationRequestId: "req-1",
      request: {
        mode: "execution",
        staleThresholdMinutes: 30,
        evaluationTime: "2026-07-23T10:00:00.000Z",
        maintenanceFingerprint,
        acknowledgeMutation: true,
        executionIdempotencyKey: "key-1",
      },
    });

    expect(first).toMatchObject({ status: "completed", replayed: false });

    await expect(
      runBackupRestoreRunMaintenance({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-2",
        request: {
          mode: "execution",
          staleThresholdMinutes: 30,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          maintenanceFingerprint,
          acknowledgeMutation: true,
          executionIdempotencyKey: "key-1",
        },
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_MAINTENANCE_IDEMPOTENCY_RUNNING", httpStatus: 409 });
  });

  it("handles unique insert race as replay instead of generic 500", async () => {
    const maintenanceFingerprint = "a".repeat(64);
    const idempotencyFingerprint = __testUtils.computeIdempotencyFingerprint({
      ownerUserId: "owner-1",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      staleThresholdMinutes: 30,
      maintenanceFingerprint,
    });

    prismaMock.opsBackupRestoreMaintenanceRun.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    prismaMock.opsBackupRestoreMaintenanceRun.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "maint-2",
        ownerUserId: "owner-1",
        status: "failed",
        staleThresholdMinutes: 30,
        evaluationTime: dbNow,
        maintenanceFingerprint,
        executionIdempotencyKey: "key-1",
        idempotencyFingerprint,
        advisoryLockKey: "1",
        candidatesScanned: 1,
        candidatesReconciledIndeterminate: 0,
        finalErrorCode: "BACKUP_RESTORE_MAINTENANCE_TRANSACTION_FAILED",
        startedAt: dbNow,
        finishedAt: dbNow,
      });

    await expect(
      runBackupRestoreRunMaintenance({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        correlationRequestId: "req-1",
        request: {
          mode: "execution",
          staleThresholdMinutes: 30,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          maintenanceFingerprint,
          acknowledgeMutation: true,
          executionIdempotencyKey: "key-1",
        },
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_MAINTENANCE_IDEMPOTENCY_FAILED_REPLAY", httpStatus: 409 });
  });

  it("provides stable advisory lock key per owner and distinct keys per different owners", () => {
    const a = __testUtils.deriveAdvisoryLockKey("owner-1");
    const b = __testUtils.deriveAdvisoryLockKey("owner-1");
    const c = __testUtils.deriveAdvisoryLockKey("owner-2");

    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(typeof BigInt(a)).toBe("bigint");
  });
});