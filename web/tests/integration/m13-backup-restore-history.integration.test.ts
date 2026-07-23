import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { executeBackupRestoreWithHistory, listBackupRestoreRunsForUser } from "@/lib/backup-v13-restore-run-history";
import type { BackupRestoreRequest, BackupV13Artifact } from "@/lib/contracts";
import {
  BACKUP_CHECKSUM_ALGORITHM,
  BACKUP_V13_CANONICAL_VERSION,
  BACKUP_V13_SCHEMA_VERSION,
  computeArtifactChecksumHex,
} from "@/lib/backup-v13-artifact";
import { getBackupRestorePreviewForUser } from "@/lib/backup-v13-restore-preview";
import { prisma } from "@/lib/prisma";

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

type OpsBackupRestoreRunDelegate = {
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
};

function restoreRunTable(): OpsBackupRestoreRunDelegate {
  return (prisma as unknown as { opsBackupRestoreRun: OpsBackupRestoreRunDelegate }).opsBackupRestoreRun;
}

suite("m13 backup restore history integration", () => {
  afterEach(() => {
    // no-op
  });

  it("persists completed run and lists safe history payload", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();
    const artifact = createSingleClientArtifact({ ownerUserId, backupId, clientId, name: "History Success" });

    try {
      await prisma.opsBackupSnapshot.create({
        data: {
          id: backupId,
          ownerUserId,
          label: artifact.label,
          snapshotJson: artifact,
          checksum: artifact.checksum!,
          checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
          schemaVersion: BACKUP_V13_SCHEMA_VERSION,
          createdByUserId: ownerUserId,
        },
      });

      const preview = await getBackupRestorePreviewForUser(ownerUserId, backupId);
      const request: BackupRestoreRequest = {
        previewFingerprint: preview.previewFingerprint,
        currentStateFingerprint: preview.currentStateFingerprint,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      };

      const response = await executeBackupRestoreWithHistory({
        ownerUserId,
        actorUserId: ownerUserId,
        backupId,
        request,
        correlationRequestId: "req-history-success",
      });

      expect(response.status).toBe("completed");

      const page = await listBackupRestoreRunsForUser({
        ownerUserId,
        backupId,
        limit: 20,
      });

      expect(page.data.length).toBeGreaterThanOrEqual(1);
      const run = page.data[0];
      expect(run?.status).toBe("completed");
      expect(run?.previewFingerprintPrefix).toBe(preview.previewFingerprint.slice(0, 12));
      expect((run as unknown as { previewFingerprint?: string })?.previewFingerprint).toBeUndefined();
    } finally {
      await restoreRunTable().deleteMany({ where: { ownerUserId } });
      await prisma.imageAnalysisReview.deleteMany({ where: { reviewedByUserId: ownerUserId } });
      await prisma.analysis.deleteMany({ where: { ownerUserId } });
      await prisma.imageAnalysis.deleteMany({ where: { asset: { ownerUserId } } });
      await prisma.imageAsset.deleteMany({ where: { ownerUserId } });
      await prisma.client.deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });

  it("persists failed run for missing backup", async () => {
    const ownerUserId = randomUUID();
    const backupId = `missing-${Date.now().toString(36)}`;

    await expect(
      executeBackupRestoreWithHistory({
        ownerUserId,
        actorUserId: ownerUserId,
        backupId,
        request: {
          previewFingerprint: "a".repeat(64),
          currentStateFingerprint: "b".repeat(64),
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        },
        correlationRequestId: "req-history-missing",
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_NOT_FOUND", httpStatus: 404 });

    const page = await listBackupRestoreRunsForUser({
      ownerUserId,
      backupId,
      limit: 20,
    });

    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.status).toBe("failed");
    expect(page.data[0]?.finalErrorCode).toBe("BACKUP_RESTORE_NOT_FOUND");

    await restoreRunTable().deleteMany({ where: { ownerUserId } });
  });

  it("retains history after backup snapshot deletion", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();
    const artifact = createSingleClientArtifact({ ownerUserId, backupId, clientId, name: "History Retention" });

    try {
      await prisma.opsBackupSnapshot.create({
        data: {
          id: backupId,
          ownerUserId,
          label: artifact.label,
          snapshotJson: artifact,
          checksum: artifact.checksum!,
          checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
          schemaVersion: BACKUP_V13_SCHEMA_VERSION,
          createdByUserId: ownerUserId,
        },
      });

      const preview = await getBackupRestorePreviewForUser(ownerUserId, backupId);
      await executeBackupRestoreWithHistory({
        ownerUserId,
        actorUserId: ownerUserId,
        backupId,
        request: {
          previewFingerprint: preview.previewFingerprint,
          currentStateFingerprint: preview.currentStateFingerprint,
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        },
        correlationRequestId: "req-history-retain",
      });

      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId, id: backupId } });

      const page = await listBackupRestoreRunsForUser({ ownerUserId, backupId, limit: 20 });
      expect(page.data.length).toBeGreaterThanOrEqual(1);
      expect(page.data[0]?.backupId).toBe(backupId);
    } finally {
      await restoreRunTable().deleteMany({ where: { ownerUserId } });
      await prisma.imageAnalysisReview.deleteMany({ where: { reviewedByUserId: ownerUserId } });
      await prisma.analysis.deleteMany({ where: { ownerUserId } });
      await prisma.imageAnalysis.deleteMany({ where: { asset: { ownerUserId } } });
      await prisma.imageAsset.deleteMany({ where: { ownerUserId } });
      await prisma.client.deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });

  it("returns stable cursor ordering for same startedAt ties", async () => {
    const ownerUserId = randomUUID();
    const startedAt = new Date("2026-07-23T10:00:00.000Z");

    await restoreRunTable().createMany({
      data: [
        {
          id: "run-z",
          ownerUserId,
          backupId: "backup-x",
          actorUserId: ownerUserId,
          correlationRequestId: "corr-z",
          strategy: "replace_all",
          previewFingerprint: "a".repeat(64),
          currentStateFingerprint: "b".repeat(64),
          status: "started",
          attemptCount: 1,
          maxAttempts: 3,
          startedAt,
        },
        {
          id: "run-a",
          ownerUserId,
          backupId: "backup-y",
          actorUserId: ownerUserId,
          correlationRequestId: "corr-a",
          strategy: "replace_all",
          previewFingerprint: "c".repeat(64),
          currentStateFingerprint: "d".repeat(64),
          status: "started",
          attemptCount: 1,
          maxAttempts: 3,
          startedAt,
        },
      ],
    });

    try {
      const firstPage = await listBackupRestoreRunsForUser({ ownerUserId, limit: 1 });
      expect(firstPage.data).toHaveLength(1);
      expect(firstPage.pageInfo.hasNextPage).toBe(true);
      const secondPage = await listBackupRestoreRunsForUser({
        ownerUserId,
        limit: 1,
        cursor: firstPage.pageInfo.nextCursor,
      });
      expect(secondPage.data).toHaveLength(1);
      expect(firstPage.data[0]?.id).not.toBe(secondPage.data[0]?.id);
    } finally {
      await restoreRunTable().deleteMany({ where: { ownerUserId } });
    }
  });

  it("enforces owner isolation and rejects invalid filters", async () => {
    const ownerUserId = randomUUID();
    const otherOwnerUserId = randomUUID();

    await restoreRunTable().createMany({
      data: [
        {
          id: "iso-1",
          ownerUserId,
          backupId: "backup-1",
          actorUserId: ownerUserId,
          correlationRequestId: "corr-1",
          strategy: "replace_all",
          previewFingerprint: "a".repeat(64),
          currentStateFingerprint: "b".repeat(64),
          status: "started",
          attemptCount: 1,
          maxAttempts: 3,
          startedAt: new Date("2026-07-23T09:00:00.000Z"),
        },
        {
          id: "iso-2",
          ownerUserId: otherOwnerUserId,
          backupId: "backup-2",
          actorUserId: otherOwnerUserId,
          correlationRequestId: "corr-2",
          strategy: "replace_all",
          previewFingerprint: "c".repeat(64),
          currentStateFingerprint: "d".repeat(64),
          status: "started",
          attemptCount: 1,
          maxAttempts: 3,
          startedAt: new Date("2026-07-23T09:00:00.000Z"),
        },
      ],
    });

    try {
      const page = await listBackupRestoreRunsForUser({ ownerUserId, limit: 20 });
      expect(page.data).toHaveLength(1);
      expect(page.data[0]?.id).toBe("iso-1");

      await expect(
        listBackupRestoreRunsForUser({ ownerUserId, from: "2026-07-23T10:00:00.000Z", to: "2026-07-23T09:00:00.000Z" }),
      ).rejects.toMatchObject({ code: "RESTORE_HISTORY_TIME_RANGE_INVALID", httpStatus: 400 });
    } finally {
      await restoreRunTable().deleteMany({ where: { ownerUserId } });
      await restoreRunTable().deleteMany({ where: { ownerUserId: otherOwnerUserId } });
    }
  });
});

function createSingleClientArtifact(input: {
  ownerUserId: string;
  backupId: string;
  clientId: string;
  name: string;
}): BackupV13Artifact {
  const artifact: BackupV13Artifact = {
    schemaVersion: BACKUP_V13_SCHEMA_VERSION,
    canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
    checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
    checksum: null,
    backupId: input.backupId,
    ownerUserId: input.ownerUserId,
    createdByUserId: input.ownerUserId,
    label: input.name,
    createdAt: "2026-07-22T00:00:00.000Z",
    summarySnapshot: {
      clientsCount: 1,
      consultationsCount: 0,
      appointmentsCount: 0,
      notificationsCount: 0,
      workspacesCount: 0,
    },
    counts: { clients: 1, analyses: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
    limits: {
      maxArtifactBytes: 8 * 1024 * 1024,
      maxSectionBytes: 2 * 1024 * 1024,
      maxRowsPerSection: {
        clients: 2000,
        analyses: 10000,
        imageAssets: 10000,
        imageAnalyses: 10000,
        imageAnalysisReviews: 20000,
      },
    },
    sections: {
      clients: [
        {
          id: input.clientId,
          name: input.name,
          ownerUserId: input.ownerUserId,
          createdAt: "2026-07-22T00:00:00.000Z",
          updatedAt: "2026-07-22T00:00:00.000Z",
        },
      ],
      analyses: [],
      imageAssets: [],
      imageAnalyses: [],
      imageAnalysisReviews: [],
    },
  };

  artifact.checksum = computeArtifactChecksumHex(artifact);
  return artifact;
}
