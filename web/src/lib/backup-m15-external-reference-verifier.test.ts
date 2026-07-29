import { createHash } from "crypto";

import { describe, expect, it, vi } from "vitest";

import {
  M15_CANONICAL_SERIALIZATION_VERSION,
  M15_CHECKSUM_ALGORITHM,
  buildBackupM15V1Artifact,
  type BackupM15V1ArtifactInput,
} from "./backup-m15-artifact";
import {
  verifyM15ExternalReferences,
  type M15ObjectStorageAliasResolver,
} from "./backup-m15-external-reference-verifier";
import type {
  ObjectIdentity,
  ObjectMetadata,
  ObjectStorage,
  StoredObject,
} from "./object-storage";
import { ObjectStorageError } from "./object-storage-errors";
import { M15_V1_SCHEMA_VERSION } from "./object-storage-runtime";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = "2026-07-28T10:00:00.000Z";

interface FakeOptions {
  head?: (identity: ObjectIdentity) => Promise<ObjectMetadata>;
  get?: (identity: ObjectIdentity) => Promise<StoredObject>;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function streamChunks(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      onCancel?.();
    },
  }, { highWaterMark: 0 });
}

function createArtifact(bodies: Array<{ assetId: string; body: Uint8Array }> = [
  { assetId: ASSET_A_ID, body: new TextEncoder().encode("first-object") },
]) {
  const input: BackupM15V1ArtifactInput = {
    schemaVersion: M15_V1_SCHEMA_VERSION,
    canonicalSerializationVersion: M15_CANONICAL_SERIALIZATION_VERSION,
    checksumAlgorithm: M15_CHECKSUM_ALGORITHM,
    backupId: "backup-m15-verifier",
    ownerUserId: OWNER_ID,
    createdByUserId: OWNER_ID,
    label: "Verifier",
    createdAt: NOW,
    summarySnapshot: { clientsCount: 0, consultationsCount: 0, appointmentsCount: 0, notificationsCount: 0, workspacesCount: 0 },
    counts: { clients: 0, analyses: 0, consultations: 0, imageAssets: bodies.length, imageAnalyses: 0, imageAnalysisReviews: 0 },
    limits: {
      maxArtifactBytes: 8 * 1024 * 1024,
      maxSectionBytes: 2 * 1024 * 1024,
      maxRowsPerSection: { clients: 2000, analyses: 10000, consultations: 10000, imageAssets: 10000, imageAnalyses: 10000, imageAnalysisReviews: 20000 },
    },
    sections: {
      clients: [], analyses: [], consultations: [], imageAnalyses: [], imageAnalysisReviews: [],
      imageAssets: bodies.map(({ assetId, body }) => ({
        id: assetId,
        fileName: `${assetId}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: body.byteLength,
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
          backend: "s3",
          bucketAlias: "images",
          key: `v1/owners/${OWNER_ID}/assets/${assetId}/original`,
          versionId: `version-${assetId}`,
          contentSha256: sha256(body),
          sizeBytes: body.byteLength,
        },
        storageEtag: null,
        storageState: "available",
        storageMigratedAt: NOW,
        objectDeletedAt: null,
        lastStorageErrorCode: null,
      })),
    },
  };
  return buildBackupM15V1Artifact(input);
}

function fakeStorage(artifact = createArtifact(), options: FakeOptions = {}): ObjectStorage {
  const byKey = new Map(artifact.sections.imageAssets.map((asset) => [asset.objectReference.key, asset]));
  return {
    put: vi.fn(async () => { throw new Error("not used"); }),
    delete: vi.fn(async () => undefined),
    head: vi.fn(async (identity) => {
      if (options.head) return options.head(identity);
      const asset = byKey.get(identity.key);
      if (!asset) throw new ObjectStorageError("not_found");
      return {
        ...identity,
        versionId: identity.versionId ?? null,
        etag: null,
        contentSha256: asset.objectReference.contentSha256,
        sizeBytes: asset.objectReference.sizeBytes,
        contentType: asset.mimeType,
      };
    }),
    get: vi.fn(async (identity) => {
      if (options.get) return options.get(identity);
      const asset = byKey.get(identity.key);
      if (!asset) throw new ObjectStorageError("not_found");
      const body = new TextEncoder().encode(asset.id === ASSET_A_ID ? "first-object" : "second-object");
      return {
        ...identity,
        versionId: identity.versionId ?? null,
        etag: null,
        contentSha256: asset.objectReference.contentSha256,
        sizeBytes: asset.objectReference.sizeBytes,
        contentType: asset.mimeType,
        body: streamChunks([body.slice(0, 3), body.slice(3)]),
      };
    }),
  };
}

function resolver(storage: ObjectStorage): M15ObjectStorageAliasResolver {
  return vi.fn(async (alias) => alias === "images" ? storage : null);
}

function fixedNow(): Date {
  return new Date(NOW);
}

describe("backup-m15-external-reference-verifier", () => {
  it("verifies one exact-version reference", async () => {
    const artifact = createArtifact();
    const storage = fakeStorage(artifact);
    await expect(verifyM15ExternalReferences({ artifact, resolveStorage: resolver(storage), now: fixedNow })).resolves.toEqual({
      status: "verified", code: "verified", verifiedAt: NOW, totalReferences: 1, verifiedReferences: 1,
    });
  });

  it("verifies multiple references in deterministic asset order", async () => {
    const artifact = createArtifact([
      { assetId: ASSET_B_ID, body: new TextEncoder().encode("second-object") },
      { assetId: ASSET_A_ID, body: new TextEncoder().encode("first-object") },
    ]);
    const storage = fakeStorage(artifact);
    const result = await verifyM15ExternalReferences({ artifact, resolveStorage: resolver(storage), now: fixedNow });
    expect(result).toMatchObject({ status: "verified", totalReferences: 2, verifiedReferences: 2 });
    expect(vi.mocked(storage.head).mock.calls.map(([identity]) => identity.key)).toEqual([
      `v1/owners/${OWNER_ID}/assets/${ASSET_A_ID}/original`,
      `v1/owners/${OWNER_ID}/assets/${ASSET_B_ID}/original`,
    ]);
  });

  it("fails closed for an unknown alias", async () => {
    const artifact = createArtifact();
    const storage = fakeStorage(artifact);
    const result = await verifyM15ExternalReferences({ artifact, resolveStorage: vi.fn(async () => null), now: fixedNow });
    expect(result).toMatchObject({ status: "failed", code: "unknown_alias", referenceIndex: 0, assetId: ASSET_A_ID });
    expect(storage.head).not.toHaveBeenCalled();
  });

  it("maps resolver failures without leaking details", async () => {
    const result = await verifyM15ExternalReferences({
      artifact: createArtifact(),
      resolveStorage: vi.fn(async () => { throw new Error("endpoint=https://secret physical-bucket credentials"); }),
      now: fixedNow,
    });
    expect(result).toMatchObject({ status: "failed", code: "storage_unavailable" });
    expect(JSON.stringify(result)).not.toMatch(/endpoint|bucket|credentials|secret/i);
  });

  it("does not access provider when the artifact is invalid or versionId is missing", async () => {
    const storage = fakeStorage();
    const resolveStorage = resolver(storage);
    const invalid = structuredClone(createArtifact()) as unknown as { sections: { imageAssets: Array<{ objectReference: { versionId?: string } }> } };
    delete invalid.sections.imageAssets[0].objectReference.versionId;
    const result = await verifyM15ExternalReferences({ artifact: invalid, resolveStorage, now: fixedNow });
    expect(result).toMatchObject({ status: "failed", code: "invalid_reference", totalReferences: 0 });
    expect(resolveStorage).not.toHaveBeenCalled();
    expect(storage.head).not.toHaveBeenCalled();
  });

  it.each([
    ["missing_object", new ObjectStorageError("not_found")],
    ["storage_access_denied", new ObjectStorageError("access_denied")],
    ["storage_timeout", new ObjectStorageError("timeout")],
    ["storage_unavailable", new ObjectStorageError("provider_unavailable")],
  ])("maps HEAD errors to safe %s", async (code, error) => {
    const artifact = createArtifact();
    const storage = fakeStorage(artifact, { head: async () => { throw error; } });
    const result = await verifyM15ExternalReferences({ artifact, resolveStorage: resolver(storage), now: fixedNow });
    expect(result).toMatchObject({ status: "failed", code });
    expect(storage.get).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(error.message);
  });

  it("rejects a different HEAD version and skips GET", async () => {
    const artifact = createArtifact();
    const reference = artifact.sections.imageAssets[0].objectReference;
    const storage = fakeStorage(artifact, { head: async () => ({ ...reference, versionId: "other", etag: "private-etag", contentType: "image/jpeg" }) });
    const result = await verifyM15ExternalReferences({ artifact, resolveStorage: resolver(storage), now: fixedNow });
    expect(result).toMatchObject({ status: "failed", code: "version_mismatch" });
    expect(storage.get).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private-etag");
  });

  it("rejects a different HEAD object identity and skips GET", async () => {
    const artifact = createArtifact();
    const reference = artifact.sections.imageAssets[0].objectReference;
    const storage = fakeStorage(artifact, { head: async () => ({ ...reference, key: "different-key", etag: null, contentType: "image/jpeg" }) });
    const result = await verifyM15ExternalReferences({ artifact, resolveStorage: resolver(storage), now: fixedNow });
    expect(result).toMatchObject({ status: "failed", code: "identity_mismatch" });
    expect(storage.get).not.toHaveBeenCalled();
  });

  it.each([
    ["size_mismatch", { sizeBytes: 99 }],
    ["checksum_metadata_mismatch", { contentSha256: "f".repeat(64) }],
  ])("rejects HEAD %s and skips GET", async (code, change) => {
    const artifact = createArtifact();
    const reference = artifact.sections.imageAssets[0].objectReference;
    const storage = fakeStorage(artifact, { head: async () => ({ ...reference, etag: null, contentType: "image/jpeg", ...change }) });
    const result = await verifyM15ExternalReferences({ artifact, resolveStorage: resolver(storage), now: fixedNow });
    expect(result).toMatchObject({ status: "failed", code });
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("uses the same exact identity for HEAD and GET with no versionless fallback", async () => {
    const artifact = createArtifact();
    const storage = fakeStorage(artifact);
    await verifyM15ExternalReferences({ artifact, resolveStorage: resolver(storage), now: fixedNow });
    const expected = artifact.sections.imageAssets[0].objectReference;
    expect(storage.head).toHaveBeenCalledOnce();
    expect(storage.get).toHaveBeenCalledOnce();
    expect(vi.mocked(storage.head).mock.calls[0][0]).toEqual({ bucketAlias: expected.bucketAlias, key: expected.key, versionId: expected.versionId });
    expect(vi.mocked(storage.get).mock.calls[0][0]).toEqual(vi.mocked(storage.head).mock.calls[0][0]);
    expect(vi.mocked(storage.head).mock.calls.every(([identity]) => typeof identity.versionId === "string" && identity.versionId.length > 0)).toBe(true);
  });

  it("hashes multiple chunks incrementally without full-body APIs", async () => {
    const artifact = createArtifact();
    const reference = artifact.sections.imageAssets[0].objectReference;
    const chunks = [new TextEncoder().encode("first-"), new TextEncoder().encode("object")];
    const body = streamChunks(chunks);
    expect("arrayBuffer" in body).toBe(false);
    const storage = fakeStorage(artifact, { get: async (identity) => ({ ...reference, ...identity, etag: null, contentType: "image/jpeg", body }) });
    await expect(verifyM15ExternalReferences({ artifact, resolveStorage: resolver(storage), now: fixedNow })).resolves.toMatchObject({ status: "verified" });
  });

  it("rejects a wrong streamed checksum", async () => {
    const artifact = createArtifact();
    const reference = artifact.sections.imageAssets[0].objectReference;
    const body = streamChunks([new TextEncoder().encode("other-object")]);
    const storage = fakeStorage(artifact, { get: async (identity) => ({ ...reference, ...identity, etag: null, contentType: null, body }) });
    await expect(verifyM15ExternalReferences({ artifact, resolveStorage: resolver(storage), now: fixedNow })).resolves.toMatchObject({ status: "failed", code: "streamed_checksum_mismatch" });
  });

  it("rejects a streamed byte-count mismatch and premature close", async () => {
    const artifact = createArtifact();
    const reference = artifact.sections.imageAssets[0].objectReference;
    const body = streamChunks([new TextEncoder().encode("short")]);
    const storage = fakeStorage(artifact, { get: async (identity) => ({ ...reference, ...identity, etag: null, contentType: null, body }) });
    await expect(verifyM15ExternalReferences({ artifact, resolveStorage: resolver(storage), now: fixedNow })).resolves.toMatchObject({ status: "failed", code: "streamed_size_mismatch" });
  });

  it("cancels streaming when the maximum byte limit is exceeded", async () => {
    const artifact = createArtifact();
    const reference = artifact.sections.imageAssets[0].objectReference;
    const cancelled = vi.fn();
    const body = streamChunks([new Uint8Array(8), new Uint8Array(8)], cancelled);
    const storage = fakeStorage(artifact, { get: async (identity) => ({ ...reference, ...identity, etag: null, contentType: null, body }) });
    const result = await verifyM15ExternalReferences({ artifact, resolveStorage: resolver(storage), maxStreamBytes: 12, now: fixedNow });
    expect(result).toMatchObject({ status: "failed", code: "stream_limit_exceeded" });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("stops before resolving or calling the provider for later references after failure", async () => {
    const artifact = createArtifact([
      { assetId: ASSET_A_ID, body: new TextEncoder().encode("first-object") },
      { assetId: ASSET_B_ID, body: new TextEncoder().encode("second-object") },
    ]);
    const storage = fakeStorage(artifact, { head: async () => { throw new ObjectStorageError("not_found"); } });
    const resolveStorage = resolver(storage);
    const result = await verifyM15ExternalReferences({ artifact, resolveStorage, now: fixedNow });
    expect(result).toMatchObject({ status: "failed", code: "missing_object", referenceIndex: 0, verifiedReferences: 0 });
    expect(resolveStorage).toHaveBeenCalledOnce();
    expect(storage.head).toHaveBeenCalledOnce();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("returns only safe evidence fields", async () => {
    const artifact = createArtifact();
    const storage = fakeStorage(artifact);
    const result = await verifyM15ExternalReferences({ artifact, resolveStorage: resolver(storage), now: fixedNow });
    expect(Object.keys(result).sort()).toEqual(["code", "status", "totalReferences", "verifiedAt", "verifiedReferences"]);
    expect(JSON.stringify(result)).not.toMatch(/key|version|etag|endpoint|bucket|credential|url/i);
  });
});