import type { ImageAsset, PrismaClient } from "@prisma/client";

import type { ObjectReference } from "./object-storage";
import { ObjectStorageError } from "./object-storage-errors";

type ImageAssetClient = Pick<PrismaClient, "imageAsset">;

export class ImageAssetStorageRepository {
  constructor(private readonly client: ImageAssetClient) {}

  async findByOwner(ownerUserId: string, assetId: string): Promise<ImageAsset | null> {
    assertOwnerScope(ownerUserId, assetId);
    return this.client.imageAsset.findFirst({
      where: { id: assetId, ownerUserId }
    });
  }

  async findObjectReferenceByOwner(
    ownerUserId: string,
    assetId: string
  ): Promise<ObjectReference | null> {
    const asset = await this.findByOwner(ownerUserId, assetId);
    if (!asset) {
      return null;
    }
    if (
      asset.storageBackend !== "s3" ||
      !asset.storageBucketAlias ||
      !asset.storageKey ||
      !asset.contentSha256
    ) {
      throw new ObjectStorageError("configuration");
    }

    return {
      backend: "s3",
      bucketAlias: asset.storageBucketAlias,
      key: asset.storageKey,
      versionId: asset.storageVersionId,
      etag: asset.storageEtag,
      contentSha256: asset.contentSha256,
      sizeBytes: asset.sizeBytes
    };
  }
}

function assertOwnerScope(ownerUserId: string, assetId: string): void {
  if (!ownerUserId.trim() || !assetId.trim()) {
    throw new TypeError("ownerUserId and assetId are required.");
  }
}