import { describe, expect, it, vi } from "vitest";

import {
  buildBackupM15V1Artifact,
  computeBackupM15V1Checksum,
  type BackupM15V1ArtifactInput,
} from "./backup-m15-artifact";
import type {
  M15ExternalReferenceFailureCode,
  M15ExternalReferenceVerificationResult,
} from "./backup-m15-external-reference-verifier";
import {
  buildBackupM15RestorePreview,
  type BackupM15RestorePreviewDependencies,
  type BackupM15RestorePreviewSource,
} from "./backup-m15-restore-preview";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = "2026-07-28T10:00:00.000Z";

function artifactInput(assetIds = [ASSET_A_ID], storageEtag: string | null = null): BackupM15V1ArtifactInput {
  return {
    schemaVersion: "m15.v1",
    canonicalSerializationVersion: "sorted-json-v1",
    checksumAlgorithm: "sha256",
    backupId: "backup-m15-preview",
    ownerUserId: OWNER_ID,
    createdByUserId: OWNER_ID,
    label: "preview",
    createdAt: NOW,
    summarySnapshot: {
      clientsCount: 1,
      consultationsCount: 1,
      appointmentsCount: 0,
      notificationsCount: 0,
      workspacesCount: 0,
    },
    counts: {
      clients: 1,
      analyses: 1,
      consultations: 1,
      imageAssets: assetIds.length,
      imageAnalyses: 1,
      imageAnalysisReviews: 1,
    },
    limits: {
      maxArtifactBytes: 8 * 1024 * 1024,
      maxSectionBytes: 2 * 1024 * 1024,
      maxRowsPerSection: {
        clients: 2000,
        analyses: 10000,
        consultations: 10000,
        imageAssets: 10000,
        imageAnalyses: 10000,
        imageAnalysisReviews: 20000,
      },
    },
    sections: {
      clients: [{
        id: "client-1", fullName: "Client", email: null, phone: null, notes: null, deletedAt: null,
        ownerUserId: OWNER_ID, createdAt: NOW, updatedAt: NOW,
      }],
      analyses: [{
        id: "analysis-1", clientId: "client-1", ownerUserId: OWNER_ID, goal: "refresh", hairType: "medium",
        density: "medium", porosity: "medium", phase: "ready", clarificationRound: 0, confidenceScore: 0.9,
        uncertaintyReasons: [], followUpQuestions: [], recommendations: [], safetyNotes: [], faceShape: null,
        headShape: null, hairLength: null, hairTexture: null, hairCondition: null, growthPattern: null,
        targetShape: null, technicalCutPlan: null, clarificationAnswers: [], imageAssetId: ASSET_A_ID,
        imageAnalysisId: "image-analysis-1", m8DraftCreatedAt: null, m8FinalizedAt: null,
        createdAt: NOW, updatedAt: NOW,
      }],
      consultations: [{
        id: "consultation-1", ownerUserId: OWNER_ID, clientId: "client-1", analysisId: "analysis-1",
        summary: "Summary", nextSteps: ["Next"], createdAt: NOW,
      }],
      imageAssets: assetIds.map((assetId, index) => ({
        id: assetId,
        fileName: `${assetId}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: index + 10,
        ownerUserId: OWNER_ID,
        clientId: "client-1",
        exifStripped: true,
        normalizedOrientation: 1,
        uploadedAt: NOW,
        deletedAt: null,
        retentionDeletesAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        objectReference: {
          backend: "s3" as const,
          bucketAlias: "images",
          key: `v1/owners/${OWNER_ID}/assets/${assetId}/original`,
          versionId: `version-${index + 1}`,
          contentSha256: (index === 0 ? "a" : "b").repeat(64),
          sizeBytes: index + 10,
        },
        storageEtag,
        storageState: "available" as const,
        storageMigratedAt: NOW,
        objectDeletedAt: null,
        lastStorageErrorCode: null,
      })),
      imageAnalyses: [{
        id: "image-analysis-1", assetId: ASSET_A_ID, status: "completed", providerName: "provider",
        modelVersion: "1", analysisPayload: {}, confidences: {}, unknownFields: [], warnings: [], limitations: [],
        consentTimestamp: NOW, deletedAt: null, retentionDeletesAt: null, createdAt: NOW, updatedAt: NOW,
      }],
      imageAnalysisReviews: [{
        id: "review-1", analysisId: "image-analysis-1", reviewedByUserId: OWNER_ID, manualCorrections: {},
        confirmationTimestamp: null, notes: null, createdAt: NOW, updatedAt: NOW,
      }],
    },
  };
}

function source(assetIds = [ASSET_A_ID], storageEtag: string | null = null): BackupM15RestorePreviewSource {
  const artifact = buildBackupM15V1Artifact(artifactInput(assetIds, storageEtag));
  return {
    ownerUserId: OWNER_ID,
    backupId: artifact.backupId,
    backupChecksum: artifact.checksum as string,
    artifact,
    currentState: structuredClone(artifact.sections),
  };
}

function verified(totalReferences = 1): M15ExternalReferenceVerificationResult {
  return {
    status: "verified",
    code: "verified",
    verifiedAt: NOW,
    totalReferences,
    verifiedReferences: totalReferences,
  };
}

function failed(code: M15ExternalReferenceFailureCode): M15ExternalReferenceVerificationResult {
  return {
    status: "failed",
    code,
    verifiedAt: NOW,
    totalReferences: 1,
    verifiedReferences: 0,
    referenceIndex: 0,
    assetId: "sensitive-provider-identifier",
  };
}

function dependencies(result: M15ExternalReferenceVerificationResult): BackupM15RestorePreviewDependencies {
  return {
    verifyExternalReferences: vi.fn(async () => result),
    resolveStorage: vi.fn(async () => null),
    now: () => new Date(NOW),
    maxStreamBytes: 8 * 1024 * 1024,
  };
}

describe("backup-m15-restore-preview", () => {
  it("returns an eligible preview for one verified exact-version reference", async () => {
    const preview = await buildBackupM15RestorePreview(source(), dependencies(verified()));

    expect(preview).toMatchObject({
      schemaVersion: "m15.v1",
      eligibleForRestorePlanning: true,
      checksumStatus: "valid",
      artifactValidity: "valid",
      externalReferenceStatus: "verified",
      externalReferences: { code: "verified", totalReferences: 1, verifiedReferences: 1 },
    });
    expect(preview.blockingReasons).toEqual([]);
  });

  it("returns an eligible preview for multiple verified references", async () => {
    const preview = await buildBackupM15RestorePreview(
      source([ASSET_B_ID, ASSET_A_ID]),
      dependencies(verified(2)),
    );

    expect(preview.eligibleForRestorePlanning).toBe(true);
    expect(preview.externalReferences).toMatchObject({ totalReferences: 2, verifiedReferences: 2 });
    expect(preview.impact.imageAssets.unchanged).toBe(2);
  });

  it("fails closed for an invalid artifact without invoking verification", async () => {
    const input = source();
    input.artifact = { schemaVersion: "m15.v1", secret: "must-not-leak" };
    const deps = dependencies(verified());
    const preview = await buildBackupM15RestorePreview(input, deps);

    expect(preview).toMatchObject({ eligibleForRestorePlanning: false, artifactValidity: "invalid", checksumStatus: "unavailable" });
    expect(deps.verifyExternalReferences).not.toHaveBeenCalled();
    expect(JSON.stringify(preview)).not.toContain("must-not-leak");
  });

  it("fails closed for a checksum mismatch", async () => {
    const input = source();
    input.backupChecksum = "f".repeat(64);
    const deps = dependencies(verified());
    const preview = await buildBackupM15RestorePreview(input, deps);

    expect(preview).toMatchObject({ eligibleForRestorePlanning: false, checksumStatus: "mismatch" });
    expect(preview.blockingReasons.some(({ code }) => code === "CHECKSUM_MISMATCH")).toBe(true);
    expect(deps.verifyExternalReferences).not.toHaveBeenCalled();
  });

  it("fails closed for an owner mismatch", async () => {
    const input = source();
    input.ownerUserId = OTHER_OWNER_ID;
    const preview = await buildBackupM15RestorePreview(input, dependencies(verified()));

    expect(preview.eligibleForRestorePlanning).toBe(false);
    expect(preview.blockingReasons.some(({ code }) => code === "OWNER_SCOPE_MISMATCH")).toBe(true);
  });

  it("fails closed for an invalid relation graph", async () => {
    const input = source();
    const artifact = structuredClone(input.artifact) as ReturnType<typeof buildBackupM15V1Artifact>;
    artifact.sections.analyses[0].clientId = "missing-client";
    artifact.checksum = computeBackupM15V1Checksum(artifact);
    input.artifact = artifact;
    input.backupChecksum = artifact.checksum;
    const preview = await buildBackupM15RestorePreview(input, dependencies(verified()));

    expect(preview.eligibleForRestorePlanning).toBe(false);
    expect(preview.blockingReasons.some(({ code }) => code === "REFERENCE_GRAPH_INVALID")).toBe(true);
  });

  it.each([
    "unknown_alias",
    "missing_object",
    "version_mismatch",
    "identity_mismatch",
    "size_mismatch",
    "checksum_metadata_mismatch",
    "streamed_checksum_mismatch",
    "streamed_size_mismatch",
    "storage_timeout",
    "storage_access_denied",
    "storage_unavailable",
  ] satisfies M15ExternalReferenceFailureCode[])("maps %s safely and blocks eligibility", async (code) => {
    const preview = await buildBackupM15RestorePreview(source(), dependencies(failed(code)));

    expect(preview.eligibleForRestorePlanning).toBe(false);
    expect(preview.externalReferences).toEqual({
      status: "failed",
      code,
      totalReferences: 1,
      verifiedReferences: 0,
    });
    expect(preview.blockingReasons).toHaveLength(1);
  });

  it("produces deterministic fingerprints", async () => {
    const first = await buildBackupM15RestorePreview(source(), dependencies(verified()));
    const second = await buildBackupM15RestorePreview(source(), {
      ...dependencies(verified()),
      now: () => new Date("2026-07-28T11:00:00.000Z"),
    });

    expect(first.previewFingerprint).toBe(second.previewFingerprint);
    expect(first.backupStateFingerprint).toBe(second.backupStateFingerprint);
  });

  it("changes the fingerprint when M15 metadata changes", async () => {
    const first = await buildBackupM15RestorePreview(source(), dependencies(verified()));
    const second = await buildBackupM15RestorePreview(source([ASSET_A_ID], "changed-etag"), dependencies(verified()));

    expect(first.previewFingerprint).not.toBe(second.previewFingerprint);
    expect(first.backupStateFingerprint).not.toBe(second.backupStateFingerprint);
  });

  it("normalizes section ordering before fingerprinting", async () => {
    const firstSource = source([ASSET_A_ID, ASSET_B_ID]);
    const secondSource = structuredClone(firstSource);
    secondSource.currentState.imageAssets.reverse();
    const first = await buildBackupM15RestorePreview(firstSource, dependencies(verified(2)));
    const second = await buildBackupM15RestorePreview(secondSource, dependencies(verified(2)));

    expect(first.previewFingerprint).toBe(second.previewFingerprint);
    expect(first.currentStateFingerprint).toBe(second.currentStateFingerprint);
  });

  it("does not expose verifier identifiers or provider details", async () => {
    const preview = await buildBackupM15RestorePreview(source(), {
      ...dependencies(failed("storage_unavailable")),
      verifyExternalReferences: vi.fn(async () => ({
        ...failed("storage_unavailable"),
        assetId: "private-key-version-etag-endpoint-physical-bucket-stack",
      })),
    });
    const serialized = JSON.stringify(preview);

    expect(serialized).not.toMatch(/private-key|version-etag|endpoint|physical-bucket|stack/);
    expect(preview.conflicts.every(({ recordId, referenceId }) => recordId === null && referenceId === null)).toBe(true);
    expect(preview.blockingReasons.every(({ recordId, referenceId }) => recordId === null && referenceId === null)).toBe(true);
  });
});
