import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { describe, expect, it } from "vitest";

import { BACKUP_CHECKSUM_ALGORITHM, BACKUP_V13_CANONICAL_VERSION, BACKUP_V13_SCHEMA_VERSION, computeArtifactChecksumHex } from "@/lib/backup-v13-artifact";
import { getBackupRestorePreviewForUser } from "@/lib/backup-v13-restore-preview";
import type { BackupV13Artifact } from "@/lib/contracts";
import { prisma } from "@/lib/prisma";

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("m13 backup restore preview integration", () => {
  it("produces a stable read-only preview without changing DB state", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const clientId = randomUUID();
    const analysisId = randomUUID();
    const assetId = randomUUID();
    const imageAnalysisId = randomUUID();
    const reviewId = randomUUID();
    const storageDir = path.join(process.cwd(), ".storage", "images", ownerUserId, assetId);
    const storagePath = path.join(storageDir, "photo.jpg");

    await fs.promises.mkdir(storageDir, { recursive: true });
    await fs.promises.writeFile(storagePath, Buffer.from("preview"));

    try {
      await prisma.user.create({
        data: {
          id: ownerUserId,
          email: `${ownerUserId}@preview.test`,
          passwordHash: "test",
          role: "professional",
          locale: "en",
        },
      });
      await prisma.client.create({
        data: {
          id: clientId,
          fullName: "Preview Client",
          ownerUserId,
        },
      });

      await prisma.imageAsset.create({
        data: {
          id: assetId,
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 7,
          ownerUserId,
          clientId,
          storagePath,
          exifStripped: true,
          normalizedOrientation: 1,
          uploadedAt: new Date("2026-07-22T00:00:00.000Z"),
          createdAt: new Date("2026-07-22T00:00:00.000Z"),
          updatedAt: new Date("2026-07-22T00:00:00.000Z"),
        },
      });

      await prisma.imageAnalysis.create({
        data: {
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
          consentTimestamp: new Date("2026-07-22T00:00:00.000Z"),
          createdAt: new Date("2026-07-22T00:00:00.000Z"),
          updatedAt: new Date("2026-07-22T00:00:00.000Z"),
        },
      });

      await prisma.analysis.create({
        data: {
          id: analysisId,
          clientId,
          ownerUserId,
          goal: "refresh",
          hairType: "medium",
          density: "medium",
          porosity: "medium",
          phase: "ready",
          clarificationRound: 0,
          confidenceScore: 0.98,
          uncertaintyReasons: [],
          followUpQuestions: [],
          recommendations: ["keep shape"],
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
          createdAt: new Date("2026-07-22T00:00:00.000Z"),
          updatedAt: new Date("2026-07-22T00:00:00.000Z"),
        },
      });

      await prisma.imageAnalysisReview.create({
        data: {
          id: reviewId,
          analysisId: imageAnalysisId,
          reviewedByUserId: ownerUserId,
          manualCorrections: {},
          confirmationTimestamp: null,
          notes: null,
          createdAt: new Date("2026-07-22T00:00:00.000Z"),
          updatedAt: new Date("2026-07-22T00:00:00.000Z"),
        },
      });

      const artifact: BackupV13Artifact = {
        schemaVersion: BACKUP_V13_SCHEMA_VERSION,
        canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
        checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
        checksum: null,
        backupId,
        ownerUserId,
        createdByUserId: ownerUserId,
        label: "integration",
        createdAt: new Date("2026-07-22T00:00:00.000Z").toISOString(),
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
              name: "Preview Client",
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
              confidenceScore: 0.98,
              uncertaintyReasons: [],
              followUpQuestions: [],
              recommendations: ["keep shape"],
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
          label: "integration",
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
          fullName: "Later Client",
          ownerUserId,
          createdAt: new Date("2026-07-23T00:00:00.000Z"),
          updatedAt: new Date("2026-07-23T00:00:00.000Z"),
        },
      });

      const beforeCounts = await Promise.all([
        prisma.client.count({ where: { ownerUserId } }),
        prisma.analysis.count({ where: { ownerUserId } }),
        prisma.imageAsset.count({ where: { ownerUserId } }),
        prisma.imageAnalysis.count({ where: { asset: { ownerUserId } } }),
        prisma.imageAnalysisReview.count({ where: { analysis: { asset: { ownerUserId } } } }),
        prisma.opsBackupSnapshot.count({ where: { ownerUserId } }),
        prisma.auditLog.count({ where: { actorUserId: ownerUserId } }),
      ]);

      const previewGeneratedAt = "2026-07-25T20:00:00.000Z";
      const firstPreview = await getBackupRestorePreviewForUser(ownerUserId, backupId, previewGeneratedAt);
      const afterFirstCounts = await Promise.all([
        prisma.client.count({ where: { ownerUserId } }),
        prisma.analysis.count({ where: { ownerUserId } }),
        prisma.imageAsset.count({ where: { ownerUserId } }),
        prisma.imageAnalysis.count({ where: { asset: { ownerUserId } } }),
        prisma.imageAnalysisReview.count({ where: { analysis: { asset: { ownerUserId } } } }),
        prisma.opsBackupSnapshot.count({ where: { ownerUserId } }),
        prisma.auditLog.count({ where: { actorUserId: ownerUserId } }),
      ]);
      const secondPreview = await getBackupRestorePreviewForUser(ownerUserId, backupId, previewGeneratedAt);

      const afterSecondCounts = await Promise.all([
        prisma.client.count({ where: { ownerUserId } }),
        prisma.analysis.count({ where: { ownerUserId } }),
        prisma.imageAsset.count({ where: { ownerUserId } }),
        prisma.imageAnalysis.count({ where: { asset: { ownerUserId } } }),
        prisma.imageAnalysisReview.count({ where: { analysis: { asset: { ownerUserId } } } }),
        prisma.opsBackupSnapshot.count({ where: { ownerUserId } }),
        prisma.auditLog.count({ where: { actorUserId: ownerUserId } }),
      ]);

      expect(firstPreview.previewFingerprint).toBe(secondPreview.previewFingerprint);
      expect(firstPreview.backupStateFingerprint).toBe(secondPreview.backupStateFingerprint);
      expect(firstPreview.currentStateFingerprint).toBe(secondPreview.currentStateFingerprint);
      expect(firstPreview.eligibleForRestorePlanning).toBe(true);
      expect(firstPreview.impact.clients.wouldDelete).toBe(1);
      expect(firstPreview.warnings.some((issue) => issue.code === "BACKUP_OLDER_THAN_CURRENT_STATE")).toBe(true);

      expect(afterFirstCounts).toEqual(beforeCounts);
      expect(afterSecondCounts).toEqual(beforeCounts);
    } finally {
      await prisma.imageAnalysisReview.deleteMany({ where: { id: reviewId } });
      await prisma.analysis.deleteMany({ where: { id: analysisId } });
      await prisma.imageAnalysis.deleteMany({ where: { id: imageAnalysisId } });
      await prisma.imageAsset.deleteMany({ where: { id: assetId } });
      await prisma.client.deleteMany({ where: { id: clientId } });
      await prisma.opsBackupSnapshot.deleteMany({ where: { id: backupId } });
      await prisma.client.deleteMany({ where: { ownerUserId, fullName: "Later Client" } });
      await prisma.user.deleteMany({ where: { id: ownerUserId } });
      await fs.promises.rm(path.join(process.cwd(), ".storage", "images", ownerUserId), { recursive: true, force: true });
    }
  });
});