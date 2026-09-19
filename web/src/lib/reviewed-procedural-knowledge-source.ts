import { open, realpath } from "node:fs/promises";
import path from "node:path";
import type { VideoAsset } from "@prisma/client";
import { getStorageDir } from "@/lib/image-storage";
import { createObjectStorageAliasResolver } from "@/lib/object-storage-alias-resolver";
import type { M15ObjectStorageAliasResolver } from "@/lib/backup-m15-external-reference-verifier";

export type ReviewedProceduralVideoSource = Pick<VideoAsset, "id" | "ownerUserId" | "mimeType" | "sizeBytes" | "storagePath" | "storageBackend" | "storageBucketAlias" | "storageKey" | "storageVersionId" | "storageEtag" | "contentSha256">;

// Metadata-only read. No extractor, media download, mutation, or signed URL.
export async function isReviewedProceduralSourceAccessible(asset: ReviewedProceduralVideoSource, resolveStorage: M15ObjectStorageAliasResolver = createObjectStorageAliasResolver()): Promise<boolean> {
  try {
    if (asset.storagePath === "pending" || asset.sizeBytes <= 0) return false;
    if (asset.storageBackend === null) {
      const root = path.resolve(getStorageDir(asset.ownerUserId, asset.id));
      const lexical = path.resolve(asset.storagePath);
      if (!lexical.startsWith(root + path.sep)) return false;
      const actual = await realpath(lexical);
      // Also reject a symlink to a different owner's file inside storage.
      if (!actual.startsWith(root + path.sep)) return false;
      const file = await open(actual, "r");
      try {
        const stat = await file.stat();
        return stat.isFile() && stat.size === asset.sizeBytes;
      } finally {
        await file.close();
      }
    }
    if (asset.storageBackend !== "s3" || !asset.storageBucketAlias || !asset.storageKey) return false;
    // Existing key convention uses the upload-session UUID for multipart,
    // not necessarily VideoAsset.id; retain that contract and verify owner.
    const tail = asset.storageKey.split("/").slice(-5);
    if (tail[0] !== "owners" || tail[1] !== asset.ownerUserId || tail[2] !== "assets" || !tail[3] || tail[3] === ".." || tail[4] !== "original") return false;
    const storage = await resolveStorage(asset.storageBucketAlias);
    if (!storage) return false;
    const head = await storage.head({ bucketAlias: asset.storageBucketAlias, key: asset.storageKey, versionId: asset.storageVersionId });
    return head.bucketAlias === asset.storageBucketAlias && head.key === asset.storageKey && head.sizeBytes === asset.sizeBytes
      && head.contentType === asset.mimeType
      && (!asset.storageVersionId || head.versionId === asset.storageVersionId)
      && (!asset.storageEtag || head.etag === asset.storageEtag)
      && (!asset.contentSha256 || head.contentSha256 === asset.contentSha256);
  } catch {
    return false;
  }
}
