import { describe, expect, it } from "vitest";

import type { BackupM15V2ArtifactInput } from "./backup-m15-v2-artifact";
import {
  BackupM15V2ArtifactError,
  buildBackupM15V2Artifact,
  canonicalizeM15V2,
  computeBackupM15V2Checksum,
  isBackupM15V2Artifact,
  M15_V2_CANONICAL_SERIALIZATION_VERSION,
  M15_V2_CHECKSUM_ALGORITHM,
  M15_V2_MAX_OBJECT_BYTES,
  M15_V2_SCHEMA_VERSION,
  parseBackupM15V2Artifact,
} from "./backup-m15-v2-artifact";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const LEGACY_ASSET_ID = "22222222-2222-4222-8222-222222222222";
const OBJECT_ASSET_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-07-28T20:00:00.000Z";
const SHA256_A = "a".repeat(64);
const SHA256_B = "b".repeat(64);
const DELETED_AT = "2026-07-28T21:00:00.000Z";
const RETENTION_AT = "2026-08-27T21:00:00.000Z";

function makeInput(): BackupM15V2ArtifactInput {
  return {
    schemaVersion: M15_V2_SCHEMA_VERSION,
    canonicalSerializationVersion: M15_V2_CANONICAL_SERIALIZATION_VERSION,
    checksumAlgorithm: M15_V2_CHECKSUM_ALGORITHM,
    checksum: null,
    backupId: "backup-m15-v2-1",
    ownerUserId: OWNER_ID,
    createdByUserId: OWNER_ID,
    label: "hybrid backup",
    createdAt: NOW,
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
      imageAssets: 2,
      imageAnalyses: 0,
      imageAnalysisReviews: 0,
      consultations: 0,
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
        consultations: 10000,
      },
    },
    sections: {
      clients: [],
      analyses: [],
      consultations: [],
      imageAssets: [
        {
          id: OBJECT_ASSET_ID,
          fileName: "object.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 200,
          ownerUserId: OWNER_ID,
          clientId: CLIENT_ID,
          exifStripped: true,
          normalizedOrientation: 1,
          uploadedAt: NOW,
          deletedAt: null,
          retentionDeletesAt: null,
          createdAt: NOW,
          updatedAt: NOW,
          storageKind: "object-backed",
          objectReference: {
            backend: "s3",
            bucketAlias: "primary-images",
            key: `v1/owners/${OWNER_ID}/assets/${OBJECT_ASSET_ID}/original`,
            versionId: "exact-version-1",
            contentSha256: SHA256_B,
            sizeBytes: 200,
          },
          storageEtag: "etag-1",
          storageState: "available",
          storageMigratedAt: NOW,
          objectDeletedAt: null,
          lastStorageErrorCode: null,
        },
        {
          id: LEGACY_ASSET_ID,
          fileName: "legacy.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 100,
          ownerUserId: OWNER_ID,
          clientId: CLIENT_ID,
          exifStripped: true,
          normalizedOrientation: 1,
          uploadedAt: NOW,
          deletedAt: null,
          retentionDeletesAt: null,
          createdAt: NOW,
          updatedAt: NOW,
          storageKind: "legacy-local",
          legacyReference: {
            backend: "local",
            rootAlias: "legacy-images",
            relativePath: `${OWNER_ID}/${LEGACY_ASSET_ID}/legacy.jpg`,
            contentSha256: SHA256_A,
            sizeBytes: 100,
          },
        },
      ],
      imageAnalyses: [],
      imageAnalysisReviews: [],
    },
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function imageAssets(input: BackupM15V2ArtifactInput): Array<Record<string, unknown>> {
  return input.sections.imageAssets as unknown as Array<Record<string, unknown>>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function setOnlyImageAssets(input: BackupM15V2ArtifactInput, indexes: number[]): void {
  input.sections.imageAssets = indexes.map((index) => clone(input.sections.imageAssets[index]));
  input.counts.imageAssets = indexes.length;
}

function addAllBusinessRows(input: BackupM15V2ArtifactInput): void {
  input.sections.clients.push({
    id: "client-row", fullName: "Client", email: null, phone: null, notes: null, deletedAt: null,
    ownerUserId: OWNER_ID, createdAt: NOW, updatedAt: NOW,
  });
  input.sections.analyses.push({
    id: "analysis-row", clientId: "missing-client", ownerUserId: OWNER_ID, goal: "cut", hairType: "straight",
    density: "medium", porosity: "medium", phase: "final", clarificationRound: 0, confidenceScore: 0.9,
    uncertaintyReasons: [], followUpQuestions: [], recommendations: [], safetyNotes: [], faceShape: null,
    headShape: null, hairLength: null, hairTexture: null, hairCondition: null, growthPattern: null,
    targetShape: null, technicalCutPlan: {}, clarificationAnswers: [], imageAssetId: "missing-asset",
    imageAnalysisId: "missing-image-analysis", m8DraftCreatedAt: null, m8FinalizedAt: null,
    createdAt: NOW, updatedAt: NOW,
  });
  input.sections.consultations.push({
    id: "consultation-row", ownerUserId: OWNER_ID, clientId: "missing-client", analysisId: "missing-analysis",
    summary: "summary", nextSteps: ["next"], createdAt: NOW,
  });
  input.sections.imageAnalyses.push({
    id: "image-analysis-row", assetId: "missing-asset", status: "completed", providerName: "provider",
    modelVersion: "v1", analysisPayload: {}, confidences: {}, unknownFields: [], warnings: [], limitations: [],
    consentTimestamp: NOW, deletedAt: null, retentionDeletesAt: null, createdAt: NOW, updatedAt: NOW,
  });
  input.sections.imageAnalysisReviews.push({
    id: "review-row", analysisId: "missing-image-analysis", reviewedByUserId: OWNER_ID,
    manualCorrections: {}, confirmationTimestamp: null, notes: null, createdAt: NOW, updatedAt: NOW,
  });
  input.counts.clients = 1;
  input.counts.analyses = 1;
  input.counts.consultations = 1;
  input.counts.imageAnalyses = 1;
  input.counts.imageAnalysisReviews = 1;
}

function expectCode(action: () => unknown, code: BackupM15V2ArtifactError["code"]): void {
  try {
    action();
    throw new Error("Expected the artifact operation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(BackupM15V2ArtifactError);
    expect((error as BackupM15V2ArtifactError).code).toBe(code);
    for (const sensitiveValue of [
      OWNER_ID, LEGACY_ASSET_ID, OBJECT_ASSET_ID, CLIENT_ID, "legacy.jpg",
      `${OWNER_ID}/${LEGACY_ASSET_ID}/legacy.jpg`,
      `v1/owners/${OWNER_ID}/assets/${OBJECT_ASSET_ID}/original`,
      "exact-version-1", SHA256_A, "https://secret.invalid", "secret-token", "secret-credential",
      "hybrid backup",
    ]) expect((error as Error).message).not.toContain(sensitiveValue);
    expect(error).not.toHaveProperty("cause");
    expect(error).not.toHaveProperty("details");
  }
}

describe("M15 v2 artifact core", () => {
  it("builds, sorts, checksums, parses, and clones a mixed artifact", () => {
    const input = makeInput();
    const artifact = buildBackupM15V2Artifact(input);

    expect(artifact.schemaVersion).toBe("m15.v2");
    expect(artifact.canonicalSerializationVersion).toBe("sorted-json-v2");
    expect(artifact.checksumAlgorithm).toBe("sha256");
    expect(artifact.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.sections.imageAssets.map(({ id }) => id)).toEqual([LEGACY_ASSET_ID, OBJECT_ASSET_ID]);
    expect(computeBackupM15V2Checksum(artifact)).toBe(artifact.checksum);
    expect(parseBackupM15V2Artifact(artifact)).toEqual(artifact);
    expect(isBackupM15V2Artifact(artifact)).toBe(true);

    input.label = "changed after build";
    expect(artifact.label).toBe("hybrid backup");
    const parsed = parseBackupM15V2Artifact(artifact);
    parsed.label = "changed after parse";
    expect(artifact.label).toBe("hybrid backup");
  });

  it("canonicalizes object keys recursively without reordering arrays", () => {
    expect(canonicalizeM15V2({ z: [{ b: 2, a: 1 }], a: true })).toBe('{"a":true,"z":[{"a":1,"b":2}]}');
  });

  it("produces the same artifact for either input section order", () => {
    const first = buildBackupM15V2Artifact(makeInput());
    const reversedInput = makeInput();
    reversedInput.sections.imageAssets.reverse();
    const second = buildBackupM15V2Artifact(reversedInput);
    expect(second).toEqual(first);
  });

  it("accepts local-only, object-only, zero-asset, and fully empty artifacts", () => {
    for (const indexes of [[1], [0], []] as const) {
      const input = makeInput();
      setOnlyImageAssets(input, [...indexes]);
      const artifact = buildBackupM15V2Artifact(input);
      expect(artifact.sections.imageAssets).toHaveLength(indexes.length);
      expect(parseBackupM15V2Artifact(artifact)).toEqual(artifact);
    }

    const empty = makeInput();
    setOnlyImageAssets(empty, []);
    expect(Object.values(buildBackupM15V2Artifact(empty).sections).every((section) => section.length === 0)).toBe(true);
  });

  it("accepts active and soft-deleted legacy rows and preserves nullable keys", () => {
    const active = makeInput();
    setOnlyImageAssets(active, [1]);
    const activeArtifact = buildBackupM15V2Artifact(active);
    expect(activeArtifact.sections.imageAssets[0]).toMatchObject({ deletedAt: null, retentionDeletesAt: null });

    const deleted = makeInput();
    setOnlyImageAssets(deleted, [1]);
    deleted.sections.imageAssets[0].deletedAt = DELETED_AT;
    deleted.sections.imageAssets[0].retentionDeletesAt = RETENTION_AT;
    const deletedArtifact = buildBackupM15V2Artifact(deleted);
    expect(deletedArtifact.sections.imageAssets[0]).toMatchObject({ deletedAt: DELETED_AT, retentionDeletesAt: RETENTION_AT });

    const object = buildBackupM15V2Artifact(makeInput()).sections.imageAssets[1];
    expect(object).toHaveProperty("storageEtag");
    expect(object).toHaveProperty("storageMigratedAt");
    expect(object).toHaveProperty("objectDeletedAt", null);
    expect(object).toHaveProperty("lastStorageErrorCode", null);
  });

  it("uses code-unit ordering for canonical keys and section rows", () => {
    expect(canonicalizeM15V2({ ä: 1, z: 2, A: 3 })).toBe('{"A":3,"z":2,"ä":1}');
    expect(["ä", "z"].sort((left, right) => left.localeCompare(right))).not.toEqual(["z", "ä"]);

    const input = makeInput();
    setOnlyImageAssets(input, []);
    input.sections.clients = [
      { id: "ä", fullName: "Unicode", email: null, phone: null, notes: null, deletedAt: null, ownerUserId: OWNER_ID, createdAt: NOW, updatedAt: NOW },
      { id: "z", fullName: "ASCII", email: null, phone: null, notes: null, deletedAt: null, ownerUserId: OWNER_ID, createdAt: NOW, updatedAt: NOW },
    ];
    input.counts.clients = 2;
    const artifact = buildBackupM15V2Artifact(input);
    expect(artifact.sections.clients.map(({ id }) => id)).toEqual(["z", "ä"]);
    expect(parseBackupM15V2Artifact(artifact)).toEqual(artifact);
  });

  it("rejects checksum tampering and unsorted parsed sections", () => {
    const artifact = buildBackupM15V2Artifact(makeInput());
    const tampered = clone(artifact);
    tampered.label = "tampered";
    expectCode(() => parseBackupM15V2Artifact(tampered), "M15_V2_CHECKSUM_MISMATCH");

    const unsorted = clone(artifact);
    unsorted.sections.imageAssets.reverse();
    expectCode(() => parseBackupM15V2Artifact(unsorted), "M15_V2_SECTION_ORDER_INVALID");
  });

  it("rejects wrong versions and unknown keys at every relevant boundary", () => {
    const wrongSchema = makeInput() as unknown as Record<string, unknown>;
    wrongSchema.schemaVersion = "m15.v1";
    expectCode(() => buildBackupM15V2Artifact(wrongSchema as unknown as BackupM15V2ArtifactInput), "M15_V2_SCHEMA_VERSION_MISMATCH");

    const unknownTop = makeInput() as unknown as Record<string, unknown>;
    unknownTop.storagePath = "forbidden";
    expectCode(() => buildBackupM15V2Artifact(unknownTop as unknown as BackupM15V2ArtifactInput), "M15_V2_FORBIDDEN_FIELD");

    const unknownRow = makeInput() as unknown as { sections: { imageAssets: Array<Record<string, unknown>> } };
    unknownRow.sections.imageAssets[0].storagePath = "forbidden";
    expectCode(() => buildBackupM15V2Artifact(unknownRow as unknown as BackupM15V2ArtifactInput), "M15_V2_FORBIDDEN_FIELD");

    const unknownReference = makeInput() as unknown as { sections: { imageAssets: Array<Record<string, unknown>> } };
    (unknownReference.sections.imageAssets[0].objectReference as Record<string, unknown>).url = "https://secret.invalid";
    expectCode(() => buildBackupM15V2Artifact(unknownReference as unknown as BackupM15V2ArtifactInput), "M15_V2_FORBIDDEN_FIELD");

    const missingReference = makeInput() as unknown as { sections: { imageAssets: Array<Record<string, unknown>> } };
    delete missingReference.sections.imageAssets[0].objectReference;
    expectCode(() => buildBackupM15V2Artifact(missingReference as unknown as BackupM15V2ArtifactInput), "M15_V2_STRUCTURE_INVALID");
  });

  it("rejects missing checksum, unknown/M13/v1 schemas, strings, and absent or contradictory discriminators", () => {
    const artifact = buildBackupM15V2Artifact(makeInput()) as unknown as Record<string, unknown>;
    delete artifact.checksum;
    expectCode(() => parseBackupM15V2Artifact(artifact), "M15_V2_STRUCTURE_INVALID");

    for (const schemaVersion of ["m99.v1"]) {
      const input = makeInput() as unknown as Record<string, unknown>;
      input.schemaVersion = schemaVersion;
      expectCode(() => buildBackupM15V2Artifact(input as unknown as BackupM15V2ArtifactInput), "M15_V2_SCHEMA_VERSION_MISMATCH");
    }
    const m13Artifact = makeInput() as unknown as Record<string, unknown>;
    m13Artifact.schemaVersion = "m13.v3";
    m13Artifact.canonicalSerializationVersion = "sorted-json-v1";
    asRecord(asRecord(m13Artifact.sections).imageAssets).length = 0;
    expectCode(() => parseBackupM15V2Artifact(m13Artifact), "M15_V2_SCHEMA_VERSION_MISMATCH");

    const m15V1Artifact = makeInput() as unknown as Record<string, unknown>;
    m15V1Artifact.schemaVersion = "m15.v1";
    m15V1Artifact.canonicalSerializationVersion = "sorted-json-v1";
    const m15V1Sections = asRecord(m15V1Artifact.sections);
    const m15V1Rows = m15V1Sections.imageAssets as Array<Record<string, unknown>>;
    m15V1Rows.splice(1, 1);
    delete m15V1Rows[0].storageKind;
    expectCode(() => parseBackupM15V2Artifact(m15V1Artifact), "M15_V2_SCHEMA_VERSION_MISMATCH");
    expectCode(() => parseBackupM15V2Artifact("artifact-json"), "M15_V2_SCHEMA_INVALID");

    const absent = makeInput();
    delete imageAssets(absent)[0].storageKind;
    expectCode(() => buildBackupM15V2Artifact(absent), "M15_V2_STORAGE_KIND_UNKNOWN");

    const both = makeInput();
    imageAssets(both)[0].legacyReference = clone(imageAssets(both)[1].legacyReference);
    expectCode(() => buildBackupM15V2Artifact(both), "M15_V2_FORBIDDEN_FIELD");
  });

  it("does not mutate parser input after success or failure", () => {
    const artifact = buildBackupM15V2Artifact(makeInput());
    const beforeSuccess = clone(artifact);
    const parsed = parseBackupM15V2Artifact(artifact);
    expect(artifact).toEqual(beforeSuccess);
    parsed.label = "detached";
    expect(artifact).toEqual(beforeSuccess);

    const invalid = clone(artifact);
    invalid.label = "tampered";
    const beforeFailure = clone(invalid);
    expectCode(() => parseBackupM15V2Artifact(invalid), "M15_V2_CHECKSUM_MISMATCH");
    expect(invalid).toEqual(beforeFailure);
  });

  it("enforces exact keys for root metadata containers", () => {
    const cases: Array<[string, (input: BackupM15V2ArtifactInput) => Record<string, unknown>]> = [
      ["artifact root", (input) => input as unknown as Record<string, unknown>],
      ["summary", (input) => input.summarySnapshot as unknown as Record<string, unknown>],
      ["counts", (input) => input.counts as unknown as Record<string, unknown>],
      ["limits", (input) => input.limits as unknown as Record<string, unknown>],
      ["max rows", (input) => input.limits.maxRowsPerSection as unknown as Record<string, unknown>],
      ["sections", (input) => input.sections as unknown as Record<string, unknown>],
    ];
    const requiredKeys = ["backupId", "clientsCount", "clients", "maxArtifactBytes", "clients", "clients"];
    cases.forEach(([name, select], index) => {
      const missing = makeInput();
      delete select(missing)[requiredKeys[index]];
      expectCode(() => buildBackupM15V2Artifact(missing), "M15_V2_STRUCTURE_INVALID");
      const extra = makeInput();
      select(extra)[`extra_${name.replace(" ", "_")}`] = true;
      expectCode(() => buildBackupM15V2Artifact(extra), "M15_V2_FORBIDDEN_FIELD");
    });
  });

  it("enforces exact keys for every business row and reference level", () => {
    const cases: Array<[string, (input: BackupM15V2ArtifactInput) => Record<string, unknown>, string]> = [
      ["client", (input) => asRecord(input.sections.clients[0]), "fullName"],
      ["analysis", (input) => asRecord(input.sections.analyses[0]), "goal"],
      ["consultation", (input) => asRecord(input.sections.consultations[0]), "summary"],
      ["common image asset", (input) => imageAssets(input)[0], "fileName"],
      ["legacy row", (input) => imageAssets(input)[1], "legacyReference"],
      ["object row", (input) => imageAssets(input)[0], "objectReference"],
      ["image analysis", (input) => asRecord(input.sections.imageAnalyses[0]), "status"],
      ["review", (input) => asRecord(input.sections.imageAnalysisReviews[0]), "notes"],
      ["legacy reference", (input) => asRecord(imageAssets(input)[1].legacyReference), "backend"],
      ["object reference", (input) => asRecord(imageAssets(input)[0].objectReference), "backend"],
    ];
    for (const [name, select, requiredKey] of cases) {
      const missing = makeInput();
      addAllBusinessRows(missing);
      delete select(missing)[requiredKey];
      expectCode(() => buildBackupM15V2Artifact(missing), "M15_V2_STRUCTURE_INVALID");
      const extra = makeInput();
      addAllBusinessRows(extra);
      select(extra)[`extra_${name.replaceAll(" ", "_")}`] = true;
      expectCode(() => buildBackupM15V2Artifact(extra), "M15_V2_FORBIDDEN_FIELD");
    }
  });

  it("rejects every prohibited provider field", () => {
    for (const field of ["storagePath", "bucket", "endpoint", "credential", "token", "publicUrl", "presignedUrl"]) {
      const input = makeInput();
      imageAssets(input)[0][field] = field === "storagePath" ? "C:/secret" : "secret-value";
      expectCode(() => buildBackupM15V2Artifact(input), "M15_V2_FORBIDDEN_FIELD");
    }
  });

  it("rejects ambiguous or unsafe legacy paths", () => {
    for (const relativePath of [
      `/${OWNER_ID}/${LEGACY_ASSET_ID}/legacy.jpg`,
      `C:/${OWNER_ID}/${LEGACY_ASSET_ID}/legacy.jpg`,
      `${OWNER_ID}\\${LEGACY_ASSET_ID}\\legacy.jpg`,
      `${OWNER_ID}//${LEGACY_ASSET_ID}/legacy.jpg`,
      `${OWNER_ID}/./legacy.jpg`,
      `${OWNER_ID}/${LEGACY_ASSET_ID}/../legacy.jpg`,
      `${OWNER_ID}/${LEGACY_ASSET_ID}/extra/legacy.jpg`,
      `${OWNER_ID}/${OBJECT_ASSET_ID}/legacy.jpg`,
      `55555555-5555-4555-8555-555555555555/${LEGACY_ASSET_ID}/legacy.jpg`,
      `${OWNER_ID}/${LEGACY_ASSET_ID}/bad\u0000name.jpg`,
      `${OWNER_ID}/${LEGACY_ASSET_ID}/bad\u001fname.jpg`,
      `${OWNER_ID}/${LEGACY_ASSET_ID}/`,
      `${OWNER_ID}/${LEGACY_ASSET_ID}/${"a".repeat(256)}`,
      `${OWNER_ID}/${LEGACY_ASSET_ID}/e\u0301.jpg`,
    ]) {
      const input = makeInput();
      const legacy = input.sections.imageAssets[1];
      if (legacy.storageKind !== "legacy-local") throw new Error("Invalid test fixture.");
      legacy.legacyReference.relativePath = relativePath;
      expectCode(() => buildBackupM15V2Artifact(input), "M15_V2_LEGACY_REFERENCE_INVALID");
    }
  });

  it("rejects missing exact object versions, derived-key mismatch, and unknown storage kinds", () => {
    const missingVersion = makeInput();
    const objectAsset = missingVersion.sections.imageAssets[0];
    if (objectAsset.storageKind !== "object-backed") throw new Error("Invalid test fixture.");
    objectAsset.objectReference.versionId = "";
    expectCode(() => buildBackupM15V2Artifact(missingVersion), "M15_V2_OBJECT_REFERENCE_INVALID");

    const wrongKey = makeInput();
    const wrongKeyAsset = wrongKey.sections.imageAssets[0];
    if (wrongKeyAsset.storageKind !== "object-backed") throw new Error("Invalid test fixture.");
    wrongKeyAsset.objectReference.key = "v1/owners/other/assets/other/original";
    expectCode(() => buildBackupM15V2Artifact(wrongKey), "M15_V2_OBJECT_REFERENCE_INVALID");

    const unknownKind = makeInput() as unknown as { sections: { imageAssets: Array<Record<string, unknown>> } };
    unknownKind.sections.imageAssets[0].storageKind = "filesystem";
    expectCode(() => buildBackupM15V2Artifact(unknownKind as unknown as BackupM15V2ArtifactInput), "M15_V2_STORAGE_KIND_UNKNOWN");
  });

  it("enforces every object-reference field and approved bound", () => {
    const boundary = makeInput();
    const boundaryRow = boundary.sections.imageAssets[0];
    if (boundaryRow.storageKind !== "object-backed") throw new Error("Invalid test fixture.");
    boundaryRow.objectReference.bucketAlias = "a".repeat(64);
    boundaryRow.objectReference.versionId = "v".repeat(1024);
    expect(buildBackupM15V2Artifact(boundary).sections.imageAssets).toHaveLength(2);

    const cases: Array<[string, (row: Record<string, unknown>, reference: Record<string, unknown>) => void]> = [
      ["invalid alias", (_row, reference) => { reference.bucketAlias = "invalid alias"; }],
      ["alias over 64", (_row, reference) => { reference.bucketAlias = "a".repeat(65); }],
      ["invalid key", (_row, reference) => { reference.key = "invalid"; }],
      ["owner mismatch", (_row, reference) => { reference.key = `v1/owners/55555555-5555-4555-8555-555555555555/assets/${OBJECT_ASSET_ID}/original`; }],
      ["asset mismatch", (_row, reference) => { reference.key = `v1/owners/${OWNER_ID}/assets/${LEGACY_ASSET_ID}/original`; }],
      ["empty version", (_row, reference) => { reference.versionId = ""; }],
      ["control version", (_row, reference) => { reference.versionId = "version\u001f"; }],
      ["version over 1024", (_row, reference) => { reference.versionId = "v".repeat(1025); }],
      ["short SHA", (_row, reference) => { reference.contentSha256 = "a".repeat(63); }],
      ["uppercase SHA", (_row, reference) => { reference.contentSha256 = SHA256_B.toUpperCase(); }],
      ["zero size", (row, reference) => { row.sizeBytes = 0; reference.sizeBytes = 0; }],
      ["negative size", (row, reference) => { row.sizeBytes = -1; reference.sizeBytes = -1; }],
      ["oversized", (row, reference) => { row.sizeBytes = M15_V2_MAX_OBJECT_BYTES + 1; reference.sizeBytes = M15_V2_MAX_OBJECT_BYTES + 1; }],
      ["size mismatch", (_row, reference) => { reference.sizeBytes = 201; }],
    ];
    for (const [, mutate] of cases) {
      const input = makeInput();
      const row = imageAssets(input)[0];
      mutate(row, asRecord(row.objectReference));
      expect(() => buildBackupM15V2Artifact(input)).toThrow(BackupM15V2ArtifactError);
    }
  });

  it("accepts coherent available and delete_pending object lifecycle", () => {
    const available = buildBackupM15V2Artifact(makeInput()).sections.imageAssets.find((row) => row.storageKind === "object-backed");
    expect(available).toMatchObject({
      storageState: "available", deletedAt: null, retentionDeletesAt: null, objectDeletedAt: null,
    });

    const pending = makeInput();
    const pendingRow = pending.sections.imageAssets[0];
    if (pendingRow.storageKind !== "object-backed") throw new Error("Invalid test fixture.");
    pendingRow.storageState = "delete_pending";
    pendingRow.deletedAt = DELETED_AT;
    pendingRow.retentionDeletesAt = RETENTION_AT;
    const pendingArtifact = buildBackupM15V2Artifact(pending);
    expect(pendingArtifact.sections.imageAssets.find((row) => row.storageKind === "object-backed")).toMatchObject({
      storageState: "delete_pending", deletedAt: DELETED_AT, retentionDeletesAt: RETENTION_AT, objectDeletedAt: null,
    });
  });

  it("rejects every incoherent object lifecycle", () => {
    const cases: Array<[string, (row: Record<string, unknown>) => void, BackupM15V2ArtifactError["code"]]> = [
      ["available deleted", (row) => { row.deletedAt = DELETED_AT; }, "M15_V2_STRUCTURE_INVALID"],
      ["available retained", (row) => { row.retentionDeletesAt = RETENTION_AT; }, "M15_V2_STRUCTURE_INVALID"],
      ["available object deleted", (row) => { row.objectDeletedAt = DELETED_AT; }, "M15_V2_STRUCTURE_INVALID"],
      ["pending missing deleted", (row) => { row.storageState = "delete_pending"; row.retentionDeletesAt = RETENTION_AT; }, "M15_V2_TIMESTAMP_INVALID"],
      ["pending missing retention", (row) => { row.storageState = "delete_pending"; row.deletedAt = DELETED_AT; }, "M15_V2_TIMESTAMP_INVALID"],
      ["pending equal", (row) => { row.storageState = "delete_pending"; row.deletedAt = DELETED_AT; row.retentionDeletesAt = DELETED_AT; }, "M15_V2_TIMESTAMP_INVALID"],
      ["pending reversed", (row) => { row.storageState = "delete_pending"; row.deletedAt = RETENTION_AT; row.retentionDeletesAt = DELETED_AT; }, "M15_V2_TIMESTAMP_INVALID"],
      ["pending bad timestamp", (row) => { row.storageState = "delete_pending"; row.deletedAt = "invalid"; row.retentionDeletesAt = RETENTION_AT; }, "M15_V2_TIMESTAMP_INVALID"],
      ["pending non-ISO timestamp", (row) => { row.storageState = "delete_pending"; row.deletedAt = "2026-07-28"; row.retentionDeletesAt = RETENTION_AT; }, "M15_V2_TIMESTAMP_INVALID"],
      ["pending object deleted", (row) => { row.storageState = "delete_pending"; row.deletedAt = DELETED_AT; row.retentionDeletesAt = RETENTION_AT; row.objectDeletedAt = RETENTION_AT; }, "M15_V2_STRUCTURE_INVALID"],
      ["pending_upload", (row) => { row.storageState = "pending_upload"; }, "M15_V2_STRUCTURE_INVALID"],
      ["quarantined", (row) => { row.storageState = "quarantined"; }, "M15_V2_STRUCTURE_INVALID"],
      ["deleted", (row) => { row.storageState = "deleted"; }, "M15_V2_STRUCTURE_INVALID"],
      ["unknown", (row) => { row.storageState = "unknown"; }, "M15_V2_STRUCTURE_INVALID"],
    ];
    for (const [, mutate, code] of cases) {
      const input = makeInput();
      mutate(imageAssets(input)[0]);
      expectCode(() => buildBackupM15V2Artifact(input), code);
    }
  });

  it("enforces object lifecycle, size, hash, and sanitized error-code semantics", () => {
    const pendingWithoutDeletion = makeInput();
    const pendingAsset = pendingWithoutDeletion.sections.imageAssets[0];
    if (pendingAsset.storageKind !== "object-backed") throw new Error("Invalid test fixture.");
    pendingAsset.storageState = "delete_pending";
    expectCode(() => buildBackupM15V2Artifact(pendingWithoutDeletion), "M15_V2_TIMESTAMP_INVALID");

    const invalidCode = makeInput();
    const invalidCodeAsset = invalidCode.sections.imageAssets[0];
    if (invalidCodeAsset.storageKind !== "object-backed") throw new Error("Invalid test fixture.");
    invalidCodeAsset.lastStorageErrorCode = "s3://secret-bucket/private-key";
    expectCode(() => buildBackupM15V2Artifact(invalidCode), "M15_V2_STRUCTURE_INVALID");

    const sizeMismatch = makeInput();
    const legacyAsset = sizeMismatch.sections.imageAssets[1];
    if (legacyAsset.storageKind !== "legacy-local") throw new Error("Invalid test fixture.");
    legacyAsset.legacyReference.sizeBytes += 1;
    expectCode(() => buildBackupM15V2Artifact(sizeMismatch), "M15_V2_LEGACY_REFERENCE_INVALID");

    const uppercaseHash = makeInput();
    const uppercaseAsset = uppercaseHash.sections.imageAssets[0];
    if (uppercaseAsset.storageKind !== "object-backed") throw new Error("Invalid test fixture.");
    uppercaseAsset.objectReference.contentSha256 = SHA256_B.toUpperCase();
    expectCode(() => buildBackupM15V2Artifact(uppercaseHash), "M15_V2_OBJECT_REFERENCE_INVALID");
  });

  it("rejects duplicate record and external identities", () => {
    const duplicateId = makeInput();
    duplicateId.sections.imageAssets.push(clone(duplicateId.sections.imageAssets[0]));
    duplicateId.counts.imageAssets += 1;
    expectCode(() => buildBackupM15V2Artifact(duplicateId), "M15_V2_DUPLICATE_ID");

    const duplicateExternal = makeInput();
    const duplicate = clone(duplicateExternal.sections.imageAssets[0]);
    duplicate.id = "55555555-5555-4555-8555-555555555555";
    if (duplicate.storageKind !== "object-backed") throw new Error("Invalid test fixture.");
    duplicateExternal.sections.imageAssets.push(duplicate);
    duplicateExternal.counts.imageAssets += 1;
    expectCode(() => buildBackupM15V2Artifact(duplicateExternal), "M15_V2_DUPLICATE_EXTERNAL_IDENTITY");
  });

  it("rejects duplicate IDs in every section", () => {
    const sections = ["clients", "analyses", "consultations", "imageAssets", "imageAnalyses", "imageAnalysisReviews"] as const;
    for (const section of sections) {
      const input = makeInput();
      addAllBusinessRows(input);
      const rows = input.sections[section] as Array<{ id: string }>;
      rows.push(clone(rows[0]));
      input.counts[section] += 1;
      expectCode(() => buildBackupM15V2Artifact(input), "M15_V2_DUPLICATE_ID");
    }
  });

  it("rejects duplicate legacy and object-backed external identities structurally", () => {
    const legacyInput = makeInput();
    const legacyDuplicate = clone(legacyInput.sections.imageAssets[1]);
    legacyDuplicate.id = "55555555-5555-4555-8555-555555555555";
    legacyInput.sections.imageAssets.push(legacyDuplicate);
    legacyInput.counts.imageAssets += 1;
    expectCode(() => buildBackupM15V2Artifact(legacyInput), "M15_V2_DUPLICATE_EXTERNAL_IDENTITY");

    const objectInput = makeInput();
    const objectDuplicate = clone(objectInput.sections.imageAssets[0]);
    objectDuplicate.id = "66666666-6666-4666-8666-666666666666";
    objectInput.sections.imageAssets.push(objectDuplicate);
    objectInput.counts.imageAssets += 1;
    expectCode(() => buildBackupM15V2Artifact(objectInput), "M15_V2_DUPLICATE_EXTERNAL_IDENTITY");
  });

  it("rejects owner and count mismatches", () => {
    const wrongOwner = makeInput();
    wrongOwner.sections.imageAssets[0].ownerUserId = "55555555-5555-4555-8555-555555555555";
    expectCode(() => buildBackupM15V2Artifact(wrongOwner), "M15_V2_OWNER_SCOPE_MISMATCH");

    const wrongCount = makeInput();
    wrongCount.counts.imageAssets = 1;
    expectCode(() => buildBackupM15V2Artifact(wrongCount), "M15_V2_COUNT_MISMATCH");
  });

  it("tests every remaining producible error code directly", () => {
    const invalidSchema = makeInput();
    invalidSchema.canonicalSerializationVersion = "invalid" as "sorted-json-v2";
    expectCode(() => buildBackupM15V2Artifact(invalidSchema), "M15_V2_SCHEMA_INVALID");

    const invalidNumber = makeInput();
    invalidNumber.sections.imageAssets[0].normalizedOrientation = 1.5;
    expectCode(() => buildBackupM15V2Artifact(invalidNumber), "M15_V2_NUMERIC_BOUNDS_INVALID");

    const exceeded = makeInput();
    exceeded.limits.maxArtifactBytes = 1;
    expectCode(() => buildBackupM15V2Artifact(exceeded), "M15_V2_LIMIT_EXCEEDED");
  });

  it("enforces approved basename and artifact/section byte limits", () => {
    const boundary = makeInput();
    setOnlyImageAssets(boundary, [1]);
    const boundaryRow = boundary.sections.imageAssets[0];
    if (boundaryRow.storageKind !== "legacy-local") throw new Error("Invalid test fixture.");
    boundaryRow.legacyReference.relativePath = `${OWNER_ID}/${LEGACY_ASSET_ID}/${"a".repeat(255)}`;
    expect(buildBackupM15V2Artifact(boundary).sections.imageAssets).toHaveLength(1);

    const sectionExceeded = makeInput();
    sectionExceeded.limits.maxSectionBytes = 1;
    expectCode(() => buildBackupM15V2Artifact(sectionExceeded), "M15_V2_LIMIT_EXCEEDED");
  });

  it("does not mutate builder input after success or failure", () => {
    const valid = makeInput();
    const beforeSuccess = clone(valid);
    buildBackupM15V2Artifact(valid);
    expect(valid).toEqual(beforeSuccess);

    const invalid = makeInput();
    invalid.counts.imageAssets = 99;
    const beforeFailure = clone(invalid);
    expectCode(() => buildBackupM15V2Artifact(invalid), "M15_V2_COUNT_MISMATCH");
    expect(invalid).toEqual(beforeFailure);
  });

  it("leaves cross-section graph validation to WP2H3", () => {
    const input = makeInput();
    addAllBusinessRows(input);
    const artifact = buildBackupM15V2Artifact(input);
    expect(artifact.sections.analyses[0]).toMatchObject({
      clientId: "missing-client", imageAssetId: "missing-asset", imageAnalysisId: "missing-image-analysis",
    });
    expect(artifact.sections.consultations[0]).toMatchObject({ clientId: "missing-client", analysisId: "missing-analysis" });
    expect(artifact.sections.imageAnalyses[0].assetId).toBe("missing-asset");
    expect(artifact.sections.imageAnalysisReviews[0].analysisId).toBe("missing-image-analysis");
  });

  it("rejects non-JSON values, cycles, sparse arrays, and numeric edge cases", () => {
    expectCode(() => canonicalizeM15V2({ value: undefined }), "M15_V2_JSON_INVALID");
    expectCode(() => canonicalizeM15V2({ value: Number.NaN }), "M15_V2_JSON_INVALID");
    expectCode(() => canonicalizeM15V2({ value: Number.POSITIVE_INFINITY }), "M15_V2_JSON_INVALID");
    expectCode(() => canonicalizeM15V2({ value: Number.NEGATIVE_INFINITY }), "M15_V2_JSON_INVALID");
    expectCode(() => canonicalizeM15V2({ value: -0 }), "M15_V2_JSON_INVALID");
    expectCode(() => canonicalizeM15V2({ value: BigInt(1) }), "M15_V2_JSON_INVALID");
    expectCode(() => canonicalizeM15V2({ value: () => "not-json" }), "M15_V2_JSON_INVALID");
    expectCode(() => canonicalizeM15V2({ value: Symbol("not-json") }), "M15_V2_JSON_INVALID");
    expectCode(() => canonicalizeM15V2(new Date(NOW)), "M15_V2_JSON_INVALID");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expectCode(() => canonicalizeM15V2(cyclic), "M15_V2_JSON_INVALID");
    const sparse = new Array(2);
    sparse[1] = "present";
    expectCode(() => canonicalizeM15V2(sparse), "M15_V2_JSON_INVALID");
  });

  it("returns false instead of throwing from the type guard", () => {
    expect(isBackupM15V2Artifact(null)).toBe(false);
    expect(isBackupM15V2Artifact(makeInput())).toBe(false);
    expect(isBackupM15V2Artifact(buildBackupM15V2Artifact(makeInput()))).toBe(true);
  });
});