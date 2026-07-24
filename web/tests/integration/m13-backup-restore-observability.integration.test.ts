import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildRestoreGovernanceHealth,
  buildRestoreGovernanceObservability,
} from "@/lib/backup-v13-restore-observability";
import { prisma } from "@/lib/prisma";

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

type RestoreRunTable = {
  createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
  findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc"> }): Promise<Array<Record<string, unknown>>>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
};

type MaintenanceRunTable = {
  createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
  findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc"> }): Promise<Array<Record<string, unknown>>>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
};

type RetentionRunTable = {
  createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
  findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc"> }): Promise<Array<Record<string, unknown>>>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
};

function restoreRunTable(): RestoreRunTable {
  return (prisma as unknown as { opsBackupRestoreRun: RestoreRunTable }).opsBackupRestoreRun;
}

function maintenanceRunTable(): MaintenanceRunTable {
  return (prisma as unknown as { opsBackupRestoreMaintenanceRun: MaintenanceRunTable }).opsBackupRestoreMaintenanceRun;
}

function retentionRunTable(): RetentionRunTable {
  return (prisma as unknown as { opsBackupRestoreRetentionRun: RetentionRunTable }).opsBackupRestoreRetentionRun;
}

suite("m13 restore observability integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enforces owner isolation, window semantics, deterministic timeline, and zero mutation", async () => {
    const ownerUserId = randomUUID();
    const otherOwnerUserId = randomUUID();
    const actorUserId = ownerUserId;

    const staleRestoreId = randomUUID();
    const staleMaintenanceId = randomUUID();
    const staleRetentionId = randomUUID();

    const startedBeforeWindowCompletedInside = randomUUID();
    const failedInside = randomUUID();
    const indeterminateInside = randomUUID();

    const sharedFinishedAt = new Date("2026-07-24T09:00:00.000Z");
    const windowStart = new Date("2026-07-23T12:00:00.000Z");

    try {
      await restoreRunTable().createMany({
        data: [
          {
            id: startedBeforeWindowCompletedInside,
            ownerUserId,
            backupId: "backup-before-window",
            actorUserId,
            correlationRequestId: "corr-before",
            strategy: "replace_all",
            previewFingerprint: "a".repeat(64),
            currentStateFingerprint: "b".repeat(64),
            status: "completed",
            attemptCount: 2,
            maxAttempts: 3,
            startedAt: new Date("2026-07-23T11:30:00.000Z"),
            finishedAt: new Date("2026-07-23T12:30:00.000Z"),
          },
          {
            id: failedInside,
            ownerUserId,
            backupId: "backup-failed",
            actorUserId,
            correlationRequestId: "corr-failed",
            strategy: "replace_all",
            previewFingerprint: "c".repeat(64),
            currentStateFingerprint: "d".repeat(64),
            status: "failed",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: new Date("2026-07-24T08:00:00.000Z"),
            finishedAt: sharedFinishedAt,
            finalErrorCode: "ERR_FAILED",
          },
          {
            id: indeterminateInside,
            ownerUserId,
            backupId: "backup-indeterminate",
            actorUserId,
            correlationRequestId: "corr-indeterminate",
            strategy: "replace_all",
            previewFingerprint: "e".repeat(64),
            currentStateFingerprint: "f".repeat(64),
            status: "indeterminate",
            attemptCount: 3,
            maxAttempts: 3,
            startedAt: new Date("2026-07-24T08:30:00.000Z"),
            finishedAt: sharedFinishedAt,
            finalErrorCode: "ERR_INDETERMINATE",
          },
          {
            id: staleRestoreId,
            ownerUserId,
            backupId: "backup-stale",
            actorUserId,
            correlationRequestId: "corr-stale",
            strategy: "replace_all",
            previewFingerprint: "1".repeat(64),
            currentStateFingerprint: "2".repeat(64),
            status: "started",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: new Date("2026-07-24T11:40:00.000Z"),
            finishedAt: null,
          },
          {
            id: randomUUID(),
            ownerUserId: otherOwnerUserId,
            backupId: "backup-other-owner",
            actorUserId: otherOwnerUserId,
            correlationRequestId: "corr-other",
            strategy: "replace_all",
            previewFingerprint: "9".repeat(64),
            currentStateFingerprint: "8".repeat(64),
            status: "failed",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: new Date("2026-07-24T08:00:00.000Z"),
            finishedAt: new Date("2026-07-24T09:00:00.000Z"),
            finalErrorCode: "ERR_OTHER_OWNER",
          },
        ],
      });

      await maintenanceRunTable().createMany({
        data: [
          {
            id: staleMaintenanceId,
            ownerUserId,
            actorUserId,
            status: "running",
            staleThresholdMinutes: 30,
            evaluationTime: new Date("2026-07-24T11:00:00.000Z"),
            maintenanceFingerprint: "a".repeat(64),
            executionIdempotencyKey: `m-${randomUUID()}`,
            idempotencyFingerprint: "b".repeat(64),
            advisoryLockKey: "1",
            candidatesScanned: 0,
            candidatesReconciledIndeterminate: 0,
            finalErrorCode: null,
            startedAt: new Date("2026-07-24T11:20:00.000Z"),
            finishedAt: null,
          },
          {
            id: randomUUID(),
            ownerUserId,
            actorUserId,
            status: "failed",
            staleThresholdMinutes: 30,
            evaluationTime: new Date("2026-07-24T08:30:00.000Z"),
            maintenanceFingerprint: "c".repeat(64),
            executionIdempotencyKey: `m-${randomUUID()}`,
            idempotencyFingerprint: "d".repeat(64),
            advisoryLockKey: "2",
            candidatesScanned: 4,
            candidatesReconciledIndeterminate: 3,
            finalErrorCode: "ERR_MAINT",
            startedAt: new Date("2026-07-24T08:00:00.000Z"),
            finishedAt: new Date("2026-07-24T09:00:00.000Z"),
          },
        ],
      });

      await retentionRunTable().createMany({
        data: [
          {
            id: staleRetentionId,
            ownerUserId,
            actorUserId,
            status: "running",
            policyVersion: "m13f-v1",
            batchLimit: 20,
            evaluationTime: new Date("2026-07-24T11:00:00.000Z"),
            retentionFingerprint: "a".repeat(64),
            executionIdempotencyKey: `r-${randomUUID()}`,
            idempotencyFingerprint: "b".repeat(64),
            advisoryLockKey: "3",
            candidateRestoreRunCount: 0,
            candidateMaintenanceRunCount: 0,
            deletedRestoreRunCount: 0,
            deletedMaintenanceRunCount: 0,
            finalErrorCode: null,
            startedAt: new Date("2026-07-24T11:20:00.000Z"),
            finishedAt: null,
          },
          {
            id: randomUUID(),
            ownerUserId,
            actorUserId,
            status: "failed",
            policyVersion: "m13f-v1",
            batchLimit: 20,
            evaluationTime: new Date("2026-07-24T08:30:00.000Z"),
            retentionFingerprint: "c".repeat(64),
            executionIdempotencyKey: `r-${randomUUID()}`,
            idempotencyFingerprint: "d".repeat(64),
            advisoryLockKey: "4",
            candidateRestoreRunCount: 1,
            candidateMaintenanceRunCount: 1,
            deletedRestoreRunCount: 5,
            deletedMaintenanceRunCount: 6,
            finalErrorCode: "ERR_RETENTION",
            startedAt: new Date("2026-07-24T08:00:00.000Z"),
            finishedAt: new Date("2026-07-24T09:00:00.000Z"),
          },
        ],
      });

      const beforeCounts = await Promise.all([
        (prisma as unknown as { opsBackupRestoreRun: { count(args: { where: Record<string, unknown> }): Promise<number> } }).opsBackupRestoreRun.count({ where: { ownerUserId } }),
        (prisma as unknown as { opsBackupRestoreMaintenanceRun: { count(args: { where: Record<string, unknown> }): Promise<number> } }).opsBackupRestoreMaintenanceRun.count({ where: { ownerUserId } }),
        (prisma as unknown as { opsBackupRestoreRetentionRun: { count(args: { where: Record<string, unknown> }): Promise<number> } }).opsBackupRestoreRetentionRun.count({ where: { ownerUserId } }),
        prisma.auditLog.count({ where: { actorUserId: ownerUserId } }),
      ]);

      const beforeRows = {
        restore: await restoreRunTable().findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
        maintenance: await maintenanceRunTable().findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
        retention: await retentionRunTable().findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
      };

      const observability = await buildRestoreGovernanceObservability({
        ownerUserId,
        requestId: "req-observability",
        window: "24h",
        recentLimit: 2,
      });

      const health = await buildRestoreGovernanceHealth({
        ownerUserId,
        requestId: "req-health",
      });

      const startedInWindowCount = await (prisma as unknown as {
        opsBackupRestoreRun: {
          count(args: { where: Record<string, unknown> }): Promise<number>;
        };
      }).opsBackupRestoreRun.count({
        where: {
          ownerUserId,
          startedAt: { gte: windowStart, lt: new Date("2026-07-24T12:00:00.000Z") },
        },
      });

      expect(observability.windowMetrics.restore.restoreRunsStarted).toBe(startedInWindowCount);
      expect(observability.windowMetrics.restore.restoreRunsFailed).toBe(1);
      expect(observability.windowMetrics.restore.restoreRunsIndeterminate).toBe(1);

      const terminalDenominator =
        observability.windowMetrics.restore.restoreRunsCompleted +
        observability.windowMetrics.restore.restoreRunsFailed +
        observability.windowMetrics.restore.restoreRunsIndeterminate;

      if (terminalDenominator === 0) {
        expect(observability.windowMetrics.restore.restoreSuccessRate).toBeNull();
      } else {
        const expectedRate = Math.round((observability.windowMetrics.restore.restoreRunsCompleted / terminalDenominator) * 10000) / 10000;
        expect(observability.windowMetrics.restore.restoreSuccessRate).toBe(expectedRate);
      }
      expect(observability.currentState.staleRestoreRuns).toBe(1);
      expect(observability.currentState.staleMaintenanceRuns).toBe(1);
      expect(observability.currentState.staleRetentionRuns).toBe(1);
      expect(observability.windowMetrics.maintenance.candidatesScanned).toBe(4);
      expect(observability.windowMetrics.maintenance.candidatesReconciledIndeterminate).toBe(3);
      expect(observability.windowMetrics.retention.restoreRunsDeleted).toBe(5);
      expect(observability.windowMetrics.retention.maintenanceRunsDeleted).toBe(6);
      expect(observability.timeline).toHaveLength(24);
      expect(observability.timeline[0]?.bucketStart).toBe(windowStart.toISOString());
      expect(observability.recentFailures).toHaveLength(2);
      expect(observability.recentFailures[0]?.runType).toBe("maintenance");
      expect(observability.recentFailures[1]?.runType).toBe("restore");

      const serialized = JSON.stringify(observability);
      expect(serialized.includes("executionIdempotencyKey")).toBe(false);
      expect(serialized.includes("retentionFingerprint")).toBe(false);
      expect(serialized.includes("idempotencyFingerprint")).toBe(false);
      expect(serialized.includes("previewFingerprint")).toBe(false);
      expect(serialized.includes("currentStateFingerprint")).toBe(false);
      expect(serialized.includes("advisoryLockKey")).toBe(false);
      expect(serialized.includes("storagePath")).toBe(false);

      expect(health.state).toBe("degraded");
      expect(health.reasons).toEqual([
        "STALE_MAINTENANCE_RUNS",
        "STALE_RETENTION_RUNS",
        "STALE_RESTORE_RUNS",
        "RECENT_FAILURE_ATTENTION",
      ]);

      const observability7d = await buildRestoreGovernanceObservability({
        ownerUserId,
        requestId: "req-observability-7d",
        window: "7d",
        recentLimit: 2,
      });
      expect(observability7d.currentState).toEqual(observability.currentState);

      const afterCounts = await Promise.all([
        (prisma as unknown as { opsBackupRestoreRun: { count(args: { where: Record<string, unknown> }): Promise<number> } }).opsBackupRestoreRun.count({ where: { ownerUserId } }),
        (prisma as unknown as { opsBackupRestoreMaintenanceRun: { count(args: { where: Record<string, unknown> }): Promise<number> } }).opsBackupRestoreMaintenanceRun.count({ where: { ownerUserId } }),
        (prisma as unknown as { opsBackupRestoreRetentionRun: { count(args: { where: Record<string, unknown> }): Promise<number> } }).opsBackupRestoreRetentionRun.count({ where: { ownerUserId } }),
        prisma.auditLog.count({ where: { actorUserId: ownerUserId } }),
      ]);

      const afterRows = {
        restore: await restoreRunTable().findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
        maintenance: await maintenanceRunTable().findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
        retention: await retentionRunTable().findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
      };

      expect(afterCounts).toEqual(beforeCounts);
      expect(afterRows).toEqual(beforeRows);
    } finally {
      await restoreRunTable().deleteMany({ where: { ownerUserId } });
      await restoreRunTable().deleteMany({ where: { ownerUserId: otherOwnerUserId } });
      await maintenanceRunTable().deleteMany({ where: { ownerUserId } });
      await retentionRunTable().deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });
});
