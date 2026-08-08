import { describe, expect, it } from "vitest";

import {
  BACKUP_CHECKSUM_ALGORITHM,
  BACKUP_V13_CANONICAL_VERSION,
  BackupArtifactError,
  computeArtifactChecksumHex,
} from "@/lib/backup-v13-artifact";
import { executeBackupRestoreForUser, __testUtils } from "@/lib/backup-v13-restore-execution";
import type { BackupV13Artifact } from "@/lib/contracts";

function createArtifact(
  schemaVersion: "m13.v1" | "m13.v2",
  client: Record<string, unknown>,
  imageAssets: Array<Record<string, unknown>> = [],
): BackupV13Artifact {
  return {
    schemaVersion,
    canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
    checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
    checksum: null,
    backupId: "backup-1",
    ownerUserId: "owner-1",
    createdByUserId: "owner-1",
    label: "dispatch",
    createdAt: "2026-07-25T00:00:00.000Z",
    summarySnapshot: {
      clientsCount: 1,
      consultationsCount: 0,
      appointmentsCount: 0,
      notificationsCount: 0,
      workspacesCount: 0,
    },
    counts: { clients: 1, analyses: 0, imageAssets: imageAssets.length, imageAnalyses: 0, imageAnalysisReviews: 0 },
    limits: {
      maxArtifactBytes: 1,
      maxSectionBytes: 1,
      maxRowsPerSection: { clients: 1, analyses: 0, imageAssets: imageAssets.length, imageAnalyses: 0, imageAnalysisReviews: 0 },
    },
    sections: {
      clients: [client],
      analyses: [],
      imageAssets,
      imageAnalyses: [],
      imageAnalysisReviews: [],
    },
  } as unknown as BackupV13Artifact;
}

function imageAssetRow(id: string, storagePath: string): Record<string, unknown> {
  return {
    id,
    ownerUserId: "owner-1",
    clientId: "client-1",
    fileName: "photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
    storagePath,
    exifStripped: true,
    normalizedOrientation: 0,
    uploadedAt: "2026-07-25T00:00:00.000Z",
    deletedAt: null,
    retentionDeletesAt: null,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
  };
}

function checksummedArtifact(artifact: BackupV13Artifact): { artifact: BackupV13Artifact; row: { id: string; checksum: string } } {
  const checksum = computeArtifactChecksumHex(artifact);
  const signed = { ...artifact, checksum };
  return { artifact: signed, row: { id: signed.backupId, checksum } };
}

describe("backup-v13-restore-execution", () => {
  it("exposes resettable test hooks", () => {
    __testUtils.setForcePostconditionMismatch(true);
    __testUtils.setRetryableFailuresRemaining(2);
    __testUtils.resetHooks();

    expect(typeof executeBackupRestoreForUser).toBe("function");
  });

  it("always uses the v1 mapper for m13.v1 regardless of row shape", () => {
    const artifact = createArtifact("m13.v1", {
      id: "client-1",
      name: "V1 Name",
      fullName: "V2 Decoy",
      email: "decoy@example.com",
      ownerUserId: "owner-1",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    });

    expect(__testUtils.mapClientRowsForRestore(artifact)[0]).toMatchObject({
      fullName: "V1 Name",
      email: null,
      deletedAt: null,
    });
  });

  it("always uses the v2 mapper for m13.v2 regardless of row shape", () => {
    const artifact = createArtifact("m13.v2", {
      id: "client-1",
      name: "V1 Decoy",
      fullName: "V2 Name",
      email: "v2@example.com",
      phone: null,
      notes: "v2 notes",
      deletedAt: "2026-07-25T01:00:00.000Z",
      ownerUserId: "owner-1",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    });

    expect(__testUtils.mapClientRowsForRestore(artifact)[0]).toMatchObject({
      fullName: "V2 Name",
      email: "v2@example.com",
      notes: "v2 notes",
      deletedAt: new Date("2026-07-25T01:00:00.000Z"),
    });
  });

  it("does not reinterpret an inconsistent artifact as another schema", () => {
    const artifact = createArtifact("m13.v1", {
      id: "client-1",
      fullName: "V2-only Name",
      ownerUserId: "owner-1",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    });

    expect(__testUtils.mapClientRowsForRestore(artifact)[0]).toMatchObject({
      fullName: undefined,
      email: null,
    });
  });

  it("uses the v2 Client mapper for m13.v3", () => {
    const artifact = createArtifact("m13.v2", {
      id: "client-1",
      fullName: "V3 Client",
      email: null,
      phone: null,
      notes: null,
      deletedAt: null,
      ownerUserId: "owner-1",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    }) as unknown as { schemaVersion: string };
    artifact.schemaVersion = "m13.v3";

    expect(__testUtils.mapClientRowsForRestore(artifact as BackupV13Artifact)[0]).toMatchObject({
      fullName: "V3 Client",
      email: null,
    });
  });

  it("rejects an unknown schemaVersion fail-closed", () => {
    const artifact = createArtifact("m13.v1", {}) as unknown as { schemaVersion: string };
    artifact.schemaVersion = "m13.v4";

    expect(() => __testUtils.mapClientRowsForRestore(artifact as BackupV13Artifact)).toThrow(
      expect.objectContaining<Partial<BackupArtifactError>>({
        code: "BACKUP_RESTORE_SCHEMA_UNSUPPORTED",
        httpStatus: 422,
      }),
    );
  });

  describe("assertBackupArtifactExecutable (M33 GO-2: legacy S3 storage metadata guard)", () => {
    const CLIENT = {
      id: "client-1",
      fullName: "Client",
      email: null,
      phone: null,
      notes: null,
      deletedAt: null,
      ownerUserId: "owner-1",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    it("does not block an m13.x backup with no image assets", () => {
      const { artifact, row } = checksummedArtifact(createArtifact("m13.v1", CLIENT, []));

      expect(() => __testUtils.assertBackupArtifactExecutable(artifact, row)).not.toThrow();
    });

    it("does not block an m13.x backup whose image assets have a real local storagePath", () => {
      const { artifact, row } = checksummedArtifact(
        createArtifact("m13.v1", CLIENT, [imageAssetRow("asset-1", "/var/app/.storage/images/owner-1/asset-1/photo.jpg")]),
      );

      expect(() => __testUtils.assertBackupArtifactExecutable(artifact, row)).not.toThrow();
    });

    it("fails closed, before any mutation, when an image asset has storagePath \"pending\" (S3-backed, metadata never captured)", () => {
      const { artifact, row } = checksummedArtifact(
        createArtifact("m13.v1", CLIENT, [imageAssetRow("asset-1", "pending")]),
      );

      expect(() => __testUtils.assertBackupArtifactExecutable(artifact, row)).toThrow(
        expect.objectContaining<Partial<BackupArtifactError>>({
          code: "BACKUP_RESTORE_STORAGE_METADATA_MISSING",
          httpStatus: 422,
        }),
      );
    });

    it("flags the specific offending image asset id in the error details", () => {
      const { artifact, row } = checksummedArtifact(
        createArtifact("m13.v1", CLIENT, [
          imageAssetRow("asset-local", "/var/app/.storage/images/owner-1/asset-local/photo.jpg"),
          imageAssetRow("asset-s3", "pending"),
        ]),
      );

      try {
        __testUtils.assertBackupArtifactExecutable(artifact, row);
        expect.unreachable("expected assertBackupArtifactExecutable to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(BackupArtifactError);
        expect((error as BackupArtifactError).details).toMatchObject({ imageAssetId: "asset-s3" });
      }
    });

    it("checks storage metadata only after schema/artifact/checksum validation already passed (checksum mismatch still takes priority)", () => {
      const { artifact, row } = checksummedArtifact(
        createArtifact("m13.v1", CLIENT, [imageAssetRow("asset-1", "pending")]),
      );
      const tamperedRow = { ...row, checksum: "0".repeat(64) };

      expect(() => __testUtils.assertBackupArtifactExecutable(artifact, tamperedRow)).toThrow(
        expect.objectContaining<Partial<BackupArtifactError>>({
          code: "BACKUP_RESTORE_CHECKSUM_MISMATCH",
        }),
      );
    });
  });
});