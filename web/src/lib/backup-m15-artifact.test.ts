import { describe, expect, expectTypeOf, it } from "vitest";

import {
  M15_CANONICAL_SERIALIZATION_VERSION,
  M15_CHECKSUM_ALGORITHM,
  buildBackupM15V1Artifact,
  canonicalizeM15SortedJson,
  computeBackupM15V1Checksum,
  isBackupM15V1Artifact,
  parseBackupM15V1Artifact,
  type BackupM15V1ArtifactInput,
} from "./backup-m15-artifact";
import type { BackupM15V1Artifact, BackupRecoveryArtifact, BackupV13Artifact } from "./contracts";
import { M15_V1_SCHEMA_VERSION } from "./object-storage-runtime";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = "2026-07-27T10:00:00.000Z";

function createInput(): BackupM15V1ArtifactInput {
  return {
    schemaVersion: M15_V1_SCHEMA_VERSION,
    canonicalSerializationVersion: M15_CANONICAL_SERIALIZATION_VERSION,
    checksumAlgorithm: M15_CHECKSUM_ALGORITHM,
    backupId: "backup-m15-1",
    ownerUserId: OWNER_ID,
    createdByUserId: OWNER_ID,
    label: "M15 checkpoint",
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
      imageAssets: 2,
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
      clients: [{ id: "client-1", fullName: "Client", email: null, phone: null, notes: null, deletedAt: null, ownerUserId: OWNER_ID, createdAt: NOW, updatedAt: NOW }],
      analyses: [{
        id: "analysis-1", clientId: "client-1", ownerUserId: OWNER_ID, goal: "refresh", hairType: "medium",
        density: "medium", porosity: "medium", phase: "ready", clarificationRound: 0, confidenceScore: 0.9,
        uncertaintyReasons: [], followUpQuestions: [], recommendations: [], safetyNotes: [], faceShape: null,
        headShape: null, hairLength: null, hairTexture: null, hairCondition: null, growthPattern: null, targetShape: null,
        technicalCutPlan: null, clarificationAnswers: [], imageAssetId: ASSET_A_ID, imageAnalysisId: "image-analysis-1",
        m8DraftCreatedAt: null, m8FinalizedAt: null, createdAt: NOW, updatedAt: NOW,
      }],
      consultations: [{ id: "consultation-1", ownerUserId: OWNER_ID, clientId: "client-1", analysisId: "analysis-1", summary: "Summary", nextSteps: ["Next"], createdAt: NOW }],
      imageAssets: [createImageAsset(ASSET_B_ID, 200), createImageAsset(ASSET_A_ID, 100)],
      imageAnalyses: [{
        id: "image-analysis-1", assetId: ASSET_A_ID, status: "completed", providerName: "provider", modelVersion: "1",
        analysisPayload: {}, confidences: {}, unknownFields: [], warnings: [], limitations: [], consentTimestamp: NOW,
        deletedAt: null, retentionDeletesAt: null, createdAt: NOW, updatedAt: NOW,
      }],
      imageAnalysisReviews: [{
        id: "review-1", analysisId: "image-analysis-1", reviewedByUserId: OWNER_ID, manualCorrections: {},
        confirmationTimestamp: null, notes: null, createdAt: NOW, updatedAt: NOW,
      }],
    },
  };
}

function createImageAsset(assetId: string, sizeBytes: number) {
  return {
    id: assetId,
    fileName: `${assetId}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes,
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
      versionId: `version-${assetId}`,
      contentSha256: assetId === ASSET_A_ID ? "a".repeat(64) : "b".repeat(64),
      sizeBytes,
    },
    storageEtag: null,
    storageState: "available" as const,
    storageMigratedAt: NOW,
    objectDeletedAt: null,
    lastStorageErrorCode: null,
  };
}

function mutateReference(mutator: (reference: Record<string, unknown>) => void): unknown {
  const value = structuredClone(createInput()) as unknown as Record<string, unknown>;
  const sections = value.sections as Record<string, unknown[]>;
  const asset = sections.imageAssets[0] as Record<string, unknown>;
  mutator(asset.objectReference as Record<string, unknown>);
  return value;
}

describe("backup-m15-artifact", () => {
  it("builds a valid artifact and sorts sections deterministically", () => {
    const artifact = buildBackupM15V1Artifact(createInput());

    expect(isBackupM15V1Artifact(artifact)).toBe(true);
    expect(artifact.sections.imageAssets.map(({ id }) => id)).toEqual([ASSET_A_ID, ASSET_B_ID]);
    expect(artifact.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("canonicalizes object keys independently of input property order", () => {
    expect(canonicalizeM15SortedJson({ z: 1, nested: { b: 2, a: 1 }, a: 0 }))
      .toBe(canonicalizeM15SortedJson({ a: 0, nested: { a: 1, b: 2 }, z: 1 }));
  });

  it("produces stable checksums and neutralizes the checksum field", () => {
    const artifact = buildBackupM15V1Artifact(createInput());
    const first = computeBackupM15V1Checksum(artifact);
    const second = computeBackupM15V1Checksum({ ...artifact, checksum: "f".repeat(64) });

    expect(first).toBe(second);
    expect(first).toBe(artifact.checksum);
  });

  it("round-trips through the strict parser", () => {
    const artifact = buildBackupM15V1Artifact(createInput());
    expect(parseBackupM15V1Artifact(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact);
  });

  it("gives semantically identical unordered inputs the same checksum", () => {
    const first = createInput();
    const second = createInput();
    second.sections.imageAssets.reverse();

    expect(buildBackupM15V1Artifact(first).checksum).toBe(buildBackupM15V1Artifact(second).checksum);
  });

  it("changes checksum when an object reference changes", () => {
    const first = buildBackupM15V1Artifact(createInput());
    const secondInput = createInput();
    secondInput.sections.imageAssets[0].objectReference.versionId = "changed-version";
    expect(buildBackupM15V1Artifact(secondInput).checksum).not.toBe(first.checksum);
  });

  it.each([
    ["invalid schema", (value: Record<string, unknown>) => { value.schemaVersion = "m13.v3"; }],
    ["missing version", (value: Record<string, unknown>) => { delete value.versionId; }],
    ["blank version", (value: Record<string, unknown>) => { value.versionId = "   "; }],
    ["invalid checksum", (value: Record<string, unknown>) => { value.contentSha256 = "A".repeat(64); }],
    ["zero size", (value: Record<string, unknown>) => { value.sizeBytes = 0; }],
    ["unsafe size", (value: Record<string, unknown>) => { value.sizeBytes = Number.MAX_SAFE_INTEGER + 1; }],
    ["invalid backend", (value: Record<string, unknown>) => { value.backend = "local"; }],
    ["invalid alias", (value: Record<string, unknown>) => { value.bucketAlias = "https://bucket.example"; }],
    ["invalid key", (value: Record<string, unknown>) => { value.key = "owners/private/photo.jpg"; }],
    ["physical endpoint", (value: Record<string, unknown>) => { value.endpoint = "https://s3.example"; }],
    ["physical bucket", (value: Record<string, unknown>) => { value.bucket = "physical-bucket"; }],
    ["public URL", (value: Record<string, unknown>) => { value.publicUrl = "https://example/photo.jpg"; }],
    ["credentials", (value: Record<string, unknown>) => { value.accessKeyId = "secret"; }],
    ["signed URL", (value: Record<string, unknown>) => { value.signedUrl = "https://example/signed"; }],
    ["legacy storagePath", (value: Record<string, unknown>) => { value.storagePath = "v1/owners/path"; }],
  ])("rejects %s", (name, mutate) => {
    const value: Record<string, unknown> = name === "invalid schema"
      ? structuredClone(createInput()) as unknown as Record<string, unknown>
      : mutateReference(mutate) as Record<string, unknown>;
    if (name === "invalid schema") mutate(value);
    expect(isBackupM15V1Artifact(value)).toBe(false);
  });

  it("rejects additional artifact fields", () => {
    const artifact = buildBackupM15V1Artifact(createInput()) as BackupM15V1Artifact & { endpoint?: string };
    artifact.endpoint = "https://s3.example";
    expect(isBackupM15V1Artifact(artifact)).toBe(false);
  });

  it("does not accept an M13 artifact", () => {
    const value = structuredClone(createInput()) as unknown as Record<string, unknown>;
    value.schemaVersion = "m13.v3";
    expect(isBackupM15V1Artifact(value)).toBe(false);
  });

  it("keeps M15 additive to the M13 artifact union", () => {
    expectTypeOf<BackupM15V1Artifact>().not.toMatchTypeOf<BackupV13Artifact>();
    expectTypeOf<BackupM15V1Artifact>().toMatchTypeOf<BackupRecoveryArtifact>();
    expectTypeOf<BackupV13Artifact>().toMatchTypeOf<BackupRecoveryArtifact>();
  });
});