import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { buildImageAssetObjectKey, toExactObjectReference } from "./object-storage";
import type { S3ObjectStorageConfig } from "./object-storage-config";
import { classifyObjectStorageError, ObjectStorageError } from "./object-storage-errors";
import { S3ObjectStorage } from "./object-storage-s3";

const ownerUserId = "123e4567-e89b-42d3-a456-426614174000";
const assetId = "223e4567-e89b-42d3-a456-426614174000";

describe("object storage", () => {
  it("builds a deterministic PII-free key from trusted IDs", () => {
    expect(buildImageAssetObjectKey(ownerUserId, assetId)).toBe(
      `owners/${ownerUserId}/assets/${assetId}/original`
    );
    expect(() => buildImageAssetObjectKey("person@example.com", assetId)).toThrow("trusted UUID");
  });

  it("requires a complete exact-version reference for Phase 2 consumers", () => {
    const reference = {
      backend: "s3" as const,
      bucketAlias: "images",
      key: `v1/owners/${ownerUserId}/assets/${assetId}/original`,
      versionId: "version-1",
      etag: "etag-1",
      contentSha256: "a".repeat(64),
      sizeBytes: 3
    };

    expect(toExactObjectReference(reference)).toEqual(reference);
    expect(() => toExactObjectReference({ ...reference, versionId: null })).toThrow("exact-version");
    expect(() => toExactObjectReference({ ...reference, versionId: " " })).toThrow("exact-version");
  });

  it("creates the S3 client lazily and maps put metadata", async () => {
    const send = vi.fn().mockResolvedValue({ VersionId: "version-1", ETag: "etag-1" });
    const factory = vi.fn(() => ({ send }) as unknown as S3Client);
    const storage = new S3ObjectStorage(config(), factory);
    expect(factory).not.toHaveBeenCalled();

    const reference = await storage.put({
      key: buildImageAssetObjectKey(ownerUserId, assetId),
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
      contentSha256: "a".repeat(64)
    });

    expect(factory).toHaveBeenCalledOnce();
    expect(reference).toEqual({
      backend: "s3",
      bucketAlias: "images",
      key: `v1/owners/${ownerUserId}/assets/${assetId}/original`,
      versionId: "version-1",
      etag: "etag-1",
      contentSha256: "a".repeat(64),
      sizeBytes: 3
    });
  });

  it("omits server-side encryption when the explicit mode is none", async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new S3ObjectStorage(config({ serverSideEncryption: "none" }), () => ({ send }) as unknown as S3Client);

    await storage.put(putInput());

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).not.toHaveProperty("ServerSideEncryption");
    expect(command.input).not.toHaveProperty("SSEKMSKeyId");
  });

  it("sends exactly AES256 when that mode is configured", async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new S3ObjectStorage(config({ serverSideEncryption: "AES256" }), () => ({ send }) as unknown as S3Client);

    await storage.put(putInput());

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input.ServerSideEncryption).toBe("AES256");
    expect(command.input).not.toHaveProperty("SSEKMSKeyId");
  });

  it("returns typed safe errors without provider details", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("bucket-secret/key-secret"), {
      name: "AccessDenied",
      $metadata: { httpStatusCode: 403 }
    }));
    const storage = new S3ObjectStorage(config(), () => ({ send }) as unknown as S3Client);

    await expect(storage.head({ bucketAlias: "images", key: "v1/test" })).rejects.toMatchObject({
      code: "access_denied",
      message: "Object storage denied the operation.",
      retryable: false
    });
  });

  it("keeps contract and unknown provider failures safe", () => {
    expect(new ObjectStorageError("missing_version")).toMatchObject({
      message: "An exact object version is required.",
      retryable: false
    });
    expect(new ObjectStorageError("integrity_mismatch")).toMatchObject({ retryable: false });
    expect(classifyObjectStorageError(new Error("endpoint-and-bucket-secret"))).toMatchObject({
      code: "provider_unavailable",
      message: "Object storage is temporarily unavailable.",
      retryable: true
    });
  });

  it("rejects an identity outside the configured alias or prefix before network I/O", async () => {
    const send = vi.fn();
    const storage = new S3ObjectStorage(config(), () => ({ send }) as unknown as S3Client);
    await expect(storage.delete({ bucketAlias: "other", key: "v1/key" })).rejects.toMatchObject({ code: "configuration" });
    expect(send).not.toHaveBeenCalled();
  });
});

function config(overrides: Partial<S3ObjectStorageConfig> = {}): S3ObjectStorageConfig {
  return {
    backend: "s3",
    bucketAlias: "images",
    bucket: "physical-test-bucket",
    region: "test-1",
    forcePathStyle: true,
    serverSideEncryption: "none",
    prefix: "v1",
    requestTimeoutMs: 1000,
    ...overrides
  };
}

function putInput() {
  return {
    key: buildImageAssetObjectKey(ownerUserId, assetId),
    body: new Uint8Array([1, 2, 3]),
    contentType: "image/jpeg",
    contentSha256: "a".repeat(64)
  };
}