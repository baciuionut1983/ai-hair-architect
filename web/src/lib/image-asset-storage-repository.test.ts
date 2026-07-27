import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ImageAssetStorageRepository } from "./image-asset-storage-repository";

describe("ImageAssetStorageRepository", () => {
  it("always scopes asset lookup by ownerUserId and assetId", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new ImageAssetStorageRepository({ imageAsset: { findFirst } } as unknown as PrismaClient);
    await expect(repository.findByOwner("owner-1", "asset-1")).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "asset-1", ownerUserId: "owner-1" } });
  });

  it("requires both owner and asset identifiers", async () => {
    const findFirst = vi.fn();
    const repository = new ImageAssetStorageRepository({ imageAsset: { findFirst } } as unknown as PrismaClient);
    await expect(repository.findByOwner("", "asset-1")).rejects.toThrow("ownerUserId and assetId");
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("returns only a complete S3 object reference for the requested owner", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      storageBackend: "s3",
      storageBucketAlias: "images",
      storageKey: "v1/owners/o/assets/a/original",
      storageVersionId: "v1",
      storageEtag: "etag",
      contentSha256: "a".repeat(64),
      sizeBytes: 42
    });
    const repository = new ImageAssetStorageRepository({ imageAsset: { findFirst } } as unknown as PrismaClient);
    await expect(repository.findObjectReferenceByOwner("owner-1", "asset-1")).resolves.toMatchObject({
      backend: "s3",
      bucketAlias: "images",
      sizeBytes: 42
    });
  });
});