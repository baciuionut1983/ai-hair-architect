import { prisma } from "@/lib/prisma";
import { readImageFile } from "@/lib/image-storage";
import { drainBoundedWebStream, OversizedStreamError } from "@/lib/image-analysis-processing-service";
import { createObjectStorageAliasResolver } from "@/lib/object-storage-alias-resolver";
import type { M15ObjectStorageAliasResolver } from "@/lib/backup-m15-external-reference-verifier";
import type { ProfessionalLearningExtractorVideoMedia } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R1 -- PRIVATE
// VIDEO MEDIA RESOLUTION. Mirrors professional-learning-image-media-
// resolver.ts's own discipline exactly: an ownership-scoped lookup
// (WHERE-clause scoped, never filtered after the fact -- a foreign or
// nonexistent asset resolves identically to "not found") that turns a
// ProfessionalLearningEvidence's videoAssetId pointer into real bytes.
//
// T1.1 Issue #2 -- the S3-backed branch below is the fix for a real
// production failure: EVERY real multipart-uploaded video has
// storageBackend="s3" (registerCompletedMultipartVideoAsset,
// video-asset-storage.ts, sets this unconditionally), so the old
// LOCAL-ONLY implementation always fell through to a hardcoded
// "unavailable" result for real evidence, before the real Gemini
// extractor was ever invoked.
//
// DELIBERATELY DOES NOT reuse VideoAssetStorageRepository/
// toExactObjectReference (used by video-assets/[id]/content/route.ts
// for playback): that path REQUIRES a non-null contentSha256, which
// registerCompletedMultipartVideoAsset never sets for a real multipart
// upload (its own header comment: computing a whole-object hash would
// require downloading the entire, possibly multi-GB object back into
// this process -- exactly the anti-pattern this stage exists to avoid).
// Reusing that stricter contract here would silently reproduce the same
// "unavailable" failure for exactly the videos this fix targets. Instead
// this resolver reads the VideoAsset's own storage columns directly
// (already fetched by the ownership-scoped query below) and verifies
// what IS available: bucket/key identify the exact object (never a
// caller-supplied value), an optional pinned versionId is honored when
// present, and the freshly-read object's own reported size is
// cross-checked against the size this application itself already
// verified via a real S3 head() at upload completion time
// (completeVideoUploadSession) -- the same size-based integrity
// discipline that function itself already applies, extended to the read
// side.
//
// SHARED, NOT DUPLICATED: createObjectStorageAliasResolver (the exact
// bucket-alias -> ObjectStorage resolution every other S3 consumer in
// this app already uses) and drainBoundedWebStream (the exact bounded-
// memory stream-to-Buffer primitive loadValidatedImageBuffer's own
// S3 branch already uses for images, now exported from
// image-analysis-processing-service.ts) are reused verbatim -- no second
// S3 client, no second streaming implementation.

export type ResolveLearningEvidenceVideoMediaReason = "VIDEO_ASSET_NOT_FOUND" | "VIDEO_UNAVAILABLE" | "VIDEO_TOO_LARGE" | "STORAGE_READ_FAILURE";

export type ResolveLearningEvidenceVideoMediaResult =
  | { readonly status: "resolved"; readonly media: ProfessionalLearningExtractorVideoMedia }
  | { readonly status: "unavailable"; readonly reason: ResolveLearningEvidenceVideoMediaReason };

// Generous relative to Gemini's own inline-request ceiling -- this is a
// last-resort safety bound on what this acceptance-sized reader will ever
// load fully into memory, not a claim about what any provider transport
// can accept (the File API path used for the real provider call has its
// own, separate size handling).
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export async function resolveLearningEvidenceVideoMedia(
  ownerUserId: string,
  videoAssetId: string,
  resolveObjectStorage: M15ObjectStorageAliasResolver = createObjectStorageAliasResolver(),
): Promise<ResolveLearningEvidenceVideoMediaResult> {
  const asset = await prisma.videoAsset.findFirst({ where: { id: videoAssetId, ownerUserId, deletedAt: null } });
  if (!asset) return { status: "unavailable", reason: "VIDEO_ASSET_NOT_FOUND" };
  if (asset.storagePath === "pending") return { status: "unavailable", reason: "VIDEO_UNAVAILABLE" };

  if (asset.storageBackend === null || asset.storageBackend === undefined) {
    let buffer: Buffer;
    try {
      buffer = await readImageFile(asset.storagePath);
    } catch {
      return { status: "unavailable", reason: "STORAGE_READ_FAILURE" };
    }
    if (buffer.length > MAX_VIDEO_BYTES) return { status: "unavailable", reason: "VIDEO_TOO_LARGE" };
    return { status: "resolved", media: { buffer, mimeType: asset.mimeType } };
  }

  if (asset.storageBackend === "s3") {
    // The exact object this evidence's OWN row already points at -- never
    // a caller-supplied key/URL, and never a different asset's reference.
    if (!asset.storageBucketAlias || !asset.storageKey) {
      return { status: "unavailable", reason: "STORAGE_READ_FAILURE" };
    }

    // Reject before ever touching the network when the size this
    // application already independently verified via a real S3 head()
    // at upload-completion time alone proves this exceeds the bound.
    if (asset.sizeBytes > MAX_VIDEO_BYTES) return { status: "unavailable", reason: "VIDEO_TOO_LARGE" };

    let storage;
    try {
      storage = await resolveObjectStorage(asset.storageBucketAlias);
    } catch {
      return { status: "unavailable", reason: "STORAGE_READ_FAILURE" };
    }
    if (!storage) return { status: "unavailable", reason: "STORAGE_READ_FAILURE" };

    let stored;
    try {
      stored = await storage.get({ bucketAlias: asset.storageBucketAlias, key: asset.storageKey, versionId: asset.storageVersionId });
    } catch {
      return { status: "unavailable", reason: "STORAGE_READ_FAILURE" };
    }

    // Cross-check against the size already verified at upload time --
    // never trust the freshly-read object's reported size alone, mirroring
    // completeVideoUploadSession's own "never trust size after the fact"
    // discipline, extended to the read side.
    if (stored.sizeBytes !== asset.sizeBytes) {
      return { status: "unavailable", reason: "STORAGE_READ_FAILURE" };
    }

    let buffer: Buffer;
    try {
      buffer = await drainBoundedWebStream(stored.body, MAX_VIDEO_BYTES);
    } catch (error) {
      if (error instanceof OversizedStreamError) return { status: "unavailable", reason: "VIDEO_TOO_LARGE" };
      return { status: "unavailable", reason: "STORAGE_READ_FAILURE" };
    }

    return { status: "resolved", media: { buffer, mimeType: asset.mimeType } };
  }

  return { status: "unavailable", reason: "STORAGE_READ_FAILURE" };
}
