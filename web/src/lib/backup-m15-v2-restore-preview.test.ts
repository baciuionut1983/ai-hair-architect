import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it, vi } from "vitest";

import {
  buildBackupM15V2Artifact,
  M15_V2_CANONICAL_SERIALIZATION_VERSION,
  M15_V2_CHECKSUM_ALGORITHM,
  M15_V2_SCHEMA_VERSION,
  type BackupM15V2ArtifactInput,
} from "./backup-m15-v2-artifact";
import {
  verifyBackupM15V2ExternalReferences,
  type BackupM15V2LegacyLocalReferenceIdentity,
  type BackupM15V2LegacyLocalReferenceResolver,
  type BackupM15V2ObjectBackedReferenceIdentity,
  type BackupM15V2ObjectBackedReferenceResolver,
  type BackupM15V2ResolvedLegacyLocalReferenceSource,
  type BackupM15V2ResolvedObjectBackedReferenceSource,
} from "./backup-m15-v2-external-reference-verifier";
import {
  buildBackupM15V2RestorePreview,
  M15_V2_RESTORE_PREVIEW_VERSION,
  type BackupM15V2RestorePreviewInput,
} from "./backup-m15-v2-restore-preview";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const ANALYSIS_ID = "66666666-6666-4666-8666-666666666666";
const CONSULTATION_ID = "77777777-7777-4777-8777-777777777777";
const LEGACY_ASSET_ID = "22222222-2222-4222-8222-222222222222";
const OBJECT_ASSET_ID = "33333333-3333-4333-8333-333333333333";
const IMAGE_ANALYSIS_ID = "88888888-8888-4888-8888-888888888888";
const REVIEW_ID = "99999999-9999-4999-8999-999999999999";
const BACKUP_ID = "backup-m15-v2-restore-preview-1";
const NOW = "2026-07-28T20:00:00.000Z";
const LATER = "2026-07-29T09:00:00.000Z";
const PREVIEWED_AT = "2026-07-29T10:00:00.000Z";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function streamChunks(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
  const queue = [...chunks];
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = queue.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        onCancel?.();
      },
    },
    { highWaterMark: 0 },
  );
}

function legacyRelativePath(id: string): string {
  return `${OWNER_ID}/${id}/${id}.jpg`;
}

function objectKey(id: string): string {
  return `v1/owners/${OWNER_ID}/assets/${id}/original`;
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    id: CLIENT_ID, fullName: "Client", email: null, phone: null, notes: null, deletedAt: null,
    ownerUserId: OWNER_ID, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    id: ANALYSIS_ID, clientId: CLIENT_ID, ownerUserId: OWNER_ID, goal: "cut", hairType: "straight",
    density: "medium", porosity: "medium", phase: "final", clarificationRound: 0, confidenceScore: 0.9,
    uncertaintyReasons: [], followUpQuestions: [], recommendations: [], safetyNotes: [], faceShape: null,
    headShape: null, hairLength: null, hairTexture: null, hairCondition: null, growthPattern: null,
    targetShape: null, technicalCutPlan: {}, clarificationAnswers: [], imageAssetId: null,
    imageAnalysisId: null, m8DraftCreatedAt: null, m8FinalizedAt: null, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

function consultation(overrides: Record<string, unknown> = {}) {
  return {
    id: CONSULTATION_ID, ownerUserId: OWNER_ID, clientId: CLIENT_ID, analysisId: ANALYSIS_ID,
    summary: "summary", nextSteps: ["next"], createdAt: NOW, ...overrides,
  };
}

function legacyAsset(id: string, body: Uint8Array, overrides: Record<string, unknown> = {}) {
  return {
    id, fileName: `${id}.jpg`, mimeType: "image/jpeg", sizeBytes: body.byteLength, ownerUserId: OWNER_ID,
    clientId: CLIENT_ID, exifStripped: true, normalizedOrientation: 1, uploadedAt: NOW, deletedAt: null,
    retentionDeletesAt: null, createdAt: NOW, updatedAt: NOW, storageKind: "legacy-local" as const,
    legacyReference: {
      backend: "local" as const, rootAlias: "legacy-images" as const, relativePath: legacyRelativePath(id),
      contentSha256: sha256(body), sizeBytes: body.byteLength,
    },
    ...overrides,
  };
}

function objectAsset(id: string, body: Uint8Array, versionId = `version-${id}`, overrides: Record<string, unknown> = {}) {
  return {
    id, fileName: `${id}.jpg`, mimeType: "image/jpeg", sizeBytes: body.byteLength, ownerUserId: OWNER_ID,
    clientId: CLIENT_ID, exifStripped: true, normalizedOrientation: 1, uploadedAt: NOW, deletedAt: null,
    retentionDeletesAt: null, createdAt: NOW, updatedAt: NOW, storageKind: "object-backed" as const,
    objectReference: {
      backend: "s3" as const, bucketAlias: "primary-images", key: objectKey(id), versionId,
      contentSha256: sha256(body), sizeBytes: body.byteLength,
    },
    storageEtag: "etag-1", storageState: "available" as const, storageMigratedAt: NOW, objectDeletedAt: null,
    lastStorageErrorCode: null,
    ...overrides,
  };
}

function imageAnalysisRow(overrides: Record<string, unknown> = {}) {
  return {
    id: IMAGE_ANALYSIS_ID, assetId: LEGACY_ASSET_ID, status: "completed", providerName: "provider",
    modelVersion: "v1", analysisPayload: {}, confidences: {}, unknownFields: [], warnings: [], limitations: [],
    consentTimestamp: NOW, deletedAt: null, retentionDeletesAt: null, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

function reviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REVIEW_ID, analysisId: IMAGE_ANALYSIS_ID, reviewedByUserId: OWNER_ID, manualCorrections: {},
    confirmationTimestamp: null, notes: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

interface SectionsInput {
  clients?: Array<Record<string, unknown>>;
  analyses?: Array<Record<string, unknown>>;
  consultations?: Array<Record<string, unknown>>;
  imageAssets?: Array<Record<string, unknown>>;
  imageAnalyses?: Array<Record<string, unknown>>;
  imageAnalysisReviews?: Array<Record<string, unknown>>;
}

function sections(overrides: SectionsInput = {}) {
  return {
    clients: overrides.clients ?? [client()],
    analyses: overrides.analyses ?? [analysis()],
    consultations: overrides.consultations ?? [consultation()],
    imageAssets: overrides.imageAssets ?? [],
    imageAnalyses: overrides.imageAnalyses ?? [],
    imageAnalysisReviews: overrides.imageAnalysisReviews ?? [],
  };
}

function buildArtifactInput(overrides: SectionsInput = {}): BackupM15V2ArtifactInput {
  const merged = sections(overrides);
  return {
    schemaVersion: M15_V2_SCHEMA_VERSION,
    canonicalSerializationVersion: M15_V2_CANONICAL_SERIALIZATION_VERSION,
    checksumAlgorithm: M15_V2_CHECKSUM_ALGORITHM,
    checksum: null,
    backupId: BACKUP_ID,
    ownerUserId: OWNER_ID,
    createdByUserId: OWNER_ID,
    label: "restore-preview-fixture",
    createdAt: NOW,
    summarySnapshot: { clientsCount: 0, consultationsCount: 0, appointmentsCount: 0, notificationsCount: 0, workspacesCount: 0 },
    counts: {
      clients: merged.clients.length,
      analyses: merged.analyses.length,
      consultations: merged.consultations.length,
      imageAssets: merged.imageAssets.length,
      imageAnalyses: merged.imageAnalyses.length,
      imageAnalysisReviews: merged.imageAnalysisReviews.length,
    },
    limits: {
      maxArtifactBytes: 8 * 1024 * 1024,
      maxSectionBytes: 2 * 1024 * 1024,
      maxRowsPerSection: { clients: 2000, analyses: 10000, consultations: 10000, imageAssets: 10000, imageAnalyses: 10000, imageAnalysisReviews: 20000 },
    },
    sections: merged,
  } as unknown as BackupM15V2ArtifactInput;
}

function buildArtifact(overrides: SectionsInput = {}) {
  return buildBackupM15V2Artifact(buildArtifactInput(overrides));
}

function legacyResolverFrom(
  entries: Map<string, () => BackupM15V2ResolvedLegacyLocalReferenceSource | null>,
): BackupM15V2LegacyLocalReferenceResolver {
  return {
    resolveLegacyLocalReference: vi.fn(async (identity: BackupM15V2LegacyLocalReferenceIdentity) => {
      const factory = entries.get(identity.relativePath);
      return factory ? factory() : null;
    }),
  };
}

function objectResolverFrom(
  entries: Map<string, () => BackupM15V2ResolvedObjectBackedReferenceSource | null>,
): BackupM15V2ObjectBackedReferenceResolver {
  return {
    resolveObjectBackedReference: vi.fn(async (identity: BackupM15V2ObjectBackedReferenceIdentity) => {
      const factory = entries.get(identity.key);
      return factory ? factory() : null;
    }),
  };
}

function validLegacySource(id: string, body: Uint8Array): BackupM15V2ResolvedLegacyLocalReferenceSource {
  return {
    rootAlias: "legacy-images",
    relativePath: legacyRelativePath(id),
    sizeBytes: body.byteLength,
    openStream: () => streamChunks([body]),
  };
}

function validObjectSource(id: string, body: Uint8Array, versionId = `version-${id}`): BackupM15V2ResolvedObjectBackedReferenceSource {
  return {
    bucketAlias: "primary-images",
    key: objectKey(id),
    versionId,
    sizeBytes: body.byteLength,
    openStream: () => streamChunks([body]),
  };
}

function noResolvers() {
  return {
    legacyLocalResolver: legacyResolverFrom(new Map()),
    objectBackedResolver: objectResolverFrom(new Map()),
  };
}

function baseInput(overrides: Partial<BackupM15V2RestorePreviewInput> = {}): BackupM15V2RestorePreviewInput {
  const artifact = buildArtifact();
  return {
    artifact,
    backupId: BACKUP_ID,
    ownerUserId: OWNER_ID,
    currentState: sections(),
    previewedAt: PREVIEWED_AT,
    legacyLocalResolver: legacyResolverFrom(new Map()),
    objectBackedResolver: objectResolverFrom(new Map()),
    verifyExternalReferences: verifyBackupM15V2ExternalReferences,
    ...overrides,
  };
}

describe("buildBackupM15V2RestorePreview", () => {
  it("1. fails closed with invalid_artifact for a structurally invalid artifact", async () => {
    const result = await buildBackupM15V2RestorePreview(baseInput({ artifact: { not: "an artifact" } }));
    expect(result).toMatchObject({ ok: false, code: "invalid_artifact", previewedAt: PREVIEWED_AT });
  });

  it("2. fails closed with invalid_current_state for a malformed current state", async () => {
    const result = await buildBackupM15V2RestorePreview(baseInput({ currentState: { not: "a state" } }));
    expect(result).toMatchObject({ ok: false, code: "invalid_current_state" });
  });

  it("3. verifies an artifact with zero external references", async () => {
    const result = await buildBackupM15V2RestorePreview(baseInput());
    expect(result).toMatchObject({ ok: true, verifiedExternalReferenceCount: 0, canRestore: true });
  });

  it("4. verifies a valid legacy-local reference", async () => {
    const body = new TextEncoder().encode("legacy-body");
    const artifact = buildArtifact({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({
        artifact,
        currentState: sections({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] }),
        legacyLocalResolver: legacyResolverFrom(new Map([[legacyRelativePath(LEGACY_ASSET_ID), () => validLegacySource(LEGACY_ASSET_ID, body)]])),
      }),
    );
    expect(result).toMatchObject({ ok: true, verifiedExternalReferenceCount: 1 });
  });

  it("5. verifies a valid object-backed reference", async () => {
    const body = new TextEncoder().encode("object-body");
    const artifact = buildArtifact({ imageAssets: [objectAsset(OBJECT_ASSET_ID, body)] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({
        artifact,
        currentState: sections({ imageAssets: [objectAsset(OBJECT_ASSET_ID, body)] }),
        objectBackedResolver: objectResolverFrom(new Map([[objectKey(OBJECT_ASSET_ID), () => validObjectSource(OBJECT_ASSET_ID, body)]])),
      }),
    );
    expect(result).toMatchObject({ ok: true, verifiedExternalReferenceCount: 1 });
  });

  it("6. verifies a mixed legacy-local and object-backed artifact", async () => {
    const legacyBody = new TextEncoder().encode("legacy-body");
    const objectBody = new TextEncoder().encode("object-body");
    const assets = [legacyAsset(LEGACY_ASSET_ID, legacyBody), objectAsset(OBJECT_ASSET_ID, objectBody)];
    const artifact = buildArtifact({ imageAssets: assets });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({
        artifact,
        currentState: sections({ imageAssets: assets }),
        legacyLocalResolver: legacyResolverFrom(new Map([[legacyRelativePath(LEGACY_ASSET_ID), () => validLegacySource(LEGACY_ASSET_ID, legacyBody)]])),
        objectBackedResolver: objectResolverFrom(new Map([[objectKey(OBJECT_ASSET_ID), () => validObjectSource(OBJECT_ASSET_ID, objectBody)]])),
      }),
    );
    expect(result).toMatchObject({ ok: true, verifiedExternalReferenceCount: 2 });
  });

  it("7. maps every distinct WP2H2 failure to the same stable external_reference_verification_failed code", async () => {
    const body = new TextEncoder().encode("legacy-body");
    const artifact = buildArtifact({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] });
    const currentState = sections({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] });

    const missing = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState, ...noResolvers() }),
    );
    expect(missing).toMatchObject({ ok: false, code: "external_reference_verification_failed" });

    const wrongBody = new TextEncoder().encode("different-body-value");
    const hashMismatch = await buildBackupM15V2RestorePreview(
      baseInput({
        artifact,
        currentState,
        legacyLocalResolver: legacyResolverFrom(new Map([[legacyRelativePath(LEGACY_ASSET_ID), () => validLegacySource(LEGACY_ASSET_ID, wrongBody)]])),
      }),
    );
    expect(hashMismatch).toMatchObject({ ok: false, code: "external_reference_verification_failed" });
  });

  it("8. does not bypass the real WP2H2 verifier", async () => {
    const body = new TextEncoder().encode("legacy-body");
    const artifact = buildArtifact({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({
        artifact,
        currentState: sections({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] }),
        ...noResolvers(),
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("9. a failed verifier closes the preview without section impacts or a fingerprint", async () => {
    const body = new TextEncoder().encode("legacy-body");
    const artifact = buildArtifact({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] }), ...noResolvers() }),
    );
    expect(result).not.toHaveProperty("sectionImpacts");
    expect(result).not.toHaveProperty("fingerprint");
  });

  it("10. computes wouldCreate when a backup row is absent from current state", async () => {
    const artifact = buildArtifact({ analyses: [analysis({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })], consultations: [] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ analyses: [], consultations: [] }) }),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.sectionImpacts.analyses).toMatchObject({ wouldCreate: 1, wouldReplace: 0, wouldDelete: 0, unchanged: 0 });
  });

  it("11. computes wouldReplace when the same id differs in content", async () => {
    const artifact = buildArtifact({ analyses: [analysis({ goal: "color" })] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ analyses: [analysis({ goal: "cut" })] }) }),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.sectionImpacts.analyses).toMatchObject({ wouldReplace: 1, unchanged: 0 });
  });

  it("12. computes wouldDelete when current state has a row absent from the backup", async () => {
    const extra = analysis({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const artifact = buildArtifact({ analyses: [], consultations: [] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ analyses: [extra], consultations: [] }) }),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.sectionImpacts.analyses).toMatchObject({ wouldDelete: 1 });
  });

  it("13. computes unchanged when a row is identical on both sides", async () => {
    const artifact = buildArtifact({ analyses: [analysis()] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ analyses: [analysis()] }) }),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.sectionImpacts.analyses).toMatchObject({ unchanged: 1, wouldCreate: 0, wouldReplace: 0, wouldDelete: 0 });
  });

  it("14. reports conflictCount=1 exactly when wouldDelete>0", async () => {
    const extra = analysis({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const artifact = buildArtifact({ analyses: [], consultations: [] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ analyses: [extra], consultations: [] }) }),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.sectionImpacts.analyses.conflictCount).toBe(1);
  });

  it("15. reports impacts for all six domains", async () => {
    const legacyBody = new TextEncoder().encode("legacy-body");
    const artifact = buildArtifact({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, legacyBody)], imageAnalyses: [imageAnalysisRow()], imageAnalysisReviews: [reviewRow()] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({
        artifact,
        currentState: sections({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, legacyBody)], imageAnalyses: [imageAnalysisRow()], imageAnalysisReviews: [reviewRow()] }),
        legacyLocalResolver: legacyResolverFrom(new Map([[legacyRelativePath(LEGACY_ASSET_ID), () => validLegacySource(LEGACY_ASSET_ID, legacyBody)]])),
      }),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(Object.keys(result.sectionImpacts).sort()).toEqual(
        ["analyses", "clients", "consultations", "imageAnalyses", "imageAnalysisReviews", "imageAssets"],
      );
    }
  });

  it("16. reports correct aggregate summary counters", async () => {
    const createdOnly = analysis({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const artifact = buildArtifact({ analyses: [analysis(), createdOnly] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ analyses: [analysis()] }) }),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.summary.totalWouldCreate).toBe(1);
      expect(result.summary.totalUnchanged).toBeGreaterThanOrEqual(1);
      expect(result.summary.totalBackupRows).toBe(result.summary.totalWouldCreate + result.summary.totalUnchanged + result.summary.totalWouldReplace);
    }
  });

  it("17. canRestore is true when there are no blockers", async () => {
    const result = await buildBackupM15V2RestorePreview(baseInput());
    expect(result).toMatchObject({ ok: true, canRestore: true, blockingReasons: [] });
  });

  it("18. canRestore is false when a blocking conflict exists", async () => {
    const extra = analysis({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const artifact = buildArtifact({ analyses: [], consultations: [] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ analyses: [extra], consultations: [] }) }),
    );
    expect(result).toMatchObject({ ok: true, canRestore: false });
    if (result.ok) expect(result.blockingReasons).toHaveLength(1);
  });

  it("19. a warning does not block restoration", async () => {
    const artifact = buildArtifact({ analyses: [analysis({ updatedAt: NOW })] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ analyses: [analysis({ updatedAt: LATER })] }) }),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.canRestore).toBe(true);
    }
  });

  it("20. warns when the backup is older than current state", async () => {
    const artifact = buildArtifact({ analyses: [analysis({ updatedAt: NOW })] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ analyses: [analysis({ updatedAt: LATER })] }) }),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.warnings).toContainEqual(expect.objectContaining({ code: "STALE_BACKUP" }));
  });

  it("21. does not warn when backup and current timestamps are exactly equal (staleness boundary)", async () => {
    const artifact = buildArtifact({ analyses: [analysis({ updatedAt: NOW })] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ analyses: [analysis({ updatedAt: NOW })] }) }),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it("22. injects previewedAt into both success and failure results", async () => {
    const ok = await buildBackupM15V2RestorePreview(baseInput());
    expect(ok.previewedAt).toBe(PREVIEWED_AT);
    const failed = await buildBackupM15V2RestorePreview(baseInput({ artifact: { not: "valid" } }));
    expect(failed.previewedAt).toBe(PREVIEWED_AT);
  });

  it("23. never calls Date.now internally", async () => {
    const spy = vi.spyOn(Date, "now");
    await buildBackupM15V2RestorePreview(baseInput());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("24. produces deterministic section impacts regardless of input array order", async () => {
    const rows = [analysis({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), analysis()];
    const artifactA = buildArtifact({ analyses: rows });
    const artifactB = buildArtifact({ analyses: [...rows].reverse() });
    const currentState = sections({ analyses: [...rows].reverse() });
    const resultA = await buildBackupM15V2RestorePreview(baseInput({ artifact: artifactA, currentState }));
    const resultB = await buildBackupM15V2RestorePreview(baseInput({ artifact: artifactB, currentState }));
    expect(resultA).toEqual(resultB);
  });

  it("25. does not mutate the input artifact", async () => {
    const artifact = buildArtifact({ analyses: [analysis()] });
    const before = structuredClone(artifact);
    await buildBackupM15V2RestorePreview(baseInput({ artifact }));
    expect(artifact).toEqual(before);
  });

  it("26. does not mutate the current state", async () => {
    const currentState = sections({ analyses: [analysis()] });
    const before = structuredClone(currentState);
    await buildBackupM15V2RestorePreview(baseInput({ currentState }));
    expect(currentState).toEqual(before);
  });

  it("27. returns identical results for repeated calls with the same input and dependencies", async () => {
    const input = baseInput();
    const first = await buildBackupM15V2RestorePreview(input);
    const second = await buildBackupM15V2RestorePreview(input);
    expect(first).toEqual(second);
  });

  it("28. produces a stable fingerprint across repeated calls", async () => {
    const first = await buildBackupM15V2RestorePreview(baseInput());
    const second = await buildBackupM15V2RestorePreview(baseInput());
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("29. changes the fingerprint when the semantic comparison changes", async () => {
    const first = await buildBackupM15V2RestorePreview(baseInput());
    const artifact = buildArtifact({ analyses: [analysis({ goal: "color" })] });
    const second = await buildBackupM15V2RestorePreview(baseInput({ artifact, currentState: sections({ analyses: [analysis({ goal: "cut" })] }) }));
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it("30. does not change the fingerprint due to input array ordering", async () => {
    const rows = [analysis({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), analysis()];
    const artifactA = buildArtifact({ analyses: rows });
    const artifactB = buildArtifact({ analyses: [...rows].reverse() });
    const currentState = sections({ analyses: rows });
    const resultA = await buildBackupM15V2RestorePreview(baseInput({ artifact: artifactA, currentState }));
    const resultB = await buildBackupM15V2RestorePreview(baseInput({ artifact: artifactB, currentState }));
    expect(resultA.ok && resultB.ok).toBe(true);
    if (resultA.ok && resultB.ok) expect(resultA.fingerprint).toBe(resultB.fingerprint);
  });

  it("31. uses the exact namespace m15.restore-preview.v2", async () => {
    expect(M15_V2_RESTORE_PREVIEW_VERSION).toBe("m15.restore-preview.v2");
    const ok = await buildBackupM15V2RestorePreview(baseInput());
    expect(ok.previewVersion).toBe("m15.restore-preview.v2");
    const failed = await buildBackupM15V2RestorePreview(baseInput({ artifact: { not: "valid" } }));
    expect(failed.previewVersion).toBe("m15.restore-preview.v2");
  });

  it("32. is isolated from the m15.restore-preview.v1 namespace", async () => {
    const result = await buildBackupM15V2RestorePreview(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const v1StylePayload = {
      previewVersion: "m15.restore-preview.v1",
      backupId: BACKUP_ID,
      ownerUserId: OWNER_ID,
      artifactVersion: "m15.v2",
      canRestore: result.canRestore,
      blockingReasons: result.blockingReasons,
      warnings: result.warnings,
      sectionImpacts: result.sectionImpacts,
      summary: result.summary,
      verifiedExternalReferenceCount: result.verifiedExternalReferenceCount,
    };
    const v1StyleHash = createHash("sha256").update(JSON.stringify(v1StylePayload), "utf8").digest("hex");
    expect(result.fingerprint).not.toBe(v1StyleHash);
  });

  it("33. is isolated from M13 fingerprint namespaces", async () => {
    const result = await buildBackupM15V2RestorePreview(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fingerprint).not.toMatch(/m13/i);
    expect(result.previewVersion).not.toContain("m13");
  });

  it("34. does not expose a legacy relative path in the output", async () => {
    const body = new TextEncoder().encode("legacy-body");
    const artifact = buildArtifact({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] });
    const wrongBody = new TextEncoder().encode("wrong-content-value");
    const result = await buildBackupM15V2RestorePreview(
      baseInput({
        artifact,
        currentState: sections({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] }),
        legacyLocalResolver: legacyResolverFrom(new Map([[legacyRelativePath(LEGACY_ASSET_ID), () => validLegacySource(LEGACY_ASSET_ID, wrongBody)]])),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(legacyRelativePath(LEGACY_ASSET_ID));
  });

  it("35. does not expose an object key in the output", async () => {
    const body = new TextEncoder().encode("object-body");
    const artifact = buildArtifact({ imageAssets: [objectAsset(OBJECT_ASSET_ID, body)] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ imageAssets: [objectAsset(OBJECT_ASSET_ID, body)] }), ...noResolvers() }),
    );
    expect(JSON.stringify(result)).not.toContain(objectKey(OBJECT_ASSET_ID));
  });

  it("36. does not expose a versionId in the output", async () => {
    const body = new TextEncoder().encode("object-body");
    const versionId = "exact-version-marker";
    const artifact = buildArtifact({ imageAssets: [objectAsset(OBJECT_ASSET_ID, body, versionId)] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({
        artifact,
        currentState: sections({ imageAssets: [objectAsset(OBJECT_ASSET_ID, body, versionId)] }),
        objectBackedResolver: objectResolverFrom(new Map([[objectKey(OBJECT_ASSET_ID), () => validObjectSource(OBJECT_ASSET_ID, body, "different-resolved-version")]])),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(versionId);
  });

  it("37. does not expose provider error details in the output", async () => {
    const body = new TextEncoder().encode("legacy-body");
    const artifact = buildArtifact({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] });
    const throwingResolver: BackupM15V2LegacyLocalReferenceResolver = {
      resolveLegacyLocalReference: vi.fn(async () => { throw new Error("secret-provider-detail"); }),
    };
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] }), legacyLocalResolver: throwingResolver }),
    );
    expect(JSON.stringify(result)).not.toContain("secret-provider-detail");
  });

  it("38. does not expose expected or actual content hashes in the output", async () => {
    const body = new TextEncoder().encode("legacy-body");
    const artifact = buildArtifact({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] });
    const wrongBody = new TextEncoder().encode("wrong-content-value");
    const result = await buildBackupM15V2RestorePreview(
      baseInput({
        artifact,
        currentState: sections({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] }),
        legacyLocalResolver: legacyResolverFrom(new Map([[legacyRelativePath(LEGACY_ASSET_ID), () => validLegacySource(LEGACY_ASSET_ID, wrongBody)]])),
      }),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(sha256(body));
    expect(serialized).not.toContain(sha256(wrongBody));
  });

  it("39. does not expose an image asset id in the output", async () => {
    const body = new TextEncoder().encode("legacy-body");
    const artifact = buildArtifact({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] });
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ artifact, currentState: sections({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, body)] }), ...noResolvers() }),
    );
    expect(JSON.stringify(result)).not.toContain(LEGACY_ASSET_ID);
  });

  it("40. does not call any resolver when there are zero external references", async () => {
    const legacyLocalResolver = legacyResolverFrom(new Map());
    const objectBackedResolver = objectResolverFrom(new Map());
    await buildBackupM15V2RestorePreview(baseInput({ legacyLocalResolver, objectBackedResolver }));
    expect(legacyLocalResolver.resolveLegacyLocalReference).not.toHaveBeenCalled();
    expect(objectBackedResolver.resolveObjectBackedReference).not.toHaveBeenCalled();
  });

  it("41. fails fast: a later reference resolver is not called after an earlier one fails", async () => {
    const legacyBody = new TextEncoder().encode("legacy-body");
    const objectBody = new TextEncoder().encode("object-body");
    // "2222..." (legacy) sorts before "3333..." (object): the legacy failure must short-circuit first.
    const artifact = buildArtifact({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, legacyBody), objectAsset(OBJECT_ASSET_ID, objectBody)] });
    const objectBackedResolver = objectResolverFrom(new Map([[objectKey(OBJECT_ASSET_ID), () => validObjectSource(OBJECT_ASSET_ID, objectBody)]]));
    const result = await buildBackupM15V2RestorePreview(
      baseInput({
        artifact,
        currentState: sections({ imageAssets: [legacyAsset(LEGACY_ASSET_ID, legacyBody), objectAsset(OBJECT_ASSET_ID, objectBody)] }),
        legacyLocalResolver: legacyResolverFrom(new Map()),
        objectBackedResolver,
      }),
    );
    expect(result).toMatchObject({ ok: false, code: "external_reference_verification_failed" });
    expect(objectBackedResolver.resolveObjectBackedReference).not.toHaveBeenCalled();
  });

  it("42. produces deterministic, order-independent blocking reasons", async () => {
    const extraA = analysis({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const extraB = analysis({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    const artifact = buildArtifact({ analyses: [], consultations: [] });
    const resultA = await buildBackupM15V2RestorePreview(baseInput({ artifact, currentState: sections({ analyses: [extraA, extraB], consultations: [] }) }));
    const resultB = await buildBackupM15V2RestorePreview(baseInput({ artifact, currentState: sections({ analyses: [extraB, extraA], consultations: [] }) }));
    expect(resultA).toEqual(resultB);
    expect(resultA).toMatchObject({ ok: true, canRestore: false });
  });

  it("43. rejects a current state with a duplicate row identity fail-closed", async () => {
    const result = await buildBackupM15V2RestorePreview(
      baseInput({ currentState: sections({ clients: [client(), client()] }) }),
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_current_state" });
  });

  it("44. rejects a current state with an unknown or missing section key", async () => {
    const malformed = sections() as unknown as Record<string, unknown>;
    delete malformed.imageAnalysisReviews;
    (malformed as Record<string, unknown>).unknownSection = [];
    const result = await buildBackupM15V2RestorePreview(baseInput({ currentState: malformed }));
    expect(result).toMatchObject({ ok: false, code: "invalid_current_state" });
  });

  it("45. rejects a verifier dependency that violates its contract", async () => {
    const throwingVerifier = vi.fn(async () => { throw new Error("dependency exploded"); }) as unknown as typeof verifyBackupM15V2ExternalReferences;
    const result = await buildBackupM15V2RestorePreview(baseInput({ verifyExternalReferences: throwingVerifier }));
    expect(result).toMatchObject({ ok: false, code: "internal_contract_violation" });
  });

  it("46. the fingerprint contains no embedded sensitive data and is a plain hex digest", async () => {
    const result = await buildBackupM15V2RestorePreview(baseInput());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("47. the implementation module imports no DB/HTTP/filesystem/AWS dependency", () => {
    const source = readSourceFile();
    expect(source).not.toMatch(/from ["']fs["']/);
    expect(source).not.toMatch(/from ["']node:fs["']/);
    expect(source).not.toMatch(/@aws-sdk/);
    expect(source).not.toMatch(/@prisma\/client/);
    expect(source).not.toMatch(/next\/server/);
    expect(source).not.toMatch(/process\.env/);
  });

  it("48. WP2H3 types are local and the module never imports from ./contracts", () => {
    const source = readSourceFile();
    expect(source).not.toMatch(/from ["']\.\/contracts["']/);
  });

  it("49. relies on the WP2H1 parser as the sole structural/checksum validator", async () => {
    const artifact = buildArtifact({ analyses: [analysis()] });
    const tampered = structuredClone(artifact);
    (tampered as unknown as Record<string, unknown>).label = "tampered-without-recomputing-checksum";
    const result = await buildBackupM15V2RestorePreview(baseInput({ artifact: tampered }));
    expect(result).toMatchObject({ ok: false, code: "invalid_artifact" });
  });

  it("50. success and failure result shapes match the documented contract exactly", async () => {
    const ok = await buildBackupM15V2RestorePreview(baseInput());
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(Object.keys(ok).sort()).toEqual(
        [
          "artifactVersion", "backupId", "blockingReasons", "canRestore", "fingerprint", "ok",
          "previewedAt", "previewVersion", "sectionImpacts", "summary", "verifiedExternalReferenceCount", "warnings",
        ].sort(),
      );
    }
    const failed = await buildBackupM15V2RestorePreview(baseInput({ artifact: { not: "valid" } }));
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(Object.keys(failed).sort()).toEqual(["code", "message", "ok", "previewedAt", "previewVersion"].sort());
    }
  });
});

function readSourceFile(): string {
  const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "backup-m15-v2-restore-preview.ts");
  return readFileSync(sourcePath, "utf8");
}
