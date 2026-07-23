import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runBackupRestoreRunMaintenance } from "@/lib/backup-v13-restore-run-maintenance";
import { prisma } from "@/lib/prisma";

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

type OpsBackupRestoreMaintenanceRunDelegate = {
  findMany(args: { where: Record<string, unknown> }): Promise<Array<Record<string, unknown>>>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
};

function maintenanceRunTable(): OpsBackupRestoreMaintenanceRunDelegate {
  return (prisma as unknown as { opsBackupRestoreMaintenanceRun: OpsBackupRestoreMaintenanceRunDelegate }).opsBackupRestoreMaintenanceRun;
}

suite("m13 backup restore run maintenance integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dry-run is mutation-free and execution reconciles stale started runs to indeterminate with aggregated audit", async () => {
    const ownerUserId = randomUUID();
    const actorUserId = ownerUserId;
    const staleRunId = randomUUID();
    const freshRunId = randomUUID();
    const completedRunId = randomUUID();
    const staleStartedAt = new Date("2026-07-23T08:00:00.000Z");
    const freshStartedAt = new Date("2026-07-23T09:50:00.000Z");

    try {
      await prisma.opsBackupRestoreRun.createMany({
        data: [
          {
            id: staleRunId,
            ownerUserId,
            backupId: "backup-1",
            actorUserId,
            correlationRequestId: "corr-1",
            strategy: "replace_all",
            previewFingerprint: "a".repeat(64),
            currentStateFingerprint: "b".repeat(64),
            status: "started",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: staleStartedAt,
          },
          {
            id: freshRunId,
            ownerUserId,
            backupId: "backup-2",
            actorUserId,
            correlationRequestId: "corr-2",
            strategy: "replace_all",
            previewFingerprint: "c".repeat(64),
            currentStateFingerprint: "d".repeat(64),
            status: "started",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: freshStartedAt,
          },
          {
            id: completedRunId,
            ownerUserId,
            backupId: "backup-3",
            actorUserId,
            correlationRequestId: "corr-3",
            strategy: "replace_all",
            previewFingerprint: "e".repeat(64),
            currentStateFingerprint: "f".repeat(64),
            status: "completed",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: staleStartedAt,
            finishedAt: new Date("2026-07-23T08:05:00.000Z"),
          },
        ],
      });

      const dryRun = await runBackupRestoreRunMaintenance({
        ownerUserId,
        actorUserId,
        correlationRequestId: "req-dry-run",
        request: {
          mode: "dry_run",
          staleThresholdMinutes: 30,
        },
      });

      expect(dryRun.mode).toBe("dry_run");
      expect(dryRun.summary).toEqual({ candidateCount: 1, reconciledCount: 1 });

      const beforeExecutionRows = await prisma.opsBackupRestoreRun.findMany({
        where: { ownerUserId },
        orderBy: { id: "asc" },
      });
      expect(beforeExecutionRows.find((row) => row.id === staleRunId)?.status).toBe("started");

      const execution = await runBackupRestoreRunMaintenance({
        ownerUserId,
        actorUserId,
        correlationRequestId: "req-execution",
        request: {
          mode: "execution",
          staleThresholdMinutes: 30,
          evaluationTime: dryRun.evaluationTime,
          maintenanceFingerprint: dryRun.maintenanceFingerprint,
          acknowledgeMutation: true,
          executionIdempotencyKey: "maint-key-1",
        },
      });

      expect(execution).toMatchObject({
        mode: "execution",
        status: "completed",
        replayed: false,
        summary: { candidateCount: 1, reconciledCount: 1 },
      });

      const afterExecutionRows = await prisma.opsBackupRestoreRun.findMany({
        where: { ownerUserId },
        orderBy: { id: "asc" },
      });
      expect(afterExecutionRows.find((row) => row.id === staleRunId)?.status).toBe("indeterminate");
      expect(afterExecutionRows.find((row) => row.id === staleRunId)?.finalErrorCode).toBe("BACKUP_RESTORE_RUN_STALE_INDETERMINATE");
      expect(afterExecutionRows.find((row) => row.id === freshRunId)?.status).toBe("started");
      expect(afterExecutionRows.find((row) => row.id === completedRunId)?.status).toBe("completed");

      const maintenanceRows = await maintenanceRunTable().findMany({
        where: { ownerUserId },
      });
      expect(maintenanceRows).toHaveLength(1);
      expect(maintenanceRows[0]?.status).toBe("completed");
      expect(maintenanceRows[0]?.candidatesScanned).toBe(1);
      expect(maintenanceRows[0]?.candidatesReconciledIndeterminate).toBe(1);

      const auditRows = await prisma.auditLog.findMany({
        where: {
          actorUserId: ownerUserId,
          action: {
            in: [
              "ops.backup.restore_run.reconciled_indeterminate",
              "ops.backup.restore_run_maintenance.completed",
            ],
          },
        },
        orderBy: { action: "asc" },
      });
      expect(auditRows).toHaveLength(2);
      expect(auditRows[0]?.metadata).toMatchObject({
        candidateCount: 1,
        reconciledCount: 1,
        evaluationTime: dryRun.evaluationTime,
        staleThresholdMinutes: 30,
      });

      const replay = await runBackupRestoreRunMaintenance({
        ownerUserId,
        actorUserId,
        correlationRequestId: "req-replay",
        request: {
          mode: "execution",
          staleThresholdMinutes: 30,
          evaluationTime: dryRun.evaluationTime,
          maintenanceFingerprint: dryRun.maintenanceFingerprint,
          acknowledgeMutation: true,
          executionIdempotencyKey: "maint-key-1",
        },
      });
      expect(replay).toMatchObject({ replayed: true, summary: { candidateCount: 1, reconciledCount: 1 } });
    } finally {
      await maintenanceRunTable().deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupRestoreRun.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });
});