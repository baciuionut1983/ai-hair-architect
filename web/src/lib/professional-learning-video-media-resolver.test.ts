import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { deleteImageFile, saveImageFile } from "@/lib/image-storage";
import { resolveLearningEvidenceVideoMedia } from "@/lib/professional-learning-video-media-resolver";
import { ObjectStorageError } from "@/lib/object-storage-errors";
import type { ObjectStorage, StoredObject } from "@/lib/object-storage";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R1 -- real
// Postgres + real local file, no mocks. Mirrors professional-learning-
// image-media-resolver.test.ts's own fixture pattern exactly -- reuses
// saveImageFile/deleteImageFile for the local video bytes (already
// content-agnostic, see the resolver's own header comment).
//
// T1.1 Issue #2 -- the S3-backed tests below use a hand-built fake
// ObjectStorage (mirroring image-analysis-processing-service.test.ts's
// own createFakeObjectStorage exactly), injected via the resolver's own
// optional third parameter -- zero real network calls, zero real S3
// client. Every S3 fixture deliberately OMITS contentSha256 (left null),
// matching registerCompletedMultipartVideoAsset's real production shape
// for a genuine multipart-uploaded video -- this is the exact case the
// old implementation always failed on.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();
const localPaths = new Set<string>();
const FAKE_MP4_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 1, 2, 3, 4]);

function webStreamOf(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

function createFakeS3Storage(entries: Map<string, Buffer>, options?: { reportedSizeOverride?: number }): ObjectStorage {
  return {
    async get({ bucketAlias, key, versionId }): Promise<StoredObject> {
      const data = entries.get(`${key}::${versionId ?? "null"}`);
      if (!data) throw new ObjectStorageError("not_found");
      return {
        bucketAlias,
        key,
        versionId: versionId ?? null,
        etag: "\"fake-etag\"",
        contentSha256: null,
        sizeBytes: options?.reportedSizeOverride ?? data.length,
        contentType: "video/mp4",
        body: webStreamOf(data),
      };
    },
    async put() {
      throw new Error("not implemented in test fake");
    },
    async head() {
      throw new Error("not implemented in test fake");
    },
    async delete() {
      throw new Error("not implemented in test fake");
    },
  };
}

async function createS3VideoAsset(
  ownerUserId: string,
  clientId: string,
  bytes: Buffer,
  fields?: { storageBucketAlias?: string | null; storageKey?: string | null; storageVersionId?: string | null; sizeBytes?: number },
) {
  const assetId = randomUUID();
  const key = `owners/${ownerUserId}/assets/${assetId}/original`;
  const versionId = randomUUID();
  await prisma.videoAsset.create({
    data: {
      id: assetId,
      ownerUserId,
      clientId,
      mimeType: "video/mp4",
      sizeBytes: fields?.sizeBytes ?? bytes.length,
      storagePath: key,
      storageBackend: "s3",
      storageBucketAlias: fields && "storageBucketAlias" in fields ? fields.storageBucketAlias : "test-bucket-alias",
      storageKey: fields && "storageKey" in fields ? fields.storageKey : key,
      storageVersionId: fields && "storageVersionId" in fields ? fields.storageVersionId : versionId,
      storageEtag: "\"fake-etag\"",
      // Deliberately no contentSha256 -- see file header: this is the
      // real shape of a multipart-uploaded video.
      origin: "uploaded_source",
    },
  });
  return { assetId, bucketAlias: "test-bucket-alias", key, versionId };
}

suite("resolveLearningEvidenceVideoMedia (Stage 8.5L5.R1, real DB + real local file)", () => {
  afterEach(async () => {
    for (const path of localPaths) {
      await deleteImageFile(path).catch(() => undefined);
    }
    localPaths.clear();
    const ownerUserIds = [...owners];
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("resolves the real bytes for an owned, available, local-backend video asset", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const assetId = randomUUID();
    const storagePath = await saveImageFile(ownerUserId, assetId, "video.mp4", FAKE_MP4_BYTES);
    localPaths.add(storagePath);
    await prisma.videoAsset.create({
      data: { id: assetId, ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: FAKE_MP4_BYTES.length, storagePath, storageBackend: null, origin: "uploaded_source" },
    });

    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, assetId);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.media.mimeType).toBe("video/mp4");
    expect(Buffer.compare(result.media.buffer, FAKE_MP4_BYTES)).toBe(0);
  });

  it("IDOR: another user cannot resolve media for User A's video asset -- indistinguishable from nonexistent", async () => {
    const { ownerUserId: userA, clientId } = await createOwnerAndClient();
    const userB = await createOwner();
    const assetId = randomUUID();
    const storagePath = await saveImageFile(userA, assetId, "video.mp4", FAKE_MP4_BYTES);
    localPaths.add(storagePath);
    await prisma.videoAsset.create({
      data: { id: assetId, ownerUserId: userA, clientId, mimeType: "video/mp4", sizeBytes: FAKE_MP4_BYTES.length, storagePath, storageBackend: null, origin: "uploaded_source" },
    });

    const asUserA = await resolveLearningEvidenceVideoMedia(userA, assetId);
    const asUserB = await resolveLearningEvidenceVideoMedia(userB, assetId);

    expect(asUserA.status).toBe("resolved");
    expect(asUserB).toEqual({ status: "unavailable", reason: "VIDEO_ASSET_NOT_FOUND" });
  });

  it("returns unavailable (never throws) for a nonexistent asset id", async () => {
    const ownerUserId = await createOwner();
    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, randomUUID());
    expect(result).toEqual({ status: "unavailable", reason: "VIDEO_ASSET_NOT_FOUND" });
  });

  it("returns unavailable for an asset whose bytes were never actually stored (storagePath = pending)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const assetId = randomUUID();
    await prisma.videoAsset.create({
      data: { id: assetId, ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: 100, storagePath: "pending", storageBackend: null, origin: "uploaded_source" },
    });

    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, assetId);
    expect(result).toEqual({ status: "unavailable", reason: "VIDEO_UNAVAILABLE" });
  });

  // T1.1 Issue #2 -- the fix: a real S3-backed video (the exact shape of
  // a genuine multipart upload -- no contentSha256) now resolves real
  // bytes through the shared, reused S3 primitives, zero real network.
  it("resolves the real bytes for an owned, ACTIVE S3-backed video asset (the real production shape -- no contentSha256)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { assetId, bucketAlias, key, versionId } = await createS3VideoAsset(ownerUserId, clientId, FAKE_MP4_BYTES);
    const entries = new Map([[`${key}::${versionId}`, FAKE_MP4_BYTES]]);

    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, assetId, async (alias) => (alias === bucketAlias ? createFakeS3Storage(entries) : null));

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.media.mimeType).toBe("video/mp4");
    expect(Buffer.compare(result.media.buffer, FAKE_MP4_BYTES)).toBe(0);
  });

  it("uses exactly the bucket alias, key, and version this evidence's own row references -- never a different or caller-supplied object", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { assetId, bucketAlias, key, versionId } = await createS3VideoAsset(ownerUserId, clientId, FAKE_MP4_BYTES);
    const wrongObject = Buffer.from("this is a different object's bytes, never returned");
    const entries = new Map([
      [`${key}::${versionId}`, FAKE_MP4_BYTES],
      [`some-other-key::${versionId}`, wrongObject],
      [`${key}::a-different-version`, wrongObject],
    ]);
    let capturedBucketAlias: string | undefined;

    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, assetId, async (alias) => {
      capturedBucketAlias = alias;
      return createFakeS3Storage(entries);
    });

    expect(capturedBucketAlias).toBe(bucketAlias);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(Buffer.compare(result.media.buffer, FAKE_MP4_BYTES)).toBe(0);
  });

  it("IDOR: another user cannot resolve media for User A's S3-backed video asset -- indistinguishable from nonexistent", async () => {
    const { ownerUserId: userA, clientId } = await createOwnerAndClient();
    const userB = await createOwner();
    const { assetId, key, versionId } = await createS3VideoAsset(userA, clientId, FAKE_MP4_BYTES);
    const entries = new Map([[`${key}::${versionId}`, FAKE_MP4_BYTES]]);
    const resolver = async () => createFakeS3Storage(entries);

    const asUserA = await resolveLearningEvidenceVideoMedia(userA, assetId, resolver);
    const asUserB = await resolveLearningEvidenceVideoMedia(userB, assetId, resolver);

    expect(asUserA.status).toBe("resolved");
    expect(asUserB).toEqual({ status: "unavailable", reason: "VIDEO_ASSET_NOT_FOUND" });
  });

  it("fails closed (never invokes storage at all) when the row is missing its bucket alias or key -- a genuine configuration inconsistency, never guessed at", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { assetId } = await createS3VideoAsset(ownerUserId, clientId, FAKE_MP4_BYTES, { storageKey: null });
    let storageInvoked = false;

    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, assetId, async () => {
      storageInvoked = true;
      return createFakeS3Storage(new Map());
    });

    expect(storageInvoked).toBe(false);
    expect(result).toEqual({ status: "unavailable", reason: "STORAGE_READ_FAILURE" });
  });

  it("fails closed when the referenced object does not exist in storage", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { assetId } = await createS3VideoAsset(ownerUserId, clientId, FAKE_MP4_BYTES);

    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, assetId, async () => createFakeS3Storage(new Map()));

    expect(result).toEqual({ status: "unavailable", reason: "STORAGE_READ_FAILURE" });
  });

  it("fails closed when the storage provider throws (a generic read failure)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { assetId } = await createS3VideoAsset(ownerUserId, clientId, FAKE_MP4_BYTES);
    const failingStorage: ObjectStorage = {
      async get() {
        throw new Error("simulated network failure");
      },
      async put() {
        throw new Error("not implemented in test fake");
      },
      async head() {
        throw new Error("not implemented in test fake");
      },
      async delete() {
        throw new Error("not implemented in test fake");
      },
    };

    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, assetId, async () => failingStorage);

    expect(result).toEqual({ status: "unavailable", reason: "STORAGE_READ_FAILURE" });
  });

  it("fails closed when the alias resolver itself cannot resolve the configured bucket", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { assetId } = await createS3VideoAsset(ownerUserId, clientId, FAKE_MP4_BYTES);

    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, assetId, async () => null);

    expect(result).toEqual({ status: "unavailable", reason: "STORAGE_READ_FAILURE" });
  });

  it("rejects BEFORE ever touching storage when the already-verified recorded size alone exceeds the bound", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { assetId } = await createS3VideoAsset(ownerUserId, clientId, FAKE_MP4_BYTES, { sizeBytes: 201 * 1024 * 1024 });
    let storageInvoked = false;

    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, assetId, async () => {
      storageInvoked = true;
      return createFakeS3Storage(new Map());
    });

    expect(storageInvoked).toBe(false);
    expect(result).toEqual({ status: "unavailable", reason: "VIDEO_TOO_LARGE" });
  });

  it("fails closed (never trusts the freshly-read object alone) when the object's actual size no longer matches the size verified at upload time", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { assetId, key, versionId } = await createS3VideoAsset(ownerUserId, clientId, FAKE_MP4_BYTES);
    const entries = new Map([[`${key}::${versionId}`, FAKE_MP4_BYTES]]);

    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, assetId, async () => createFakeS3Storage(entries, { reportedSizeOverride: FAKE_MP4_BYTES.length + 1 }));

    expect(result).toEqual({ status: "unavailable", reason: "STORAGE_READ_FAILURE" });
  });
});

async function createOwner(): Promise<string> {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@l5r1-video-media-resolver.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  return ownerUserId;
}

async function createOwnerAndClient(): Promise<{ ownerUserId: string; clientId: string }> {
  const ownerUserId = await createOwner();
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "L5.R1 Video Media Resolver Client" } });
  return { ownerUserId, clientId };
}
