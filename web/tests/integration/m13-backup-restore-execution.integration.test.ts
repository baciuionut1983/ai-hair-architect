import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { BACKUP_CHECKSUM_ALGORITHM, BACKUP_V13_CANONICAL_VERSION, BACKUP_V13_SCHEMA_VERSION, computeArtifactChecksumHex } from "@/lib/backup-v13-artifact";
import { executeBackupRestoreForUser, __testUtils as restoreTestUtils } from "@/lib/backup-v13-restore-execution";
import { getBackupRestorePreviewForUser } from "@/lib/backup-v13-restore-preview";
import type { BackupRestoreRequest, BackupV13Artifact } from "@/lib/contracts";
import { prisma } from "@/lib/prisma";

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("m13 backup restore execution integration", () => {
  afterEach(() => {
    restoreTestUtils.resetHooks();
  });

  it("restores successfully, writes atomic success audit, and preserves external files", async () => {
    const ownerUserId = randomUUID();
    const otherOwnerUserId = randomUUID();
    const clientId = randomUUID();
    const assetId = randomUUID();
    const imageAnalysisId = randomUUID();
    const analysisId = randomUUID();
    const reviewId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const storageDir = path.join(process.cwd(), ".storage", "images", ownerUserId, assetId);
    const storagePath = path.join(storageDir, "photo.jpg");

    await fs.promises.mkdir(storageDir, { recursive: true });
    await fs.promises.writeFile(storagePath, Buffer.from("keep-me"));

    try {
      const artifact: BackupV13Artifact = {
        schemaVersion: BACKUP_V13_SCHEMA_VERSION,
        canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
        checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
        checksum: null,
        backupId,
        ownerUserId,
        createdByUserId: ownerUserId,
        label: "restore-checkpoint",
        createdAt: "2026-07-22T00:00:00.000Z",
        summarySnapshot: {
          clientsCount: 1,
          consultationsCount: 0,
          appointmentsCount: 0,
          notificationsCount: 0,
          workspacesCount: 0,
        },
        counts: {
          clients: 1,
          analyses: 1,
          imageAssets: 1,
          imageAnalyses: 1,
          imageAnalysisReviews: 1,
        },
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
              id: clientId,
              name: "Restored Client",
              ownerUserId,
              createdAt: "2026-07-22T00:00:00.000Z",
              updatedAt: "2026-07-22T00:00:00.000Z",
            },
          ],
          analyses: [
            {
              id: analysisId,
              clientId,
              ownerUserId,
              goal: "refresh",
              hairType: "medium",
              density: "medium",
              porosity: "medium",
              phase: "ready",
              clarificationRound: 0,
              confidenceScore: 0.97,
              uncertaintyReasons: [],
              followUpQuestions: [],
              recommendations: ["restore"],
              safetyNotes: ["safe"],
              faceShape: null,
              headShape: null,
              hairLength: null,
              hairTexture: null,
              hairCondition: null,
              growthPattern: null,
              targetShape: null,
              technicalCutPlan: null,
              clarificationAnswers: [],
              imageAssetId: assetId,
              imageAnalysisId,
              m8DraftCreatedAt: null,
              m8FinalizedAt: null,
              createdAt: "2026-07-22T00:00:00.000Z",
              updatedAt: "2026-07-22T00:00:00.000Z",
            },
          ],
          imageAssets: [
            {
              id: assetId,
              fileName: "photo.jpg",
              mimeType: "image/jpeg",
              sizeBytes: 7,
              ownerUserId,
              clientId,
              storagePath,
              exifStripped: true,
              normalizedOrientation: 1,
              uploadedAt: "2026-07-22T00:00:00.000Z",
              deletedAt: null,
              retentionDeletesAt: null,
              createdAt: "2026-07-22T00:00:00.000Z",
              updatedAt: "2026-07-22T00:00:00.000Z",
            },
          ],
          imageAnalyses: [
            {
              id: imageAnalysisId,
              assetId,
              status: "ready",
              providerName: "manual-only",
              modelVersion: "mock-1.0",
              analysisPayload: {},
              confidences: {},
              unknownFields: [],
              warnings: [],
              limitations: [],
              consentTimestamp: "2026-07-22T00:00:00.000Z",
              deletedAt: null,
              retentionDeletesAt: null,
              createdAt: "2026-07-22T00:00:00.000Z",
              updatedAt: "2026-07-22T00:00:00.000Z",
            },
          ],
          imageAnalysisReviews: [
            {
              id: reviewId,
              analysisId: imageAnalysisId,
              reviewedByUserId: ownerUserId,
              manualCorrections: {},
              confirmationTimestamp: null,
              notes: null,
              createdAt: "2026-07-22T00:00:00.000Z",
              updatedAt: "2026-07-22T00:00:00.000Z",
            },
          ],
        },
      };

      artifact.checksum = computeArtifactChecksumHex(artifact);

      await prisma.opsBackupSnapshot.create({
        data: {
          id: backupId,
          ownerUserId,
          label: artifact.label,
          snapshotJson: artifact,
          checksum: artifact.checksum,
          checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
          schemaVersion: BACKUP_V13_SCHEMA_VERSION,
          createdByUserId: ownerUserId,
        },
      });

      await prisma.client.create({
        data: {
          id: randomUUID(),
          ownerUserId,
          name: "Current Client",
          createdAt: new Date("2026-07-23T00:00:00.000Z"),
          updatedAt: new Date("2026-07-23T00:00:00.000Z"),
        },
      });

      await prisma.client.create({
        data: {
          id: randomUUID(),
          ownerUserId: otherOwnerUserId,
          name: "Other Owner Client",
          createdAt: new Date("2026-07-23T00:00:00.000Z"),
          updatedAt: new Date("2026-07-23T00:00:00.000Z"),
        },
      });

      const preview = await getBackupRestorePreviewForUser(ownerUserId, backupId);
      const request: BackupRestoreRequest = {
        previewFingerprint: preview.previewFingerprint,
        currentStateFingerprint: preview.currentStateFingerprint,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      };

      const beforeSnapshot = await snapshotOwnerState(ownerUserId);
      const result = await executeBackupRestoreForUser(ownerUserId, backupId, request);
      const afterSnapshot = await snapshotOwnerState(ownerUserId);

      expect(result.status).toBe("completed");
      expect(result.strategy).toBe("replace_all");
      expect(result.backupStateFingerprint).toBe(result.restoredStateFingerprint);
      expect(result.backupStateFingerprint).toBe(preview.backupStateFingerprint);
      expect(result.previousCurrentStateFingerprint).toBe(preview.currentStateFingerprint);
      expect(result.deletedCounts.clients).toBeGreaterThanOrEqual(1);
      expect(result.restoredCounts).toEqual({
        clients: 1,
        analyses: 1,
        imageAssets: 1,
        imageAnalyses: 1,
        imageAnalysisReviews: 1,
      });

      expect(afterSnapshot.clients).toHaveLength(1);
      expect(afterSnapshot.clients[0]?.name).toBe("Restored Client");
      expect(afterSnapshot.analyses).toHaveLength(1);
      expect(afterSnapshot.imageAssets).toHaveLength(1);
      expect(afterSnapshot.imageAnalyses).toHaveLength(1);
      expect(afterSnapshot.imageAnalysisReviews).toHaveLength(1);
      expect(afterSnapshot.backups).toEqual(beforeSnapshot.backups);
      expect(afterSnapshot.auditLogs.length).toBe(beforeSnapshot.auditLogs.length + 1);
      expect(afterSnapshot.auditLogs.at(-1)?.action).toBe("ops.backup.restore.completed");
      expect(fs.existsSync(storagePath)).toBe(true);
    } finally {
      await prisma.imageAnalysisReview.deleteMany({ where: { reviewedByUserId: ownerUserId } });
      await prisma.analysis.deleteMany({ where: { ownerUserId } });
      await prisma.imageAnalysis.deleteMany({ where: { asset: { ownerUserId } } });
      await prisma.imageAsset.deleteMany({ where: { ownerUserId } });
      await prisma.client.deleteMany({ where: { ownerUserId } });
      await prisma.client.deleteMany({ where: { ownerUserId: otherOwnerUserId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId, action: "ops.backup.restore.completed" } });
      await fs.promises.rm(path.join(process.cwd(), ".storage", "images", ownerUserId), { recursive: true, force: true });
    }
  });

  it("rolls back after delete hook failure and leaves business, backup, and audit snapshots unchanged", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();

    const artifact: BackupV13Artifact = {
      schemaVersion: BACKUP_V13_SCHEMA_VERSION,
      canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
      checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
      checksum: null,
      backupId,
      ownerUserId,
      createdByUserId: ownerUserId,
      label: "rollback",
      createdAt: "2026-07-22T00:00:00.000Z",
      summarySnapshot: { clientsCount: 1, consultationsCount: 0, appointmentsCount: 0, notificationsCount: 0, workspacesCount: 0 },
      counts: { clients: 1, analyses: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
      limits: {
        maxArtifactBytes: 8 * 1024 * 1024,
        maxSectionBytes: 2 * 1024 * 1024,
        maxRowsPerSection: { clients: 2000, analyses: 10000, imageAssets: 10000, imageAnalyses: 10000, imageAnalysisReviews: 20000 },
      },
      sections: {
        clients: [{ id: clientId, name: "Rollback Client", ownerUserId, createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z" }],
        analyses: [],
        imageAssets: [],
        imageAnalyses: [],
        imageAnalysisReviews: [],
      },
    };
    artifact.checksum = computeArtifactChecksumHex(artifact);

    try {
      await prisma.client.create({ data: { id: randomUUID(), ownerUserId, name: "Current", createdAt: new Date(), updatedAt: new Date() } });
      await prisma.opsBackupSnapshot.create({
        data: {
          id: backupId,
          ownerUserId,
          label: artifact.label,
          snapshotJson: artifact,
          checksum: artifact.checksum,
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

      const before = await snapshotOwnerState(ownerUserId);
      restoreTestUtils.setAfterDeletePhaseHook(() => {
        throw new Error("delete-failed");
      });

      await expect(executeBackupRestoreForUser(ownerUserId, backupId, request)).rejects.toThrow("delete-failed");

      const after = await snapshotOwnerState(ownerUserId);
      expect(after).toEqual(before);
    } finally {
      await prisma.client.deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });

  it("rolls back on postcondition mismatch", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();

    const artifact: BackupV13Artifact = {
      schemaVersion: BACKUP_V13_SCHEMA_VERSION,
      canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
      checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
      checksum: null,
      backupId,
      ownerUserId,
      createdByUserId: ownerUserId,
      label: "postcondition",
      createdAt: "2026-07-22T00:00:00.000Z",
      summarySnapshot: { clientsCount: 1, consultationsCount: 0, appointmentsCount: 0, notificationsCount: 0, workspacesCount: 0 },
      counts: { clients: 1, analyses: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
      limits: {
        maxArtifactBytes: 8 * 1024 * 1024,
        maxSectionBytes: 2 * 1024 * 1024,
        maxRowsPerSection: { clients: 2000, analyses: 10000, imageAssets: 10000, imageAnalyses: 10000, imageAnalysisReviews: 20000 },
      },
      sections: {
        clients: [{ id: clientId, name: "Postcondition Client", ownerUserId, createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z" }],
        analyses: [],
        imageAssets: [],
        imageAnalyses: [],
        imageAnalysisReviews: [],
      },
    };
    artifact.checksum = computeArtifactChecksumHex(artifact);

    try {
      await prisma.opsBackupSnapshot.create({
        data: {
          id: backupId,
          ownerUserId,
          label: artifact.label,
          snapshotJson: artifact,
          checksum: artifact.checksum,
          checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
          schemaVersion: BACKUP_V13_SCHEMA_VERSION,
          createdByUserId: ownerUserId,
        },
      });

      const preview = await getBackupRestorePreviewForUser(ownerUserId, backupId);
      const before = await snapshotOwnerState(ownerUserId);
      restoreTestUtils.setForcePostconditionMismatch(true);

      await expect(
        executeBackupRestoreForUser(ownerUserId, backupId, {
          previewFingerprint: preview.previewFingerprint,
          currentStateFingerprint: preview.currentStateFingerprint,
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      ).rejects.toMatchObject({ code: "BACKUP_RESTORE_POSTCONDITION_FAILED", httpStatus: 500 });

      const after = await snapshotOwnerState(ownerUserId);
      expect(after).toEqual(before);
    } finally {
      await prisma.client.deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });

  it("retries serialization failure and succeeds within three attempts", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();

    const artifact: BackupV13Artifact = {
      schemaVersion: BACKUP_V13_SCHEMA_VERSION,
      canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
      checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
      checksum: null,
      backupId,
      ownerUserId,
      createdByUserId: ownerUserId,
      label: "retry",
      createdAt: "2026-07-22T00:00:00.000Z",
      summarySnapshot: { clientsCount: 1, consultationsCount: 0, appointmentsCount: 0, notificationsCount: 0, workspacesCount: 0 },
      counts: { clients: 1, analyses: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
      limits: {
        maxArtifactBytes: 8 * 1024 * 1024,
        maxSectionBytes: 2 * 1024 * 1024,
        maxRowsPerSection: { clients: 2000, analyses: 10000, imageAssets: 10000, imageAnalyses: 10000, imageAnalysisReviews: 20000 },
      },
      sections: {
        clients: [{ id: clientId, name: "Retry Client", ownerUserId, createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z" }],
        analyses: [],
        imageAssets: [],
        imageAnalyses: [],
        imageAnalysisReviews: [],
      },
    };
    artifact.checksum = computeArtifactChecksumHex(artifact);

    try {
      await prisma.opsBackupSnapshot.create({
        data: {
          id: backupId,
          ownerUserId,
          label: artifact.label,
          snapshotJson: artifact,
          checksum: artifact.checksum,
          checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
          schemaVersion: BACKUP_V13_SCHEMA_VERSION,
          createdByUserId: ownerUserId,
        },
      });

      const preview = await getBackupRestorePreviewForUser(ownerUserId, backupId);
      restoreTestUtils.setRetryableFailuresRemaining(1);

      const response = await executeBackupRestoreForUser(ownerUserId, backupId, {
        previewFingerprint: preview.previewFingerprint,
        currentStateFingerprint: preview.currentStateFingerprint,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      });

      expect(response.status).toBe("completed");
    } finally {
      await prisma.client.deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });

  it("fails with concurrency conflict after retry exhaustion", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();

    const artifact: BackupV13Artifact = {
      schemaVersion: BACKUP_V13_SCHEMA_VERSION,
      canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
      checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
      checksum: null,
      backupId,
      ownerUserId,
      createdByUserId: ownerUserId,
      label: "retry-fail",
      createdAt: "2026-07-22T00:00:00.000Z",
      summarySnapshot: { clientsCount: 1, consultationsCount: 0, appointmentsCount: 0, notificationsCount: 0, workspacesCount: 0 },
      counts: { clients: 1, analyses: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
      limits: {
        maxArtifactBytes: 8 * 1024 * 1024,
        maxSectionBytes: 2 * 1024 * 1024,
        maxRowsPerSection: { clients: 2000, analyses: 10000, imageAssets: 10000, imageAnalyses: 10000, imageAnalysisReviews: 20000 },
      },
      sections: {
        clients: [{ id: clientId, name: "Retry Fail Client", ownerUserId, createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z" }],
        analyses: [],
        imageAssets: [],
        imageAnalyses: [],
        imageAnalysisReviews: [],
      },
    };
    artifact.checksum = computeArtifactChecksumHex(artifact);

    try {
      await prisma.opsBackupSnapshot.create({
        data: {
          id: backupId,
          ownerUserId,
          label: artifact.label,
          snapshotJson: artifact,
          checksum: artifact.checksum,
          checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
          schemaVersion: BACKUP_V13_SCHEMA_VERSION,
          createdByUserId: ownerUserId,
        },
      });

      const preview = await getBackupRestorePreviewForUser(ownerUserId, backupId);
      restoreTestUtils.setRetryableFailuresRemaining(3);

      await expect(
        executeBackupRestoreForUser(ownerUserId, backupId, {
          previewFingerprint: preview.previewFingerprint,
          currentStateFingerprint: preview.currentStateFingerprint,
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      ).rejects.toMatchObject({ code: "BACKUP_RESTORE_CONCURRENCY_CONFLICT", httpStatus: 409 });
    } finally {
      await prisma.client.deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });

  it("blocks stale current-state fingerprint after current data changes", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();
    const artifact = createSingleClientArtifact({ ownerUserId, backupId, clientId, name: "Stale Current" });

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
      await prisma.client.create({ data: { id: randomUUID(), ownerUserId, name: "Mutation", createdAt: new Date(), updatedAt: new Date() } });
      const updatedPreview = await getBackupRestorePreviewForUser(ownerUserId, backupId);

      await expect(
        executeBackupRestoreForUser(ownerUserId, backupId, {
          previewFingerprint: updatedPreview.previewFingerprint,
          currentStateFingerprint: preview.currentStateFingerprint,
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      ).rejects.toMatchObject({ code: "BACKUP_RESTORE_CURRENT_STATE_FINGERPRINT_STALE", httpStatus: 409 });
    } finally {
      await prisma.client.deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });

  it("blocks checksum mismatch artifacts", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();
    const artifact = createSingleClientArtifact({ ownerUserId, backupId, clientId, name: "Bad Checksum" });

    try {
      await prisma.opsBackupSnapshot.create({
        data: {
          id: backupId,
          ownerUserId,
          label: artifact.label,
          snapshotJson: artifact,
          checksum: "0".repeat(64),
          checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
          schemaVersion: BACKUP_V13_SCHEMA_VERSION,
          createdByUserId: ownerUserId,
        },
      });

      await expect(
        executeBackupRestoreForUser(ownerUserId, backupId, {
          previewFingerprint: "x",
          currentStateFingerprint: "y",
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      ).rejects.toMatchObject({ code: "BACKUP_RESTORE_CHECKSUM_MISMATCH", httpStatus: 422 });
    } finally {
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });

  it("blocks stale preview fingerprint", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();
    const artifact = createSingleClientArtifact({ ownerUserId, backupId, clientId, name: "Stale Preview" });

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
      await expect(
        executeBackupRestoreForUser(ownerUserId, backupId, {
          previewFingerprint: `${preview.previewFingerprint}-stale`,
          currentStateFingerprint: preview.currentStateFingerprint,
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      ).rejects.toMatchObject({ code: "BACKUP_RESTORE_PREVIEW_FINGERPRINT_STALE", httpStatus: 409 });
    } finally {
      await prisma.client.deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });

  it("blocks unsupported schema artifacts", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;

    try {
      await prisma.opsBackupSnapshot.create({
        data: {
          id: backupId,
          ownerUserId,
          label: "unsupported",
          snapshotJson: {
            schemaVersion: "m13.v2",
          },
          checksum: "legacy",
          checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
          schemaVersion: "m13.v2",
          createdByUserId: ownerUserId,
        },
      });

      await expect(
        executeBackupRestoreForUser(ownerUserId, backupId, {
          previewFingerprint: "x",
          currentStateFingerprint: "y",
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      ).rejects.toMatchObject({ code: "BACKUP_RESTORE_SCHEMA_UNSUPPORTED", httpStatus: 422 });
    } finally {
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
    }
  });

  it("blocks malformed artifacts", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;

    try {
      await prisma.opsBackupSnapshot.create({
        data: {
          id: backupId,
          ownerUserId,
          label: "malformed",
          snapshotJson: {
            schemaVersion: BACKUP_V13_SCHEMA_VERSION,
            canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
            checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
            checksum: null,
            backupId,
            ownerUserId,
            createdByUserId: ownerUserId,
            label: "malformed",
            createdAt: "2026-07-22T00:00:00.000Z",
          },
          checksum: "0".repeat(64),
          checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
          schemaVersion: BACKUP_V13_SCHEMA_VERSION,
          createdByUserId: ownerUserId,
        },
      });

      await expect(
        executeBackupRestoreForUser(ownerUserId, backupId, {
          previewFingerprint: "x",
          currentStateFingerprint: "y",
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      ).rejects.toMatchObject({ code: "BACKUP_RESTORE_ARTIFACT_INVALID", httpStatus: 422 });
    } finally {
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
    }
  });

  it("blocks artifacts with missing external files", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();
    const assetId = randomUUID();
    const storagePath = path.join(process.cwd(), ".storage", "images", ownerUserId, assetId, "missing.jpg");
    const artifact = createAssetArtifact({ ownerUserId, backupId, clientId, assetId, storagePath });

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

      await expect(
        executeBackupRestoreForUser(ownerUserId, backupId, {
          previewFingerprint: "x",
          currentStateFingerprint: "y",
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      ).rejects.toMatchObject({ code: "BACKUP_RESTORE_BLOCKED_BY_PREVIEW", httpStatus: 422 });
    } finally {
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
    }
  });

  it("blocks artifacts with unsafe external paths", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();
    const assetId = randomUUID();
    const artifact = createAssetArtifact({ ownerUserId, backupId, clientId, assetId, storagePath: path.resolve("C:/tmp/outside.jpg") });

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

      await expect(
        executeBackupRestoreForUser(ownerUserId, backupId, {
          previewFingerprint: "x",
          currentStateFingerprint: "y",
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      ).rejects.toMatchObject({ code: "BACKUP_RESTORE_BLOCKED_BY_PREVIEW", httpStatus: 422 });
    } finally {
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
    }
  });

  it("blocks artifacts with invalid reference graph", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const artifact = createSingleClientArtifact({ ownerUserId, backupId, clientId: randomUUID(), name: "Broken Ref" });
    artifact.sections.analyses = [
      {
        id: randomUUID(),
        clientId: randomUUID(),
        ownerUserId,
        goal: "refresh",
        hairType: "medium",
        density: "medium",
        porosity: "medium",
        phase: "ready",
        clarificationRound: 0,
        confidenceScore: 0.5,
        uncertaintyReasons: [],
        followUpQuestions: [],
        recommendations: [],
        safetyNotes: [],
        faceShape: null,
        headShape: null,
        hairLength: null,
        hairTexture: null,
        hairCondition: null,
        growthPattern: null,
        targetShape: null,
        technicalCutPlan: null,
        clarificationAnswers: [],
        imageAssetId: null,
        imageAnalysisId: null,
        m8DraftCreatedAt: null,
        m8FinalizedAt: null,
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
      },
    ];
    artifact.counts.analyses = 1;
    artifact.checksum = computeArtifactChecksumHex(artifact);

    try {
      await prisma.opsBackupSnapshot.create({
        data: {
          id: backupId,
          ownerUserId,
          label: artifact.label,
          snapshotJson: artifact,
          checksum: artifact.checksum,
          checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
          schemaVersion: BACKUP_V13_SCHEMA_VERSION,
          createdByUserId: ownerUserId,
        },
      });

      await expect(
        executeBackupRestoreForUser(ownerUserId, backupId, {
          previewFingerprint: "x",
          currentStateFingerprint: "y",
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      ).rejects.toMatchObject({ code: "BACKUP_RESTORE_BLOCKED_BY_PREVIEW", httpStatus: 422 });
    } finally {
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
    }
  });

  it("blocks owner collisions on globally unique ids", async () => {
    const ownerUserId = randomUUID();
    const otherOwnerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const collidingClientId = randomUUID();
    const artifact = createSingleClientArtifact({ ownerUserId, backupId, clientId: collidingClientId, name: "Collision Client" });

    try {
      await prisma.client.create({ data: { id: collidingClientId, ownerUserId: otherOwnerUserId, name: "Other Owner", createdAt: new Date(), updatedAt: new Date() } });
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

      await expect(
        executeBackupRestoreForUser(ownerUserId, backupId, {
          previewFingerprint: preview.previewFingerprint,
          currentStateFingerprint: preview.currentStateFingerprint,
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      ).rejects.toMatchObject({ code: "BACKUP_RESTORE_OWNER_COLLISION", httpStatus: 409 });
    } finally {
      await prisma.client.deleteMany({ where: { ownerUserId: otherOwnerUserId } });
      await prisma.client.deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
    }
  });

  it("maps duplicate artifact ids to unique conflict", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const duplicateId = randomUUID();
    const artifact = createSingleClientArtifact({ ownerUserId, backupId, clientId: duplicateId, name: "Duplicate A" });
    artifact.sections.clients.push({
      id: duplicateId,
      name: "Duplicate B",
      ownerUserId,
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    });
    artifact.counts.clients = 2;
    artifact.checksum = computeArtifactChecksumHex(artifact);

    try {
      await prisma.opsBackupSnapshot.create({
        data: {
          id: backupId,
          ownerUserId,
          label: artifact.label,
          snapshotJson: artifact,
          checksum: artifact.checksum,
          checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
          schemaVersion: BACKUP_V13_SCHEMA_VERSION,
          createdByUserId: ownerUserId,
        },
      });

      const preview = await getBackupRestorePreviewForUser(ownerUserId, backupId);
      await expect(
        executeBackupRestoreForUser(ownerUserId, backupId, {
          previewFingerprint: preview.previewFingerprint,
          currentStateFingerprint: preview.currentStateFingerprint,
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      ).rejects.toMatchObject({ code: "BACKUP_RESTORE_UNIQUE_CONFLICT", httpStatus: 409 });
    } finally {
      await prisma.client.deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });

  it("rolls back after intermediate insert failure", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();
    const assetId = randomUUID();
    const storageDir = path.join(process.cwd(), ".storage", "images", ownerUserId, assetId);
    const storagePath = path.join(storageDir, "photo.jpg");
    const artifact = createAssetArtifact({ ownerUserId, backupId, clientId, assetId, storagePath });

    await fs.promises.mkdir(storageDir, { recursive: true });
    await fs.promises.writeFile(storagePath, Buffer.from("keep-me"));

    try {
      await prisma.client.create({ data: { id: randomUUID(), ownerUserId, name: "Current", createdAt: new Date(), updatedAt: new Date() } });
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
      const before = await snapshotOwnerState(ownerUserId);

      restoreTestUtils.setAfterImageAssetInsertHook(() => {
        throw new Error("mid-insert-failed");
      });

      await expect(
        executeBackupRestoreForUser(ownerUserId, backupId, {
          previewFingerprint: preview.previewFingerprint,
          currentStateFingerprint: preview.currentStateFingerprint,
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      ).rejects.toThrow("mid-insert-failed");

      const after = await snapshotOwnerState(ownerUserId);
      expect(after).toEqual(before);
      expect(fs.existsSync(storagePath)).toBe(true);
    } finally {
      await prisma.imageAsset.deleteMany({ where: { ownerUserId } });
      await prisma.client.deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
      await fs.promises.rm(path.join(process.cwd(), ".storage", "images", ownerUserId), { recursive: true, force: true });
    }
  });

  it("allows only one of two concurrent restores to commit", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();
    const artifact = createSingleClientArtifact({ ownerUserId, backupId, clientId, name: "Concurrent Restore" });

    try {
      await prisma.client.create({ data: { id: randomUUID(), ownerUserId, name: "Current", createdAt: new Date(), updatedAt: new Date() } });
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

      const [first, second] = await Promise.allSettled([
        executeBackupRestoreForUser(ownerUserId, backupId, request),
        executeBackupRestoreForUser(ownerUserId, backupId, request),
      ]);

      const fulfilled = [first, second].filter((item): item is PromiseFulfilledResult<unknown> => item.status === "fulfilled");
      const rejected = [first, second].filter((item): item is PromiseRejectedResult => item.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({ httpStatus: 409 });
    } finally {
      await prisma.client.deleteMany({ where: { ownerUserId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    }
  });
});

async function snapshotOwnerState(ownerUserId: string): Promise<Record<string, unknown>> {
  const [clients, analyses, imageAssets, imageAnalyses, imageAnalysisReviews, backups, auditLogs] = await Promise.all([
    prisma.client.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
    prisma.analysis.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
    prisma.imageAsset.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
    prisma.imageAnalysis.findMany({ where: { asset: { ownerUserId } }, orderBy: { id: "asc" } }),
    prisma.imageAnalysisReview.findMany({ where: { analysis: { asset: { ownerUserId } } }, orderBy: { id: "asc" } }),
    prisma.opsBackupSnapshot.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
    prisma.auditLog.findMany({ where: { actorUserId: ownerUserId }, orderBy: { id: "asc" } }),
  ]);

  return {
    clients,
    analyses,
    imageAssets,
    imageAnalyses,
    imageAnalysisReviews,
    backups,
    auditLogs,
  };
}

function createSingleClientArtifact(input: { ownerUserId: string; backupId: string; clientId: string; name: string }): BackupV13Artifact {
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
    summarySnapshot: { clientsCount: 1, consultationsCount: 0, appointmentsCount: 0, notificationsCount: 0, workspacesCount: 0 },
    counts: { clients: 1, analyses: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
    limits: {
      maxArtifactBytes: 8 * 1024 * 1024,
      maxSectionBytes: 2 * 1024 * 1024,
      maxRowsPerSection: { clients: 2000, analyses: 10000, imageAssets: 10000, imageAnalyses: 10000, imageAnalysisReviews: 20000 },
    },
    sections: {
      clients: [{ id: input.clientId, name: input.name, ownerUserId: input.ownerUserId, createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z" }],
      analyses: [],
      imageAssets: [],
      imageAnalyses: [],
      imageAnalysisReviews: [],
    },
  };
  artifact.checksum = computeArtifactChecksumHex(artifact);
  return artifact;
}

function createAssetArtifact(input: { ownerUserId: string; backupId: string; clientId: string; assetId: string; storagePath: string }): BackupV13Artifact {
  const artifact = createSingleClientArtifact({ ownerUserId: input.ownerUserId, backupId: input.backupId, clientId: input.clientId, name: "Asset Client" });
  artifact.counts.imageAssets = 1;
  artifact.sections.imageAssets = [
    {
      id: input.assetId,
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 7,
      ownerUserId: input.ownerUserId,
      clientId: input.clientId,
      storagePath: input.storagePath,
      exifStripped: true,
      normalizedOrientation: 1,
      uploadedAt: "2026-07-22T00:00:00.000Z",
      deletedAt: null,
      retentionDeletesAt: null,
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    },
  ];
  artifact.checksum = computeArtifactChecksumHex(artifact);
  return artifact;
}