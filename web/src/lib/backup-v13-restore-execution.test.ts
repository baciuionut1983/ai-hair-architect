import { describe, expect, it } from "vitest";

import {
  BACKUP_CHECKSUM_ALGORITHM,
  BACKUP_V13_CANONICAL_VERSION,
  BackupArtifactError,
} from "@/lib/backup-v13-artifact";
import { executeBackupRestoreForUser, __testUtils } from "@/lib/backup-v13-restore-execution";
import type { BackupV13Artifact } from "@/lib/contracts";

function createArtifact(schemaVersion: "m13.v1" | "m13.v2", client: Record<string, unknown>): BackupV13Artifact {
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
    counts: { clients: 1, analyses: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
    limits: {
      maxArtifactBytes: 1,
      maxSectionBytes: 1,
      maxRowsPerSection: { clients: 1, analyses: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
    },
    sections: {
      clients: [client],
      analyses: [],
      imageAssets: [],
      imageAnalyses: [],
      imageAnalysisReviews: [],
    },
  } as unknown as BackupV13Artifact;
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

  it("rejects an unknown schemaVersion fail-closed", () => {
    const artifact = createArtifact("m13.v1", {}) as unknown as { schemaVersion: string };
    artifact.schemaVersion = "m13.v3";

    expect(() => __testUtils.mapClientRowsForRestore(artifact as BackupV13Artifact)).toThrow(
      expect.objectContaining<Partial<BackupArtifactError>>({
        code: "BACKUP_RESTORE_SCHEMA_UNSUPPORTED",
        httpStatus: 422,
      }),
    );
  });
});