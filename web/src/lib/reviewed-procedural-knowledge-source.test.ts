import { describe, expect, it, vi } from "vitest";
import type { ObjectMetadata, ObjectStorage } from "@/lib/object-storage";
import { isReviewedProceduralSourceAccessible, type ReviewedProceduralVideoSource } from "@/lib/reviewed-procedural-knowledge-source";

const asset: ReviewedProceduralVideoSource = { id: "video-id", ownerUserId: "owner-a", mimeType: "video/mp4", sizeBytes: 1024, storagePath: "uploaded", storageBackend: "s3", storageBucketAlias: "private", storageKey: "prefix/owners/owner-a/assets/upload-session-id/original", storageVersionId: "version-1", storageEtag: '"etag"', contentSha256: null };
function storage(patch: Partial<ObjectMetadata> = {}) {
  const fake: ObjectStorage = {
    head: vi.fn().mockResolvedValue({ bucketAlias: asset.storageBucketAlias, key: asset.storageKey, versionId: asset.storageVersionId, etag: asset.storageEtag, contentSha256: null, sizeBytes: asset.sizeBytes, contentType: asset.mimeType, ...patch }),
    get: vi.fn(), put: vi.fn(), delete: vi.fn(),
  };
  return fake;
}
describe("T1.5 source accessibility uses metadata only", () => {
  it("supports multipart without a content hash, honors pinned version, and never fetches bytes or writes", async () => {
    const fake = storage();
    expect(await isReviewedProceduralSourceAccessible(asset, async () => fake)).toBe(true);
    expect(fake.head).toHaveBeenCalledWith({ bucketAlias: "private", key: asset.storageKey, versionId: "version-1" });
    for (const method of [fake.get, fake.put, fake.delete]) expect(method).not.toHaveBeenCalled();
  });
  it("supports the existing optional-version contract", async () => {
    expect(await isReviewedProceduralSourceAccessible({ ...asset, storageVersionId: null, storageEtag: null }, async () => storage({ versionId: null, etag: null }))).toBe(true);
  });
  it.each([{ sizeBytes: 1025 }, { contentType: "image/png" }, { versionId: "wrong" }, { etag: "wrong" }, { key: "wrong" }, { bucketAlias: "wrong" }])("fails closed for metadata mismatch %j", async patch => {
    expect(await isReviewedProceduralSourceAccessible(asset, async () => storage(patch))).toBe(false);
  });
  it("checks the content hash when the asset actually has one", async () => {
    expect(await isReviewedProceduralSourceAccessible({ ...asset, contentSha256: "known-hash" }, async () => storage())).toBe(false);
    expect(await isReviewedProceduralSourceAccessible({ ...asset, contentSha256: "known-hash" }, async () => storage({ contentSha256: "known-hash" }))).toBe(true);
  });
  it.each([{ storageKey: null }, { storageBucketAlias: null }, { storageKey: "prefix/owners/owner-b/assets/upload-session-id/original" }, { storageBackend: "other" }, { sizeBytes: 0 }, { storagePath: "pending" }])("does not touch storage for invalid source %j", async patch => {
    const resolver = vi.fn();
    expect(await isReviewedProceduralSourceAccessible({ ...asset, ...patch }, resolver)).toBe(false);
    expect(resolver).not.toHaveBeenCalled();
  });
  it("fails closed for missing aliases, inaccessible objects, and resolver errors", async () => {
    expect(await isReviewedProceduralSourceAccessible(asset, async () => null)).toBe(false);
    expect(await isReviewedProceduralSourceAccessible(asset, async () => { throw new Error("offline"); })).toBe(false);
    const fake = storage();
    vi.mocked(fake.head).mockRejectedValue(new Error("missing object"));
    expect(await isReviewedProceduralSourceAccessible(asset, async () => fake)).toBe(false);
  });
});
