import type { PrismaClient, VideoAsset } from "@prisma/client";

import type { ObjectReference } from "./object-storage";
import { ObjectStorageError } from "./object-storage-errors";

// Video UI, Result Visualization -- the one backend gap Stage 3's own
// report named ("no route serving video bytes to a browser yet"). A
// near-verbatim mirror of image-asset-storage-repository.ts (VideoAsset's
// own storage columns are identical in shape to ImageAsset's, by Stage 1's
// own deliberate design) -- never a new, competing storage-reference
// pattern.

type VideoAssetClient = Pick<PrismaClient, "videoAsset">;

export class VideoAssetStorageRepository {
  constructor(private readonly client: VideoAssetClient) {}

  async findByOwner(ownerUserId: string, assetId: string): Promise<VideoAsset | null> {
    assertOwnerScope(ownerUserId, assetId);
    return this.client.videoAsset.findFirst({
      where: { id: assetId, ownerUserId },
    });
  }

  async findObjectReferenceByOwner(ownerUserId: string, assetId: string): Promise<ObjectReference | null> {
    const asset = await this.findByOwner(ownerUserId, assetId);
    if (!asset) {
      return null;
    }
    if (asset.storageBackend !== "s3" || !asset.storageBucketAlias || !asset.storageKey || !asset.contentSha256) {
      throw new ObjectStorageError("configuration");
    }

    return {
      backend: "s3",
      bucketAlias: asset.storageBucketAlias,
      key: asset.storageKey,
      versionId: asset.storageVersionId,
      etag: asset.storageEtag,
      contentSha256: asset.contentSha256,
      sizeBytes: asset.sizeBytes,
    };
  }
}

function assertOwnerScope(ownerUserId: string, assetId: string): void {
  if (!ownerUserId.trim() || !assetId.trim()) {
    throw new TypeError("ownerUserId and assetId are required.");
  }
}
