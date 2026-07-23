import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runBackupRestoreRunMaintenance } from "@/lib/backup-v13-restore-run-maintenance";
import { runBackupRestoreRunRetention } from "@/lib/backup-v13-restore-run-retention";
import { prisma } from "@/lib/prisma";

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

type OpsBackupRestoreRetentionRunDelegate = {
  findMany(args: { where: Record<string, unknown> }): Promise<Array<Record<string, unknown>>>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
};

function retentionRunTable(): OpsBackupRestoreRetentionRunDelegate {
  return (prisma as unknown as { opsBackupRestoreRetentionRun: OpsBackupRestoreRetentionRunDelegate }).opsBackupRestoreRetentionRun;
}

suite("m13 backup restore run retention integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dry-run is mutation-free and execution deletes only eligible rows in deterministic restore-first order", async () => {
    const ownerUserId = randomUUID();
    const actorUserId = ownerUserId;
    const otherOwnerUserId = randomUUID();

    const eligibleRestoreCompleted = randomUUID();
    const eligibleRestoreFailed = randomUUID();
    const startedRestore = randomUUID();
    const indeterminateRestore = randomUUID();
    const nullFinishedRestore = randomUUID();
    const otherOwnerRestore = randomUUID();

    const eligibleMaintenanceCompleted = randomUUID();
    const eligibleMaintenanceFailed = randomUUID();
    const runningMaintenance = randomUUID();
    const nullFinishedMaintenance = randomUUID();
    const otherOwnerMaintenance = randomUUID();

    const oldTime = new Date("2025-01-01T10:00:00.000Z");
    const nowTime = new Date("2026-07-23T10:00:00.000Z");

    try {
      await prisma.opsBackupRestoreRun.createMany({
        data: [
          {
            id: eligibleRestoreCompleted,
            ownerUserId,
            backupId: "backup-1",
            actorUserId,
            correlationRequestId: "corr-1",
            strategy: "replace_all",
            previewFingerprint: "a".repeat(64),
            currentStateFingerprint: "b".repeat(64),
            status: "completed",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: oldTime,
            finishedAt: oldTime,
          },
          {
            id: eligibleRestoreFailed,
            ownerUserId,
            backupId: "backup-2",
            actorUserId,
            correlationRequestId: "corr-2",
            strategy: "replace_all",
            previewFingerprint: "c".repeat(64),
            currentStateFingerprint: "d".repeat(64),
            status: "failed",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: oldTime,
            finishedAt: oldTime,
          },
          {
            id: startedRestore,
            ownerUserId,
            backupId: "backup-3",
            actorUserId,
            correlationRequestId: "corr-3",
            strategy: "replace_all",
            previewFingerprint: "e".repeat(64),
            currentStateFingerprint: "f".repeat(64),
            status: "started",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: nowTime,
          },
          {
            id: indeterminateRestore,
            ownerUserId,
            backupId: "backup-4",
            actorUserId,
            correlationRequestId: "corr-4",
            strategy: "replace_all",
            previewFingerprint: "1".repeat(64),
            currentStateFingerprint: "2".repeat(64),
            status: "indeterminate",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: oldTime,
            finishedAt: oldTime,
            finalErrorCode: "BACKUP_RESTORE_RUN_STALE_INDETERMINATE",
          },
          {
            id: nullFinishedRestore,
            ownerUserId,
            backupId: "backup-5",
            actorUserId,
            correlationRequestId: "corr-5",
            strategy: "replace_all",
            previewFingerprint: "3".repeat(64),
            currentStateFingerprint: "4".repeat(64),
            status: "failed",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: oldTime,
            finishedAt: null,
          },
          {
            id: otherOwnerRestore,
            ownerUserId: otherOwnerUserId,
            backupId: "backup-6",
            actorUserId: otherOwnerUserId,
            correlationRequestId: "corr-6",
            strategy: "replace_all",
            previewFingerprint: "5".repeat(64),
            currentStateFingerprint: "6".repeat(64),
            status: "completed",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: oldTime,
            finishedAt: oldTime,
          },
        ],
      });

      await (prisma as unknown as { opsBackupRestoreMaintenanceRun: { createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown> } })
        .opsBackupRestoreMaintenanceRun
        .createMany({
          data: [
            {
              id: eligibleMaintenanceCompleted,
              ownerUserId,
              actorUserId,
              status: "completed",
              staleThresholdMinutes: 30,
              evaluationTime: oldTime,
              maintenanceFingerprint: "a".repeat(64),
              executionIdempotencyKey: `k-${randomUUID()}`,
              idempotencyFingerprint: "b".repeat(64),
              advisoryLockKey: "1",
              candidatesScanned: 1,
              candidatesReconciledIndeterminate: 1,
              finalErrorCode: null,
              startedAt: oldTime,
              finishedAt: oldTime,
            },
            {
              id: eligibleMaintenanceFailed,
              ownerUserId,
              actorUserId,
              status: "failed",
              staleThresholdMinutes: 30,
              evaluationTime: oldTime,
              maintenanceFingerprint: "c".repeat(64),
              executionIdempotencyKey: `k-${randomUUID()}`,
              idempotencyFingerprint: "d".repeat(64),
              advisoryLockKey: "1",
              candidatesScanned: 1,
              candidatesReconciledIndeterminate: 0,
              finalErrorCode: "BACKUP_RESTORE_MAINTENANCE_TRANSACTION_FAILED",
              startedAt: oldTime,
              finishedAt: oldTime,
            },
            {
              id: runningMaintenance,
              ownerUserId,
              actorUserId,
              status: "running",
              staleThresholdMinutes: 30,
              evaluationTime: nowTime,
              maintenanceFingerprint: "e".repeat(64),
              executionIdempotencyKey: `k-${randomUUID()}`,
              idempotencyFingerprint: "f".repeat(64),
              advisoryLockKey: "1",
              candidatesScanned: 0,
              candidatesReconciledIndeterminate: 0,
              finalErrorCode: null,
              startedAt: nowTime,
              finishedAt: null,
            },
            {
              id: nullFinishedMaintenance,
              ownerUserId,
              actorUserId,
              status: "failed",
              staleThresholdMinutes: 30,
              evaluationTime: oldTime,
              maintenanceFingerprint: "1".repeat(64),
              executionIdempotencyKey: `k-${randomUUID()}`,
              idempotencyFingerprint: "2".repeat(64),
              advisoryLockKey: "1",
              candidatesScanned: 0,
              candidatesReconciledIndeterminate: 0,
              finalErrorCode: "BACKUP_RESTORE_MAINTENANCE_TRANSACTION_FAILED",
              startedAt: oldTime,
              finishedAt: null,
            },
            {
              id: otherOwnerMaintenance,
              ownerUserId: otherOwnerUserId,
              actorUserId: otherOwnerUserId,
              status: "completed",
              staleThresholdMinutes: 30,
              evaluationTime: oldTime,
              maintenanceFingerprint: "3".repeat(64),
              executionIdempotencyKey: `k-${randomUUID()}`,
              idempotencyFingerprint: "4".repeat(64),
              advisoryLockKey: "1",
              candidatesScanned: 0,
              candidatesReconciledIndeterminate: 0,
              finalErrorCode: null,
              startedAt: oldTime,
              finishedAt: oldTime,
            },
          ],
        });

      const dryRun = await runBackupRestoreRunRetention({
        ownerUserId,
        actorUserId,
        correlationRequestId: "req-dry",
        request: {
          mode: "dry_run",
          policyVersion: "m13f-v1",
          batchLimit: 500,
        },
      });

      expect(dryRun.mode).toBe("dry_run");
      expect(dryRun.summary.restoreRunCandidatesCount).toBe(2);
      expect(dryRun.summary.maintenanceRunCandidatesCount).toBe(2);
      expect(dryRun.summary.totalCandidatesCount).toBe(4);

      const beforeLedger = await retentionRunTable().findMany({ where: { ownerUserId } });
      expect(beforeLedger).toHaveLength(0);

      const execution = await runBackupRestoreRunRetention({
        ownerUserId,
        actorUserId,
        correlationRequestId: "req-exec",
        request: {
          mode: "execution",
          policyVersion: "m13f-v1",
          batchLimit: 500,
          evaluationTime: dryRun.evaluationTime,
          retentionFingerprint: dryRun.retentionFingerprint,
          executionIdempotencyKey: "ret-key-1",
          acknowledgeDeletion: true,
        },
      });

      expect(execution).toMatchObject({
        mode: "execution",
        status: "completed",
        replayed: false,
        deletedCounts: {
          restoreRunsDeleted: 2,
          maintenanceRunsDeleted: 2,
        },
      });

      const ownedRestoreRows = await prisma.opsBackupRestoreRun.findMany({ where: { ownerUserId } });
      const ownedRestoreIds = new Set(ownedRestoreRows.map((row) => row.id));
      expect(ownedRestoreIds.has(eligibleRestoreCompleted)).toBe(false);
      expect(ownedRestoreIds.has(eligibleRestoreFailed)).toBe(false);
      expect(ownedRestoreIds.has(startedRestore)).toBe(true);
      expect(ownedRestoreIds.has(indeterminateRestore)).toBe(true);
      expect(ownedRestoreIds.has(nullFinishedRestore)).toBe(true);

      const otherOwnerRestoreRows = await prisma.opsBackupRestoreRun.findMany({ where: { ownerUserId: otherOwnerUserId } });
      expect(otherOwnerRestoreRows.map((row) => row.id)).toContain(otherOwnerRestore);

      const ownedMaintenanceRows = await (prisma as unknown as { opsBackupRestoreMaintenanceRun: { findMany(args: { where: Record<string, unknown> }): Promise<Array<Record<string, unknown>>> } })
        .opsBackupRestoreMaintenanceRun
        .findMany({ where: { ownerUserId } });
      const ownedMaintenanceIds = new Set(ownedMaintenanceRows.map((row) => String(row.id)));
      expect(ownedMaintenanceIds.has(eligibleMaintenanceCompleted)).toBe(false);
      expect(ownedMaintenanceIds.has(eligibleMaintenanceFailed)).toBe(false);
      expect(ownedMaintenanceIds.has(runningMaintenance)).toBe(true);
      expect(ownedMaintenanceIds.has(nullFinishedMaintenance)).toBe(true);

      const otherOwnerMaintenanceRows = await (prisma as unknown as { opsBackupRestoreMaintenanceRun: { findMany(args: { where: Record<string, unknown> }): Promise<Array<Record<string, unknown>>> } })
        .opsBackupRestoreMaintenanceRun
        .findMany({ where: { ownerUserId: otherOwnerUserId } });
      expect(otherOwnerMaintenanceRows.map((row) => String(row.id))).toContain(otherOwnerMaintenance);

      const retentionRows = await retentionRunTable().findMany({ where: { ownerUserId } });
      expect(retentionRows).toHaveLength(1);
      expect(retentionRows[0]?.status).toBe("completed");

      const successAuditRows = await prisma.auditLog.findMany({
        where: {
          actorUserId: ownerUserId,
          action: "ops.backup.restore_retention.execution.completed",
        },
      });
      expect(successAuditRows).toHaveLength(1);

      const replay = await runBackupRestoreRunRetention({
        ownerUserId,
        actorUserId,
        correlationRequestId: "req-replay",
        request: {
          mode: "execution",
          policyVersion: "m13f-v1",
          batchLimit: 500,
          evaluationTime: dryRun.evaluationTime,
          retentionFingerprint: dryRun.retentionFingerprint,
          executionIdempotencyKey: "ret-key-1",
          acknowledgeDeletion: true,
        },
      });
      expect(replay).toMatchObject({ replayed: true });
    } finally {
      await retentionRunTable().deleteMany({ where: { ownerUserId } });
      await retentionRunTable().deleteMany({ where: { ownerUserId: otherOwnerUserId } });
      await (prisma as unknown as { opsBackupRestoreMaintenanceRun: { deleteMany(args: { where: Record<string, unknown> }): Promise<unknown> } })
        .opsBackupRestoreMaintenanceRun
        .deleteMany({ where: { ownerUserId } });
      await (prisma as unknown as { opsBackupRestoreMaintenanceRun: { deleteMany(args: { where: Record<string, unknown> }): Promise<unknown> } })
        .opsBackupRestoreMaintenanceRun
        .deleteMany({ where: { ownerUserId: otherOwnerUserId } });
      await prisma.opsBackupRestoreRun.deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupRestoreRun.deleteMany({ where: { ownerUserId: otherOwnerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: otherOwnerUserId } });
    }
  });

  it("enforces lock conflict with concurrent same-owner governance operations and preserves no audit deletion", async () => {
    const ownerUserId = randomUUID();
    const actorUserId = ownerUserId;

    try {
      const staleStartedRunId = randomUUID();
      await prisma.opsBackupRestoreRun.create({
        data: {
          id: staleStartedRunId,
          ownerUserId,
          backupId: "backup-maint",
          actorUserId,
          correlationRequestId: "corr-maint",
          strategy: "replace_all",
          previewFingerprint: "a".repeat(64),
          currentStateFingerprint: "b".repeat(64),
          status: "started",
          attemptCount: 1,
          maxAttempts: 3,
          startedAt: new Date("2026-07-23T08:00:00.000Z"),
        },
      });

      const maintenanceDryRun = await runBackupRestoreRunMaintenance({
        ownerUserId,
        actorUserId,
        correlationRequestId: "maint-dry",
        request: {
          mode: "dry_run",
          staleThresholdMinutes: 30,
        },
      });

      await runBackupRestoreRunMaintenance({
        ownerUserId,
        actorUserId,
        correlationRequestId: "maint-running",
        request: {
          mode: "execution",
          staleThresholdMinutes: 30,
          evaluationTime: maintenanceDryRun.evaluationTime,
          maintenanceFingerprint: maintenanceDryRun.maintenanceFingerprint,
          acknowledgeMutation: true,
          executionIdempotencyKey: "maint-running-key",
        },
      });

      const retentionDryRun = await runBackupRestoreRunRetention({
        ownerUserId,
        actorUserId,
        correlationRequestId: "ret-dry",
        request: {
          mode: "dry_run",
          policyVersion: "m13f-v1",
          batchLimit: 500,
        },
      });

      const retentionExec = await runBackupRestoreRunRetention({
        ownerUserId,
        actorUserId,
        correlationRequestId: "ret-exec",
        request: {
          mode: "execution",
          policyVersion: "m13f-v1",
          batchLimit: 500,
          evaluationTime: retentionDryRun.evaluationTime,
          retentionFingerprint: retentionDryRun.retentionFingerprint,
          executionIdempotencyKey: "ret-concurrency",
          acknowledgeDeletion: true,
        },
      });

      expect(retentionExec.status).toBe("completed");

      const auditRowsBefore = await prisma.auditLog.findMany({ where: { actorUserId: ownerUserId } });
      const idsBefore = new Set(auditRowsBefore.map((row) => row.id));

      const dryRunNoCandidates = await runBackupRestoreRunRetention({
        ownerUserId,
        actorUserId,
        correlationRequestId: "ret-empty-dry",
        request: {
          mode: "dry_run",
          policyVersion: "m13f-v1",
          batchLimit: 500,
        },
      });

      const emptyExecution = await runBackupRestoreRunRetention({
        ownerUserId,
        actorUserId,
        correlationRequestId: "ret-empty-exec",
        request: {
          mode: "execution",
          policyVersion: "m13f-v1",
          batchLimit: 500,
          evaluationTime: dryRunNoCandidates.evaluationTime,
          retentionFingerprint: dryRunNoCandidates.retentionFingerprint,
          executionIdempotencyKey: "ret-empty",
          acknowledgeDeletion: true,
        },
      });

      expect(emptyExecution).toMatchObject({
        status: "completed",
        deletedCounts: {
          restoreRunsDeleted: 0,
          maintenanceRunsDeleted: 0,
        },
      });

      const auditRowsAfter = await prisma.auditLog.findMany({ where: { actorUserId: ownerUserId } });
      expect(auditRowsAfter.length).toBeGreaterThanOrEqual(auditRowsBefore.length);
      for (const row of auditRowsBefore) {
        expect(idsBefore.has(row.id)).toBe(true);
      }
    } finally {
      await retentionRunTable().deleteMany({ where: { ownerUserId } });
      await (prisma as unknown as { opsBackupRestoreMaintenanceRun: { deleteMany(args: { where: Record<string, unknown> }): Promise<unknown> } })
        .opsBackupRestoreMaintenanceRun
        .deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupRestoreRun.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });
});
