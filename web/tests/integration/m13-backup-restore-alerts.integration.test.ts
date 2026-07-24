import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildRestoreGovernanceAlerts } from "@/lib/backup-v13-restore-observability";
import { prisma } from "@/lib/prisma";

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("m13 restore alerts integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds active-only alerts with threshold evidence and keeps DB mutation-free", async () => {
    const ownerUserId = randomUUID();
    const otherOwnerUserId = randomUUID();

    const beforeCounts = await Promise.all([
      prisma.opsBackupRestoreRun.count({ where: { ownerUserId } }),
      prisma.opsBackupRestoreMaintenanceRun.count({ where: { ownerUserId } }),
      prisma.opsBackupRestoreRetentionRun.count({ where: { ownerUserId } }),
    ]);

    try {
      await prisma.opsBackupRestoreRun.createMany({
        data: [
          {
            id: randomUUID(),
            ownerUserId,
            backupId: "backup-1",
            actorUserId: ownerUserId,
            correlationRequestId: "corr-1",
            strategy: "replace_all",
            previewFingerprint: "a".repeat(64),
            currentStateFingerprint: "b".repeat(64),
            status: "completed",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: new Date("2026-07-24T09:00:00.000Z"),
            finishedAt: new Date("2026-07-24T09:05:00.000Z"),
          },
          {
            id: randomUUID(),
            ownerUserId,
            backupId: "backup-2",
            actorUserId: ownerUserId,
            correlationRequestId: "corr-2",
            strategy: "replace_all",
            previewFingerprint: "c".repeat(64),
            currentStateFingerprint: "d".repeat(64),
            status: "failed",
            attemptCount: 2,
            maxAttempts: 3,
            startedAt: new Date("2026-07-24T09:10:00.000Z"),
            finishedAt: new Date("2026-07-24T09:20:00.000Z"),
            finalErrorCode: "ERR_FAIL_A",
          },
          {
            id: randomUUID(),
            ownerUserId,
            backupId: "backup-3",
            actorUserId: ownerUserId,
            correlationRequestId: "corr-3",
            strategy: "replace_all",
            previewFingerprint: "e".repeat(64),
            currentStateFingerprint: "f".repeat(64),
            status: "indeterminate",
            attemptCount: 3,
            maxAttempts: 3,
            startedAt: new Date("2026-07-24T09:30:00.000Z"),
            finishedAt: new Date("2026-07-24T09:40:00.000Z"),
            finalErrorCode: "ERR_INDET_A",
          },
          {
            id: randomUUID(),
            ownerUserId,
            backupId: "backup-4",
            actorUserId: ownerUserId,
            correlationRequestId: "corr-4",
            strategy: "replace_all",
            previewFingerprint: "1".repeat(64),
            currentStateFingerprint: "2".repeat(64),
            status: "started",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: new Date("2026-07-24T11:30:00.000Z"),
            finishedAt: null,
          },
          {
            id: randomUUID(),
            ownerUserId: otherOwnerUserId,
            backupId: "backup-other",
            actorUserId: otherOwnerUserId,
            correlationRequestId: "corr-other",
            strategy: "replace_all",
            previewFingerprint: "3".repeat(64),
            currentStateFingerprint: "4".repeat(64),
            status: "started",
            attemptCount: 1,
            maxAttempts: 3,
            startedAt: new Date("2026-07-24T11:20:00.000Z"),
            finishedAt: null,
          },
        ],
      });

      await prisma.opsBackupRestoreMaintenanceRun.createMany({
        data: [
          {
            id: randomUUID(),
            ownerUserId,
            actorUserId: ownerUserId,
            status: "running",
            staleThresholdMinutes: 30,
            evaluationTime: new Date("2026-07-24T11:00:00.000Z"),
            maintenanceFingerprint: "a".repeat(64),
            executionIdempotencyKey: `maint-${randomUUID()}`,
            idempotencyFingerprint: "b".repeat(64),
            advisoryLockKey: "1",
            candidatesScanned: 0,
            candidatesReconciledIndeterminate: 0,
            finalErrorCode: null,
            startedAt: new Date("2026-07-24T11:20:00.000Z"),
            finishedAt: null,
          },
        ],
      });

      await prisma.opsBackupRestoreRetentionRun.createMany({
        data: [
          {
            id: randomUUID(),
            ownerUserId,
            actorUserId: ownerUserId,
            status: "running",
            policyVersion: "m13f-v1",
            batchLimit: 20,
            evaluationTime: new Date("2026-07-24T11:00:00.000Z"),
            retentionFingerprint: "c".repeat(64),
            executionIdempotencyKey: `ret-${randomUUID()}`,
            idempotencyFingerprint: "d".repeat(64),
            advisoryLockKey: "2",
            deletedRestoreRunCount: 0,
            deletedMaintenanceRunCount: 0,
            finalErrorCode: null,
            startedAt: new Date("2026-07-24T11:20:00.000Z"),
            finishedAt: null,
          },
        ],
      });

      const response = await buildRestoreGovernanceAlerts({
        ownerUserId,
        requestId: "req-alerts-1",
        window: "24h",
      });

      expect(response.window).toBe("24h");
      expect(response.state).toBe("degraded");
      expect(response.alerts.length).toBeGreaterThan(0);
      expect(response.alerts.some((item) => "triggered" in (item as unknown as Record<string, unknown>))).toBe(false);

      const staleGovernance = response.alerts.find((item) => item.code === "STALE_GOVERNANCE_RUNS");
      expect(staleGovernance).toBeDefined();
      if (staleGovernance && staleGovernance.code === "STALE_GOVERNANCE_RUNS") {
        expect(staleGovernance.evidence.staleMaintenanceRuns).toBe(1);
        expect(staleGovernance.evidence.staleRetentionRuns).toBe(1);
        expect(staleGovernance.evidence.totalStaleGovernanceRuns).toBe(2);
      }

      const afterCounts = await Promise.all([
        prisma.opsBackupRestoreRun.count({ where: { ownerUserId } }),
        prisma.opsBackupRestoreMaintenanceRun.count({ where: { ownerUserId } }),
        prisma.opsBackupRestoreRetentionRun.count({ where: { ownerUserId } }),
      ]);

      expect(afterCounts[0]).toBe(beforeCounts[0] + 4);
      expect(afterCounts[1]).toBe(beforeCounts[1] + 1);
      expect(afterCounts[2]).toBe(beforeCounts[2] + 1);
    } finally {
      await prisma.opsBackupRestoreRetentionRun.deleteMany({ where: { ownerUserId: { in: [ownerUserId, otherOwnerUserId] } } });
      await prisma.opsBackupRestoreMaintenanceRun.deleteMany({ where: { ownerUserId: { in: [ownerUserId, otherOwnerUserId] } } });
      await prisma.opsBackupRestoreRun.deleteMany({ where: { ownerUserId: { in: [ownerUserId, otherOwnerUserId] } } });
    }
  });
});
