import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { BACKUP_CHECKSUM_ALGORITHM, BACKUP_V13_CANONICAL_VERSION, BACKUP_V13_SCHEMA_VERSION, computeArtifactChecksumHex } from "@/lib/backup-v13-artifact";
import { buildBackupRestorePreview } from "@/lib/backup-v13-restore-preview";
import type { BackupV13Artifact } from "@/lib/contracts";

function createBaseArtifact(): BackupV13Artifact {
  return {
    schemaVersion: BACKUP_V13_SCHEMA_VERSION,
    canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
    checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
    checksum: null,
    backupId: "backup-1",
    ownerUserId: "owner-1",
    createdByUserId: "owner-1",
    label: "checkpoint",
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
      clients: [
        {
          id: "client-1",
          name: "Client",
          ownerUserId: "owner-1",
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
}

function createBaseSource(overrides?: Partial<Parameters<typeof buildBackupRestorePreview>[0]> & { currentExtraClient?: boolean }) {
  const artifact = createBaseArtifact();
  artifact.checksum = computeArtifactChecksumHex(artifact);

  const currentClient = {
    id: "client-1",
    fullName: "Client",
    email: null,
    phone: null,
    notes: null,
    deletedAt: null,
    ownerUserId: "owner-1",
    createdAt: new Date("2026-07-22T00:00:00.000Z"),
    updatedAt: new Date("2026-07-22T00:00:00.000Z"),
  };

  const extraClient = {
    id: "client-2",
    fullName: "Client B",
    email: null,
    phone: null,
    notes: null,
    deletedAt: null,
    ownerUserId: "owner-1",
    createdAt: new Date("2026-07-23T00:00:00.000Z"),
    updatedAt: new Date("2026-07-23T00:00:00.000Z"),
  };

  return {
    ownerUserId: "owner-1",
    backupId: artifact.backupId,
    backupRow: {
      id: artifact.backupId,
      ownerUserId: artifact.ownerUserId,
      checksum: artifact.checksum,
      checksumAlgorithm: artifact.checksumAlgorithm,
      schemaVersion: artifact.schemaVersion,
      snapshotJson: artifact,
    },
    backupArtifact: artifact,
    currentState: {
      clients: [currentClient, ...(overrides?.currentExtraClient ? [extraClient] : [])],
      analyses: [],
      imageAssets: [],
      imageAnalyses: [],
      imageAnalysisReviews: [],
    },
    ...overrides,
  } as Parameters<typeof buildBackupRestorePreview>[0];
}

describe("backup-v13-restore-preview", () => {
  it("produces deterministic preview fingerprints for identical logical inputs", () => {
    const previewGeneratedAt = "2026-07-25T20:00:00.000Z";
    return Promise.all([
      buildBackupRestorePreview(createBaseSource({ currentExtraClient: true }), previewGeneratedAt),
      buildBackupRestorePreview(createBaseSource({ currentExtraClient: true }), previewGeneratedAt),
    ]).then(([first, second]) => {
      expect(first.previewFingerprint).toBe(second.previewFingerprint);
      expect(first.backupStateFingerprint).toBe(second.backupStateFingerprint);
      expect(first.currentStateFingerprint).toBe(second.currentStateFingerprint);
    });
  });

  it("detects current-state extra rows and backup staleness without writes", async () => {
    const preview = await buildBackupRestorePreview(createBaseSource({ currentExtraClient: true }));

    expect(preview.eligibleForRestorePlanning).toBe(true);
    expect(preview.impact.clients.wouldDelete).toBe(1);
    expect(preview.impact.clients.conflictCount).toBe(1);
    expect(preview.conflicts.some((issue) => issue.code === "CURRENT_STATE_HAS_EXTRA_ROWS")).toBe(true);
    expect(preview.warnings.some((issue) => issue.code === "BACKUP_OLDER_THAN_CURRENT_STATE")).toBe(true);
  });

  it("blocks previews with checksum mismatch", async () => {
    const source = createBaseSource();
    source.backupRow.checksum = "0".repeat(64);

    const preview = await buildBackupRestorePreview(source);

    expect(preview.eligibleForRestorePlanning).toBe(false);
    expect(preview.checksumStatus).toBe("mismatch");
    expect(preview.blockingReasons.some((issue) => issue.code === "CHECKSUM_MISMATCH")).toBe(true);
  });

  it("blocks previews with missing external objects", async () => {
    const storageRoot = path.join(process.cwd(), ".storage", "images", `owner-${randomUUID()}`);
    const assetPath = path.join(storageRoot, "asset-1", "photo.jpg");
    const artifact = createBaseArtifact();
    artifact.counts.imageAssets = 1;
    artifact.sections.imageAssets = [
      {
        id: "asset-1",
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1,
        ownerUserId: "owner-1",
        clientId: "client-1",
        storagePath: assetPath,
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

    const preview = await buildBackupRestorePreview({
      ownerUserId: "owner-1",
      backupId: artifact.backupId,
      backupRow: {
        id: artifact.backupId,
        ownerUserId: artifact.ownerUserId,
        checksum: artifact.checksum,
        checksumAlgorithm: artifact.checksumAlgorithm,
        schemaVersion: artifact.schemaVersion,
        snapshotJson: artifact,
      },
      backupArtifact: artifact,
      currentState: {
        clients: [
          {
            id: "client-1",
            fullName: "Client",
            email: null,
            phone: null,
            notes: null,
            deletedAt: null,
            ownerUserId: "owner-1",
            createdAt: new Date("2026-07-22T00:00:00.000Z"),
            updatedAt: new Date("2026-07-22T00:00:00.000Z"),
          },
        ],
        analyses: [],
        imageAssets: [],
        imageAnalyses: [],
        imageAnalysisReviews: [],
      },
    });

    expect(preview.eligibleForRestorePlanning).toBe(false);
    expect(preview.externalReferenceStatus).toBe("missing");
    expect(preview.blockingReasons.some((issue) => issue.code === "EXTERNAL_FILE_MISSING")).toBe(true);
    expect(fs.existsSync(assetPath)).toBe(false);
  });
});