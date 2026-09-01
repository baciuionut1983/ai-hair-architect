import { createHash, randomUUID } from "crypto";

import type { VideoAsset } from "@prisma/client";

import { ObjectStorageWriteModeRequiredError, resolveObjectStorageWriteTarget, resolveRuntimeMode, type ObjectStorageWriteTarget } from "@/lib/image-analysis-service";
import { saveImageFile } from "@/lib/image-storage";
import { buildImageAssetObjectKey } from "@/lib/object-storage";
import { prisma } from "@/lib/prisma";

// Real AI Video Demonstration, Stage 1 -- persists a provider's generated
// video bytes as a brand-new, durable VideoAsset row.
//
// Reuses the EXACT same durable-storage decision an uploaded photo (and a
// generated Photo Preview image) goes through
// (resolveObjectStorageWriteTarget/resolveRuntimeMode from
// image-analysis-service.ts) -- never a second, competing storage path, and
// never allowed to silently land only on Railway's ephemeral local disk in
// production (ObjectStorageWriteModeRequiredError, same guard Photo Preview
// Stage 2 already reuses for the identical reason -- Video Stage 0 Decision
// Lock section 7/28: "durable production storage already exists, reuse
// it").
//
// Deliberately does NOT call writeImageToObjectStorage/processImageForStorage
// (photo-preview-output-storage.ts's own dependencies) -- those are typed
// specifically to ImageAsset and run image-only processing (EXIF, sharp
// re-encode) that has no meaning for video bytes. This module instead calls
// the SAME lower-level object-storage primitives (ObjectStorage.put/head,
// buildImageAssetObjectKey -- genuinely content-agnostic despite its name)
// directly, with the identical put-then-verify-via-head integrity
// discipline.
//
// buildImageAssetObjectKey/saveImageFile are reused verbatim (not
// duplicated) even though their names say "image" -- both are already
// completely generic (owner+asset-id keyed byte storage, no image-specific
// behavior); renaming them is out of this stage's scope (no unrelated
// refactor).

export const VIDEO_DEMONSTRATION_OUTPUT_ORIGIN = "ai_generated" as const;

export class VideoAssetStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoAssetStorageError";
  }
}

export async function persistGeneratedVideoDemonstrationAsset(
  ownerUserId: string,
  clientId: string,
  videoBuffer: Buffer,
  mimeType: string,
  durationSeconds: number | undefined,
): Promise<VideoAsset> {
  const objectStorageTarget = resolveObjectStorageWriteTarget();

  if (!objectStorageTarget && resolveRuntimeMode(process.env.NODE_ENV) === "production") {
    throw new ObjectStorageWriteModeRequiredError();
  }

  const asset = await prisma.videoAsset.create({
    data: {
      id: randomUUID(),
      ownerUserId,
      clientId,
      mimeType,
      sizeBytes: videoBuffer.length,
      durationSeconds: durationSeconds ?? null,
      storagePath: "pending",
    },
  });

  try {
    if (objectStorageTarget) {
      await writeVideoToObjectStorage(asset, videoBuffer, mimeType, objectStorageTarget);
    } else {
      const storagePath = await saveImageFile(ownerUserId, asset.id, `video-demonstration-${Date.now()}.${extensionForMimeType(mimeType)}`, videoBuffer);
      await prisma.videoAsset.update({ where: { id: asset.id }, data: { storagePath, contentSha256: sha256(videoBuffer) } });
    }
  } catch (error) {
    // The row already exists (id allocated above) but storage write failed
    // -- left exactly as-is (storageBackend=null, storagePath="pending"),
    // matching photo-preview-output-storage.ts's own fail-closed shape. The
    // caller (video-generation-execution-service.ts) is responsible for
    // treating this as VIDEO_DEMONSTRATION_STORAGE_FAILED and never marking
    // the parent generation COMPLETED.
    throw new VideoAssetStorageError(error instanceof Error ? error.message : "Failed to persist generated video to durable storage.");
  }

  return prisma.videoAsset.findUniqueOrThrow({ where: { id: asset.id } });
}

async function writeVideoToObjectStorage(asset: VideoAsset, body: Buffer, contentType: string, target: ObjectStorageWriteTarget): Promise<void> {
  const contentSha256 = sha256(body);

  const storage = await target.resolve(target.bucketAlias);
  if (!storage) {
    throw new Error("Object storage is unavailable for the configured bucket alias.");
  }

  const reference = await storage.put({
    key: buildImageAssetObjectKey(asset.ownerUserId, asset.id),
    body,
    contentType,
    contentSha256,
  });

  // Integrity confirmed via an independent head() round-trip against the
  // exact returned version -- identical discipline to
  // image-analysis-service.ts's own writeImageToObjectStorage, never
  // assumed from the put() response alone.
  const verification = await storage.head({ bucketAlias: reference.bucketAlias, key: reference.key, versionId: reference.versionId });

  if (!reference.versionId || verification.versionId !== reference.versionId || verification.contentSha256 !== contentSha256 || verification.sizeBytes !== body.length) {
    throw new Error("Object storage integrity verification failed.");
  }

  await prisma.videoAsset.update({
    where: { id: asset.id },
    data: {
      storagePath: reference.key,
      storageBackend: "s3",
      storageBucketAlias: reference.bucketAlias,
      storageKey: reference.key,
      storageVersionId: reference.versionId,
      storageEtag: reference.etag ?? null,
      contentSha256,
    },
  });
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// Exported (unchanged, unbehaviored) -- Video UI's own content-serving
// route (video-assets/[id]/content) reuses this exact mapping for its
// Content-Disposition filename, rather than a second, duplicated table.
export function extensionForMimeType(mimeType: string): string {
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/quicktime") return "mov";
  return "mp4";
}
