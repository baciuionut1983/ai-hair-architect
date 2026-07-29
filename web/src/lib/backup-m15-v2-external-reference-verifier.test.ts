import { createHash } from "crypto";

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

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const LEGACY_ASSET_A_ID = "22222222-2222-4222-8222-222222222222";
const LEGACY_ASSET_B_ID = "22222222-2222-4222-8222-222222222223";
const OBJECT_ASSET_A_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-28T20:00:00.000Z";
const VERIFIED_AT = "2026-07-29T09:00:00.000Z";

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

interface LegacySpec {
  id: string;
  body: Uint8Array;
}

interface ObjectSpec {
  id: string;
  body: Uint8Array;
  versionId?: string;
  bucketAlias?: string;
}

function legacyRelativePath(id: string): string {
  return `${OWNER_ID}/${id}/${id}.jpg`;
}

function objectKey(id: string): string {
  return `v1/owners/${OWNER_ID}/assets/${id}/original`;
}

function buildArtifactInput(opts: { legacy?: LegacySpec[]; object?: ObjectSpec[] }): BackupM15V2ArtifactInput {
  const legacy = opts.legacy ?? [];
  const object = opts.object ?? [];

  const legacyRows = legacy.map((spec) => ({
    id: spec.id,
    fileName: `${spec.id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: spec.body.byteLength,
    ownerUserId: OWNER_ID,
    clientId: CLIENT_ID,
    exifStripped: true,
    normalizedOrientation: 1,
    uploadedAt: NOW,
    deletedAt: null,
    retentionDeletesAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    storageKind: "legacy-local" as const,
    legacyReference: {
      backend: "local" as const,
      rootAlias: "legacy-images" as const,
      relativePath: legacyRelativePath(spec.id),
      contentSha256: sha256(spec.body),
      sizeBytes: spec.body.byteLength,
    },
  }));

  const objectRows = object.map((spec) => ({
    id: spec.id,
    fileName: `${spec.id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: spec.body.byteLength,
    ownerUserId: OWNER_ID,
    clientId: CLIENT_ID,
    exifStripped: true,
    normalizedOrientation: 1,
    uploadedAt: NOW,
    deletedAt: null,
    retentionDeletesAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    storageKind: "object-backed" as const,
    objectReference: {
      backend: "s3" as const,
      bucketAlias: spec.bucketAlias ?? "primary-images",
      key: objectKey(spec.id),
      versionId: spec.versionId ?? `version-${spec.id}`,
      contentSha256: sha256(spec.body),
      sizeBytes: spec.body.byteLength,
    },
    storageEtag: "etag-1",
    storageState: "available" as const,
    storageMigratedAt: NOW,
    objectDeletedAt: null,
    lastStorageErrorCode: null,
  }));

  const imageAssets = [...legacyRows, ...objectRows];

  return {
    schemaVersion: M15_V2_SCHEMA_VERSION,
    canonicalSerializationVersion: M15_V2_CANONICAL_SERIALIZATION_VERSION,
    checksumAlgorithm: M15_V2_CHECKSUM_ALGORITHM,
    checksum: null,
    backupId: "backup-m15-v2-verifier",
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
      consultations: 0,
      imageAssets: imageAssets.length,
      imageAnalyses: 0,
      imageAnalysisReviews: 0,
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
    sections: { clients: [], analyses: [], consultations: [], imageAnalyses: [], imageAnalysisReviews: [], imageAssets },
  };
}

function buildArtifact(opts: { legacy?: LegacySpec[]; object?: ObjectSpec[] }) {
  return buildBackupM15V2Artifact(buildArtifactInput(opts));
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

function validLegacySource(
  id: string,
  body: Uint8Array,
  overrides: Partial<BackupM15V2ResolvedLegacyLocalReferenceSource> = {},
): BackupM15V2ResolvedLegacyLocalReferenceSource {
  return {
    rootAlias: "legacy-images",
    relativePath: legacyRelativePath(id),
    sizeBytes: body.byteLength,
    openStream: () => streamChunks([body]),
    ...overrides,
  };
}

function validObjectSource(
  id: string,
  body: Uint8Array,
  versionId = `version-${id}`,
  overrides: Partial<BackupM15V2ResolvedObjectBackedReferenceSource> = {},
): BackupM15V2ResolvedObjectBackedReferenceSource {
  return {
    bucketAlias: "primary-images",
    key: objectKey(id),
    versionId,
    sizeBytes: body.byteLength,
    openStream: () => streamChunks([body]),
    ...overrides,
  };
}

function throwingLegacyResolver(): BackupM15V2LegacyLocalReferenceResolver {
  return { resolveLegacyLocalReference: vi.fn(async () => { throw new Error("secret-io-failure"); }) };
}

function throwingObjectResolver(): BackupM15V2ObjectBackedReferenceResolver {
  return { resolveObjectBackedReference: vi.fn(async () => { throw new Error("secret-io-failure"); }) };
}

const BODY_A = new TextEncoder().encode("legacy-body-a");
const BODY_B = new TextEncoder().encode("legacy-body-b-longer");

describe("verifyBackupM15V2ExternalReferences", () => {
  it("1. fails closed with artifact_invalid for a structurally invalid artifact", async () => {
    const result = await verifyBackupM15V2ExternalReferences({
      artifact: { not: "an artifact" },
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: false, code: "artifact_invalid", verifiedAt: VERIFIED_AT });
  });

  it("2. verifies a valid artifact with zero external references", async () => {
    const artifact = buildArtifact({});
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toEqual({
      ok: true,
      artifactVersion: "m15.v2",
      verifiedAt: VERIFIED_AT,
      verifiedReferenceCount: 0,
      legacyLocalReferenceCount: 0,
      objectBackedReferenceCount: 0,
    });
  });

  it("3. verifies a single valid legacy-local reference", async () => {
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }] });
    const legacyResolver = legacyResolverFrom(
      new Map([[legacyRelativePath(LEGACY_ASSET_A_ID), () => validLegacySource(LEGACY_ASSET_A_ID, BODY_A)]]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: true, verifiedReferenceCount: 1, legacyLocalReferenceCount: 1, objectBackedReferenceCount: 0 });
  });

  it("4. verifies multiple valid legacy-local references", async () => {
    const artifact = buildArtifact({
      legacy: [
        { id: LEGACY_ASSET_A_ID, body: BODY_A },
        { id: LEGACY_ASSET_B_ID, body: BODY_B },
      ],
    });
    const legacyResolver = legacyResolverFrom(
      new Map([
        [legacyRelativePath(LEGACY_ASSET_A_ID), () => validLegacySource(LEGACY_ASSET_A_ID, BODY_A)],
        [legacyRelativePath(LEGACY_ASSET_B_ID), () => validLegacySource(LEGACY_ASSET_B_ID, BODY_B)],
      ]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: true, verifiedReferenceCount: 2, legacyLocalReferenceCount: 2 });
  });

  it("5. fails with reference_missing when the legacy resolver has no such reference", async () => {
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }] });
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: false, code: "reference_missing", referenceIndex: 0, referenceKind: "legacy-local" });
  });

  it("6. fails with size_mismatch when the legacy stream size differs from the backup record", async () => {
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }] });
    const wrongSizedBody = new TextEncoder().encode("different-length-body");
    const legacyResolver = legacyResolverFrom(
      new Map([
        [
          legacyRelativePath(LEGACY_ASSET_A_ID),
          () => validLegacySource(LEGACY_ASSET_A_ID, wrongSizedBody, { sizeBytes: wrongSizedBody.byteLength }),
        ],
      ]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: false, code: "size_mismatch", referenceKind: "legacy-local" });
  });

  it("7. fails with hash_mismatch when the legacy stream content differs from the backup record", async () => {
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }] });
    const sameSizeDifferentBytes = new TextEncoder().encode("legacy-body-x");
    expect(sameSizeDifferentBytes.byteLength).toBe(BODY_A.byteLength);
    const legacyResolver = legacyResolverFrom(
      new Map([[legacyRelativePath(LEGACY_ASSET_A_ID), () => validLegacySource(LEGACY_ASSET_A_ID, sameSizeDifferentBytes)]]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: false, code: "hash_mismatch", referenceKind: "legacy-local" });
  });

  it("8. fails with reference_resolution_failed when the legacy resolver throws", async () => {
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }] });
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: throwingLegacyResolver(),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: false, code: "reference_resolution_failed", referenceKind: "legacy-local" });
  });

  it("9. fails with resolver_contract_violation when the legacy resolver returns a malformed shape", async () => {
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }] });
    const legacyResolver = legacyResolverFrom(
      new Map([
        [
          legacyRelativePath(LEGACY_ASSET_A_ID),
          () => ({ rootAlias: "legacy-images", relativePath: legacyRelativePath(LEGACY_ASSET_A_ID) }) as unknown as BackupM15V2ResolvedLegacyLocalReferenceSource,
        ],
      ]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: false, code: "resolver_contract_violation", referenceKind: "legacy-local" });
  });

  it("10. fails with stream_limit_exceeded when the legacy reference exceeds maxStreamBytes", async () => {
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }] });
    const legacyResolver = legacyResolverFrom(
      new Map([[legacyRelativePath(LEGACY_ASSET_A_ID), () => validLegacySource(LEGACY_ASSET_A_ID, BODY_A)]]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolverFrom(new Map()),
      maxStreamBytes: BODY_A.byteLength - 1,
    });
    expect(result).toMatchObject({ ok: false, code: "stream_limit_exceeded", referenceKind: "legacy-local" });
    expect(legacyResolver.resolveLegacyLocalReference).not.toHaveBeenCalled();
  });

  it("11. verifies a single valid object-backed reference", async () => {
    const body = new TextEncoder().encode("object-body-a");
    const artifact = buildArtifact({ object: [{ id: OBJECT_ASSET_A_ID, body }] });
    const objectResolver = objectResolverFrom(
      new Map([[objectKey(OBJECT_ASSET_A_ID), () => validObjectSource(OBJECT_ASSET_A_ID, body)]]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolver,
    });
    expect(result).toMatchObject({ ok: true, verifiedReferenceCount: 1, objectBackedReferenceCount: 1 });
  });

  it("12. verifies an exact-version object-backed reference", async () => {
    const body = new TextEncoder().encode("object-body-versioned");
    const versionId = "exact-version-42";
    const artifact = buildArtifact({ object: [{ id: OBJECT_ASSET_A_ID, body, versionId }] });
    const objectResolver = objectResolverFrom(
      new Map([[objectKey(OBJECT_ASSET_A_ID), () => validObjectSource(OBJECT_ASSET_A_ID, body, versionId)]]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolver,
    });
    expect(result).toMatchObject({ ok: true, verifiedReferenceCount: 1 });
  });

  it("13. fails with reference_missing when the exact requested version does not exist", async () => {
    const body = new TextEncoder().encode("object-body-a");
    const artifact = buildArtifact({ object: [{ id: OBJECT_ASSET_A_ID, body }] });
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: false, code: "reference_missing", referenceKind: "object-backed" });
  });

  it("14. prohibits falling back to the latest version instead of the exact requested version", async () => {
    const body = new TextEncoder().encode("object-body-a");
    const artifact = buildArtifact({ object: [{ id: OBJECT_ASSET_A_ID, body, versionId: "exact-version-1" }] });
    const objectResolver = objectResolverFrom(
      new Map([[objectKey(OBJECT_ASSET_A_ID), () => validObjectSource(OBJECT_ASSET_A_ID, body, "latest")]]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolver,
    });
    expect(result).toMatchObject({ ok: false, code: "version_mismatch" });
  });

  it("15. fails with version_mismatch when the resolved version differs from the exact requested version", async () => {
    const body = new TextEncoder().encode("object-body-a");
    const artifact = buildArtifact({ object: [{ id: OBJECT_ASSET_A_ID, body, versionId: "version-one" }] });
    const objectResolver = objectResolverFrom(
      new Map([[objectKey(OBJECT_ASSET_A_ID), () => validObjectSource(OBJECT_ASSET_A_ID, body, "version-two")]]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolver,
    });
    expect(result).toMatchObject({ ok: false, code: "version_mismatch" });
  });

  it("16. fails with size_mismatch for an object-backed stream", async () => {
    const body = new TextEncoder().encode("object-body-a");
    const artifact = buildArtifact({ object: [{ id: OBJECT_ASSET_A_ID, body }] });
    const wrongSizedBody = new TextEncoder().encode("a-different-length-object-body");
    const objectResolver = objectResolverFrom(
      new Map([
        [
          objectKey(OBJECT_ASSET_A_ID),
          () => validObjectSource(OBJECT_ASSET_A_ID, wrongSizedBody, `version-${OBJECT_ASSET_A_ID}`, { sizeBytes: wrongSizedBody.byteLength }),
        ],
      ]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolver,
    });
    expect(result).toMatchObject({ ok: false, code: "size_mismatch", referenceKind: "object-backed" });
  });

  it("17. fails with hash_mismatch for an object-backed stream", async () => {
    const body = new TextEncoder().encode("object-body-abcdef");
    const artifact = buildArtifact({ object: [{ id: OBJECT_ASSET_A_ID, body }] });
    const sameSizeDifferentBytes = new TextEncoder().encode("object-body-ghijkl");
    expect(sameSizeDifferentBytes.byteLength).toBe(body.byteLength);
    const objectResolver = objectResolverFrom(
      new Map([[objectKey(OBJECT_ASSET_A_ID), () => validObjectSource(OBJECT_ASSET_A_ID, sameSizeDifferentBytes)]]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolver,
    });
    expect(result).toMatchObject({ ok: false, code: "hash_mismatch", referenceKind: "object-backed" });
  });

  it("18. fails with reference_resolution_failed when the object resolver throws", async () => {
    const body = new TextEncoder().encode("object-body-a");
    const artifact = buildArtifact({ object: [{ id: OBJECT_ASSET_A_ID, body }] });
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: throwingObjectResolver(),
    });
    expect(result).toMatchObject({ ok: false, code: "reference_resolution_failed", referenceKind: "object-backed" });
  });

  it("19. fails with resolver_contract_violation when the object resolver returns a malformed shape", async () => {
    const body = new TextEncoder().encode("object-body-a");
    const artifact = buildArtifact({ object: [{ id: OBJECT_ASSET_A_ID, body }] });
    const objectResolver = objectResolverFrom(
      new Map([
        [
          objectKey(OBJECT_ASSET_A_ID),
          () => ({ bucketAlias: "primary-images", key: objectKey(OBJECT_ASSET_A_ID) }) as unknown as BackupM15V2ResolvedObjectBackedReferenceSource,
        ],
      ]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolver,
    });
    expect(result).toMatchObject({ ok: false, code: "resolver_contract_violation", referenceKind: "object-backed" });
  });

  it("20. fails with stream_limit_exceeded when the object reference exceeds maxStreamBytes", async () => {
    const body = new TextEncoder().encode("object-body-a");
    const artifact = buildArtifact({ object: [{ id: OBJECT_ASSET_A_ID, body }] });
    const objectResolver = objectResolverFrom(
      new Map([[objectKey(OBJECT_ASSET_A_ID), () => validObjectSource(OBJECT_ASSET_A_ID, body)]]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolver,
      maxStreamBytes: body.byteLength - 1,
    });
    expect(result).toMatchObject({ ok: false, code: "stream_limit_exceeded", referenceKind: "object-backed" });
    expect(objectResolver.resolveObjectBackedReference).not.toHaveBeenCalled();
  });

  it("21. verifies a mixed artifact with both legacy-local and object-backed references", async () => {
    const objectBody = new TextEncoder().encode("object-body-mixed");
    const artifact = buildArtifact({
      legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }],
      object: [{ id: OBJECT_ASSET_A_ID, body: objectBody }],
    });
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(
        new Map([[legacyRelativePath(LEGACY_ASSET_A_ID), () => validLegacySource(LEGACY_ASSET_A_ID, BODY_A)]]),
      ),
      objectBackedResolver: objectResolverFrom(
        new Map([[objectKey(OBJECT_ASSET_A_ID), () => validObjectSource(OBJECT_ASSET_A_ID, objectBody)]]),
      ),
    });
    expect(result).toMatchObject({ ok: true, verifiedReferenceCount: 2, legacyLocalReferenceCount: 1, objectBackedReferenceCount: 1 });
  });

  it("22. verifies references in deterministic ascending-id order", async () => {
    const objectBody = new TextEncoder().encode("object-body-mixed");
    // legacy id "222...222" < object id "333...333" lexically, independent of insertion order.
    const artifact = buildArtifact({
      legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }],
      object: [{ id: OBJECT_ASSET_A_ID, body: objectBody }],
    });
    const calls: string[] = [];
    const legacyResolver = legacyResolverFrom(
      new Map([
        [
          legacyRelativePath(LEGACY_ASSET_A_ID),
          () => {
            calls.push("legacy");
            return validLegacySource(LEGACY_ASSET_A_ID, BODY_A);
          },
        ],
      ]),
    );
    const objectResolver = objectResolverFrom(
      new Map([
        [
          objectKey(OBJECT_ASSET_A_ID),
          () => {
            calls.push("object");
            return validObjectSource(OBJECT_ASSET_A_ID, objectBody);
          },
        ],
      ]),
    );
    await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolver,
    });
    expect(calls).toEqual(["legacy", "object"]);
  });

  it("23. fails fast at the first error and does not report partial success", async () => {
    const artifact = buildArtifact({
      legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }],
      object: [{ id: OBJECT_ASSET_A_ID, body: new TextEncoder().encode("object-body-a") }],
    });
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolverFrom(
        new Map([[objectKey(OBJECT_ASSET_A_ID), () => validObjectSource(OBJECT_ASSET_A_ID, new TextEncoder().encode("object-body-a"))]]),
      ),
    });
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("verifiedReferenceCount", 1);
  });

  it("24. does not call the resolver for later references after the first failure", async () => {
    const artifact = buildArtifact({
      legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }],
      object: [{ id: OBJECT_ASSET_A_ID, body: new TextEncoder().encode("object-body-a") }],
    });
    const objectResolver = objectResolverFrom(
      new Map([[objectKey(OBJECT_ASSET_A_ID), () => validObjectSource(OBJECT_ASSET_A_ID, new TextEncoder().encode("object-body-a"))]]),
    );
    await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolver,
    });
    expect(objectResolver.resolveObjectBackedReference).not.toHaveBeenCalled();
  });

  it("25. injects verifiedAt rather than deriving it, for both success and failure results", async () => {
    const okArtifact = buildArtifact({});
    const okResult = await verifyBackupM15V2ExternalReferences({
      artifact: okArtifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(okResult.verifiedAt).toBe(VERIFIED_AT);

    const failResult = await verifyBackupM15V2ExternalReferences({
      artifact: { not: "an artifact" },
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(failResult.verifiedAt).toBe(VERIFIED_AT);
  });

  it("26. never calls Date.now internally", async () => {
    const spy = vi.spyOn(Date, "now");
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }] });
    await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(
        new Map([[legacyRelativePath(LEGACY_ASSET_A_ID), () => validLegacySource(LEGACY_ASSET_A_ID, BODY_A)]]),
      ),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("27-31. sanitizes failure output: no path, object key, asset id, provider error, or hash values", async () => {
    const secretAssetId = LEGACY_ASSET_A_ID;
    const artifact = buildArtifact({ legacy: [{ id: secretAssetId, body: BODY_A }] });
    const expectedHash = sha256(BODY_A);
    const wrongBody = new TextEncoder().encode("legacy-body-x");
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(
        new Map([[legacyRelativePath(secretAssetId), () => validLegacySource(secretAssetId, wrongBody)]]),
      ),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretAssetId);
    expect(serialized).not.toContain(legacyRelativePath(secretAssetId));
    expect(serialized).not.toContain(expectedHash);
    expect(serialized).not.toContain(sha256(wrongBody));

    const providerError = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: throwingLegacyResolver(),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(JSON.stringify(providerError)).not.toContain("secret-io-failure");

    const objectArtifact = buildArtifact({ object: [{ id: OBJECT_ASSET_A_ID, body: BODY_A }] });
    const objectFailure = await verifyBackupM15V2ExternalReferences({
      artifact: objectArtifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    const objectSerialized = JSON.stringify(objectFailure);
    expect(objectSerialized).not.toContain(objectKey(OBJECT_ASSET_A_ID));
    expect(objectSerialized).not.toContain("primary-images");
  });

  it("32. returns correct counters on success", async () => {
    const objectBody = new TextEncoder().encode("object-body-mixed");
    const artifact = buildArtifact({
      legacy: [
        { id: LEGACY_ASSET_A_ID, body: BODY_A },
        { id: LEGACY_ASSET_B_ID, body: BODY_B },
      ],
      object: [{ id: OBJECT_ASSET_A_ID, body: objectBody }],
    });
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(
        new Map([
          [legacyRelativePath(LEGACY_ASSET_A_ID), () => validLegacySource(LEGACY_ASSET_A_ID, BODY_A)],
          [legacyRelativePath(LEGACY_ASSET_B_ID), () => validLegacySource(LEGACY_ASSET_B_ID, BODY_B)],
        ]),
      ),
      objectBackedResolver: objectResolverFrom(
        new Map([[objectKey(OBJECT_ASSET_A_ID), () => validObjectSource(OBJECT_ASSET_A_ID, objectBody)]]),
      ),
    });
    expect(result).toEqual({
      ok: true,
      artifactVersion: "m15.v2",
      verifiedAt: VERIFIED_AT,
      verifiedReferenceCount: 3,
      legacyLocalReferenceCount: 2,
      objectBackedReferenceCount: 1,
    });
  });

  it("33. does not call any resolver when there are zero references", async () => {
    const artifact = buildArtifact({});
    const legacyResolver = legacyResolverFrom(new Map());
    const objectResolver = objectResolverFrom(new Map());
    await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolver,
    });
    expect(legacyResolver.resolveLegacyLocalReference).not.toHaveBeenCalled();
    expect(objectResolver.resolveObjectBackedReference).not.toHaveBeenCalled();
  });

  it("34. relies on the WP2H1 parser as the sole structural/checksum validator", async () => {
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }] });
    const tampered = structuredClone(artifact);
    (tampered as unknown as Record<string, unknown>).label = "tampered-without-recomputing-checksum";
    const result = await verifyBackupM15V2ExternalReferences({
      artifact: tampered,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(
        new Map([[legacyRelativePath(LEGACY_ASSET_A_ID), () => validLegacySource(LEGACY_ASSET_A_ID, BODY_A)]]),
      ),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: false, code: "artifact_invalid" });
  });

  it("35. does not mutate the input artifact", async () => {
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }] });
    const before = structuredClone(artifact);
    await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(
        new Map([[legacyRelativePath(LEGACY_ASSET_A_ID), () => validLegacySource(LEGACY_ASSET_A_ID, BODY_A)]]),
      ),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(artifact).toEqual(before);
  });

  it("36. reads the stream in bounded chunks and reconstructs the exact content", async () => {
    const body = new TextEncoder().encode("chunked-reconstruction-body-0123456789");
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body }] });
    const chunked = () =>
      streamChunks([body.slice(0, 5), body.slice(5, 11), body.slice(11, 17), body.slice(17)]);
    const legacyResolver = legacyResolverFrom(
      new Map([
        [
          legacyRelativePath(LEGACY_ASSET_A_ID),
          () => ({ rootAlias: "legacy-images" as const, relativePath: legacyRelativePath(LEGACY_ASSET_A_ID), sizeBytes: body.byteLength, openStream: chunked }),
        ],
      ]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: true, verifiedReferenceCount: 1 });
  });

  it("37. computes size exactly from the actually streamed bytes", async () => {
    const body = new TextEncoder().encode("exact-size-body");
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body }] });
    const legacyResolver = legacyResolverFrom(
      new Map([[legacyRelativePath(LEGACY_ASSET_A_ID), () => validLegacySource(LEGACY_ASSET_A_ID, body)]]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("38. computes SHA-256 incrementally across multiple chunks", async () => {
    const parts = ["incremental-", "sha256-", "across-chunks"];
    const body = new TextEncoder().encode(parts.join(""));
    const expectedHash = sha256(body);
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body }] });
    const legacyResolver = legacyResolverFrom(
      new Map([
        [
          legacyRelativePath(LEGACY_ASSET_A_ID),
          () => ({
            rootAlias: "legacy-images" as const,
            relativePath: legacyRelativePath(LEGACY_ASSET_A_ID),
            sizeBytes: body.byteLength,
            openStream: () => streamChunks(parts.map((part) => new TextEncoder().encode(part))),
          }),
        ],
      ]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: true });
    expect(expectedHash).toHaveLength(64);
  });

  it("39. resolves a genuinely empty stream deterministically instead of hanging or throwing", async () => {
    // Backup image assets always require sizeBytes >= 1 (enforced by the WP2H1 parser), so a
    // truly empty object can never be a "success" case here; this proves the zero-chunk stream
    // path still terminates deterministically (computed size 0) rather than hanging or throwing.
    const declaredBody = new Uint8Array(1);
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: declaredBody }] });
    const legacyResolver = legacyResolverFrom(
      new Map([
        [
          legacyRelativePath(LEGACY_ASSET_A_ID),
          () => ({
            rootAlias: "legacy-images" as const,
            relativePath: legacyRelativePath(LEGACY_ASSET_A_ID),
            sizeBytes: 0,
            openStream: () => streamChunks([]),
          }),
        ],
      ]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: false, code: "size_mismatch" });
  });

  it("40. fails closed when the stream terminates before producing the declared number of bytes", async () => {
    const body = new TextEncoder().encode("ten-bytes!");
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body }] });
    const legacyResolver = legacyResolverFrom(
      new Map([
        [
          legacyRelativePath(LEGACY_ASSET_A_ID),
          () => ({
            rootAlias: "legacy-images" as const,
            relativePath: legacyRelativePath(LEGACY_ASSET_A_ID),
            sizeBytes: body.byteLength,
            openStream: () => streamChunks([body.slice(0, 4)]),
          }),
        ],
      ]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: false, code: "resolver_contract_violation" });
  });

  it("41. fails with stream_limit_exceeded when more chunks are produced than the configured limit allows", async () => {
    // The artifact's declared reference size must stay within maxStreamBytes so the cheap
    // pre-check does not short-circuit before the resolver is even called; the misbehaving
    // resolver then streams more actual bytes than both declare, which must be caught mid-read.
    const maxStreamBytes = 6;
    const declaredBody = new Uint8Array(maxStreamBytes);
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: declaredBody }] });
    const chunkA = new TextEncoder().encode("aaaaa");
    const chunkB = new TextEncoder().encode("bbbbb");
    const chunkC = new TextEncoder().encode("ccccc");
    const cancelled = vi.fn();
    const legacyResolver = legacyResolverFrom(
      new Map([
        [
          legacyRelativePath(LEGACY_ASSET_A_ID),
          () => ({
            rootAlias: "legacy-images" as const,
            relativePath: legacyRelativePath(LEGACY_ASSET_A_ID),
            sizeBytes: maxStreamBytes,
            openStream: () => streamChunks([chunkA, chunkB, chunkC], cancelled),
          }),
        ],
      ]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolverFrom(new Map()),
      maxStreamBytes,
    });
    expect(result).toMatchObject({ ok: false, code: "stream_limit_exceeded" });
    expect(cancelled).toHaveBeenCalled();
  });

  it("42. fails with resolver_contract_violation when declared metadata is inconsistent with the stream (more bytes than declared)", async () => {
    const declaredBody = new TextEncoder().encode("short");
    const actualBody = new TextEncoder().encode("this-is-actually-longer");
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: declaredBody }] });
    const legacyResolver = legacyResolverFrom(
      new Map([
        [
          legacyRelativePath(LEGACY_ASSET_A_ID),
          () => ({
            rootAlias: "legacy-images" as const,
            relativePath: legacyRelativePath(LEGACY_ASSET_A_ID),
            sizeBytes: declaredBody.byteLength,
            openStream: () => streamChunks([actualBody]),
          }),
        ],
      ]),
    );
    const result = await verifyBackupM15V2ExternalReferences({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolver,
      objectBackedResolver: objectResolverFrom(new Map()),
      maxStreamBytes: actualBody.byteLength + 10,
    });
    expect(result).toMatchObject({ ok: false, code: "resolver_contract_violation" });
  });

  it("43. rejects an unknown external reference kind fail-closed", async () => {
    const artifact = buildArtifact({ legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }] });
    const corrupted = structuredClone(artifact) as unknown as {
      sections: { imageAssets: Array<Record<string, unknown>> };
    };
    corrupted.sections.imageAssets[0].storageKind = "unknown-kind";
    const result = await verifyBackupM15V2ExternalReferences({
      artifact: corrupted,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(new Map()),
      objectBackedResolver: objectResolverFrom(new Map()),
    });
    expect(result).toMatchObject({ ok: false, code: "artifact_invalid" });
  });

  it("44. returns identical results for repeated calls with the same input and same dependencies", async () => {
    const objectBody = new TextEncoder().encode("object-body-determinism");
    const artifact = buildArtifact({
      legacy: [{ id: LEGACY_ASSET_A_ID, body: BODY_A }],
      object: [{ id: OBJECT_ASSET_A_ID, body: objectBody }],
    });
    const buildInput = () => ({
      artifact,
      verifiedAt: VERIFIED_AT,
      legacyLocalResolver: legacyResolverFrom(
        new Map([[legacyRelativePath(LEGACY_ASSET_A_ID), () => validLegacySource(LEGACY_ASSET_A_ID, BODY_A)]]),
      ),
      objectBackedResolver: objectResolverFrom(
        new Map([[objectKey(OBJECT_ASSET_A_ID), () => validObjectSource(OBJECT_ASSET_A_ID, objectBody)]]),
      ),
    });
    const first = await verifyBackupM15V2ExternalReferences(buildInput());
    const second = await verifyBackupM15V2ExternalReferences(buildInput());
    expect(first).toEqual(second);
  });
});
