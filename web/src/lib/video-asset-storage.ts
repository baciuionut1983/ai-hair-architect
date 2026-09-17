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

// Stage 8.5L3 -- PRIVATE LEARNING VIDEO UPLOAD. Persists a professional's
// own uploaded source video (never a provider-generated one) as a durable
// VideoAsset row, reusing the exact same object-storage decision and
// put-then-verify-via-head integrity discipline as
// persistGeneratedVideoDemonstrationAsset above -- no second video storage
// system. The ONE deliberate difference: origin is explicitly
// "uploaded_source" (schema.prisma's own documented VideoAsset.origin
// value for this exact path), never left to the "generated_output"
// column default, so an uploaded teaching video and a generated Result
// Video remain distinguishable by construction, never by inference.
//
// Buffer-based, matching the app's own established upload discipline
// (uploadAndAnalyzeImages, the voice-transcript route) -- the caller is
// responsible for enforcing a safe maximum size BEFORE this function is
// ever called (see learning-evidence-video-upload.ts's own
// MAX_LEARNING_VIDEO_BYTES and its header comment on why a much larger
// "Ionuț has large complete professional videos" upload is explicitly NOT
// supported by this function).
export async function persistUploadedLearningVideoAsset(
  ownerUserId: string,
  clientId: string,
  videoBuffer: Buffer,
  mimeType: string,
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
      storagePath: "pending",
      origin: "uploaded_source",
    },
  });

  try {
    if (objectStorageTarget) {
      await writeVideoToObjectStorage(asset, videoBuffer, mimeType, objectStorageTarget);
    } else {
      const storagePath = await saveImageFile(ownerUserId, asset.id, `learning-evidence-${Date.now()}.${extensionForMimeType(mimeType)}`, videoBuffer);
      await prisma.videoAsset.update({ where: { id: asset.id }, data: { storagePath, contentSha256: sha256(videoBuffer) } });
    }
  } catch (error) {
    // Same fail-closed shape as persistGeneratedVideoDemonstrationAsset:
    // the row stays exactly as created (storageBackend=null,
    // storagePath="pending") -- never orphaned in a way that hides what
    // happened, and never silently retried with different bytes. The
    // caller (the /learning-evidence/video route) reports this as a
    // clean failure; no ProfessionalLearningEvidence row is ever created
    // for a VideoAsset whose storage write failed.
    throw new VideoAssetStorageError(error instanceof Error ? error.message : "Failed to persist uploaded video to durable storage.");
  }

  return prisma.videoAsset.findUniqueOrThrow({ where: { id: asset.id } });
}

// Exported (unchanged, unbehaviored) -- Video UI's own content-serving
// route (video-assets/[id]/content) reuses this exact mapping for its
// Content-Disposition filename, rather than a second, duplicated table.
export function extensionForMimeType(mimeType: string): string {
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/quicktime") return "mov";
  return "mp4";
}

// Stage 8.5L3.1 -- registers a VideoAsset for bytes that are ALREADY
// durably in S3 (uploaded directly by the browser via a multipart
// session -- see professional-learning-video-multipart-upload-service.ts).
// Deliberately does NOT call put()/writeVideoToObjectStorage: this
// application never receives the video bytes at all for this path, by
// design (Part 31: "GB-scale professional media must not be proxied
// through application memory"). The caller is responsible for having
// already independently verified the object exists with the given
// size/contentType via a real head() call BEFORE this function is ever
// invoked (Part 11/22) -- this function only records that already-proven
// fact.
//
// contentSha256 stays null: a real whole-object SHA-256 would require
// downloading the entire (possibly multi-GB) object back into this
// process, exactly the anti-pattern this stage exists to avoid. The
// provider's own ETag (storageEtag) is the integrity signal for a
// multipart-assembled object instead -- a composite hash S3 itself
// computes from the uploaded parts, not a plain whole-file MD5/SHA-256,
// but still proof the object matches exactly the parts this application
// authorized and later verified via CompleteMultipartUpload.
// Stage 8.5T1.3.R1 -- records the AUTHORITATIVE playback duration of an
// ALREADY-UPLOADED professional learning source video, derived from the
// provider's own file-processing metadata (never a client-declared
// number, never a model estimate -- see professional-learning-extractor-
// gemini.ts's parseGeminiFileVideoDurationSeconds). Reuses the existing
// VideoAsset.durationSeconds column verbatim -- no new column, no
// migration.
//
// Deliberately NARROW, ownership-scoped, origin-scoped, write-once:
//   - `ownerUserId` in the WHERE clause -- a caller can never set
//     duration on a video it does not own (a wrong-owner call matches
//     zero rows, a silent no-op, never an error that would leak whether
//     the id exists for someone else).
//   - `origin: "uploaded_source"` in the WHERE clause -- a generated
//     Result Video (origin "generated_output", written exclusively by
//     persistGeneratedVideoDemonstrationAsset with its own, unrelated
//     REQUESTED-duration semantics) can never be touched by this
//     function, even if a caller passed its id by mistake.
//   - `durationSeconds: null` in the WHERE clause -- write-once. An
//     already-recorded value is never overwritten by a later
//     (re)extraction; this also makes the function naturally idempotent
//     across retries/reanalysis.
// `updateMany` (never `update`): a zero-match outcome (wrong owner,
// wrong origin, already set, or an id that does not exist) is an
// expected, silent no-op here, never a thrown error -- this is always a
// best-effort side effect of extraction, never a gate on it.
const MAX_SANE_UPLOADED_VIDEO_DURATION_SECONDS = 4 * 60 * 60;

export async function recordUploadedVideoAssetDuration(ownerUserId: string, videoAssetId: string, durationSeconds: number): Promise<void> {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_SANE_UPLOADED_VIDEO_DURATION_SECONDS) {
    // Not sane enough to trust -- silently ignored. Better an unknown
    // duration (fail-honest) than a garbled one persisted as fact.
    return;
  }
  await prisma.videoAsset.updateMany({
    where: { id: videoAssetId, ownerUserId, origin: "uploaded_source", durationSeconds: null },
    data: { durationSeconds },
  });
}

export async function registerCompletedMultipartVideoAsset(input: {
  ownerUserId: string;
  clientId: string;
  bucketAlias: string;
  key: string;
  versionId: string | null;
  etag: string | null;
  mimeType: string;
  sizeBytes: number;
}): Promise<VideoAsset> {
  return prisma.videoAsset.create({
    data: {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      clientId: input.clientId,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storagePath: input.key,
      storageBackend: "s3",
      storageBucketAlias: input.bucketAlias,
      storageKey: input.key,
      storageVersionId: input.versionId,
      storageEtag: input.etag,
      origin: "uploaded_source",
    },
  });
}
