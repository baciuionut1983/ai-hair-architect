import { randomUUID } from "crypto";
import path from "path";

import { describe, expect, it } from "vitest";

import { BACKUP_V13_CANONICAL_VERSION, BACKUP_V13_SCHEMA_VERSION, computeArtifactChecksumHex } from "@/lib/backup-v13-artifact";
import type { BackupV13Artifact } from "@/lib/contracts";
import { verifyBackupSnapshotForUser } from "@/lib/ops-persistence";
import { prisma } from "@/lib/prisma";

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("m13 backup verification integration", () => {
  it("classifies valid m13 artifact without image assets as verification_ready", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const artifact: BackupV13Artifact = {
      schemaVersion: BACKUP_V13_SCHEMA_VERSION,
      canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
      checksumAlgorithm: "sha256",
      checksum: null,
      backupId,
      ownerUserId,
      createdByUserId: ownerUserId,
      label: "m13-test",
      createdAt: new Date().toISOString(),
      summarySnapshot: {
        clientsCount: 0,
        consultationsCount: 0,
        appointmentsCount: 0,
        notificationsCount: 0,
        workspacesCount: 0,
      },
      counts: {
        clients: 0,
        analyses: 0,
        imageAssets: 0,
        imageAnalyses: 0,
        imageAnalysisReviews: 0,
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
        clients: [],
        analyses: [],
        imageAssets: [],
        imageAnalyses: [],
        imageAnalysisReviews: [],
      },
    };

    artifact.checksum = computeArtifactChecksumHex(artifact);

    await prisma.opsBackupSnapshot.create({
      data: {
        id: backupId,
        ownerUserId,
        label: "m13-test",
        snapshotJson: artifact,
        checksum: artifact.checksum,
        checksumAlgorithm: "sha256",
        schemaVersion: BACKUP_V13_SCHEMA_VERSION,
        createdByUserId: ownerUserId,
      },
    });

    const result = await verifyBackupSnapshotForUser(ownerUserId, backupId);
    expect(result.recoveryArtifactStatus).toBe("verification_ready");
    expect(result.externalReferenceStatus).toBe("not_applicable");

    await prisma.opsBackupSnapshot.deleteMany({ where: { id: backupId } });
  });

  it("classifies legacy m12 summary snapshot", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;

    await prisma.opsBackupSnapshot.create({
      data: {
        id: backupId,
        ownerUserId,
        label: "legacy",
        snapshotJson: {
          clientsCount: 1,
          consultationsCount: 0,
          appointmentsCount: 0,
          notificationsCount: 0,
          workspacesCount: 0,
        },
        checksum: "legacy",
        checksumAlgorithm: "sha256",
        schemaVersion: "m12.v1",
        createdByUserId: ownerUserId,
      },
    });

    const result = await verifyBackupSnapshotForUser(ownerUserId, backupId);
    expect(result.recoveryArtifactStatus).toBe("legacy_summary_only");
    expect(result.artifactValidity).toBe("legacy_valid");

    await prisma.opsBackupSnapshot.deleteMany({ where: { id: backupId } });
  });

  it("returns unsafe reference error for escaped storage path", async () => {
    const ownerUserId = randomUUID();
    const backupId = `c${Date.now().toString(36)}${Math.random().toString(16).slice(2, 14)}`;
    const artifact: BackupV13Artifact = {
      schemaVersion: BACKUP_V13_SCHEMA_VERSION,
      canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
      checksumAlgorithm: "sha256",
      checksum: null,
      backupId,
      ownerUserId,
      createdByUserId: ownerUserId,
      label: "unsafe",
      createdAt: new Date().toISOString(),
      summarySnapshot: {
        clientsCount: 0,
        consultationsCount: 0,
        appointmentsCount: 0,
        notificationsCount: 0,
        workspacesCount: 0,
      },
      counts: {
        clients: 0,
        analyses: 0,
        imageAssets: 1,
        imageAnalyses: 0,
        imageAnalysisReviews: 0,
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
        clients: [],
        analyses: [],
        imageAssets: [
          {
            id: "asset-1",
            fileName: "a.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 1,
            ownerUserId,
            clientId: "client-1",
            storagePath: path.resolve("C:/tmp/outside.jpg"),
            exifStripped: true,
            normalizedOrientation: 1,
            uploadedAt: new Date().toISOString(),
            deletedAt: null,
            retentionDeletesAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        imageAnalyses: [],
        imageAnalysisReviews: [],
      },
    };

    artifact.checksum = computeArtifactChecksumHex(artifact);

    await prisma.opsBackupSnapshot.create({
      data: {
        id: backupId,
        ownerUserId,
        label: "unsafe",
        snapshotJson: artifact,
        checksum: artifact.checksum,
        checksumAlgorithm: "sha256",
        schemaVersion: BACKUP_V13_SCHEMA_VERSION,
        createdByUserId: ownerUserId,
      },
    });

    await expect(verifyBackupSnapshotForUser(ownerUserId, backupId)).rejects.toMatchObject({
      code: "BACKUP_EXTERNAL_REFERENCE_UNSAFE",
      httpStatus: 422,
    });

    await prisma.opsBackupSnapshot.deleteMany({ where: { id: backupId } });
  });
});
