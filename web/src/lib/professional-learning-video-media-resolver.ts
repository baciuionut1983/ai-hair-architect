import { prisma } from "@/lib/prisma";
import { readImageFile } from "@/lib/image-storage";
import type { ProfessionalLearningExtractorVideoMedia } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R1 -- PRIVATE
// VIDEO MEDIA RESOLUTION. Mirrors professional-learning-image-media-
// resolver.ts's own discipline exactly: an ownership-scoped lookup
// (WHERE-clause scoped, never filtered after the fact -- a foreign or
// nonexistent asset resolves identically to "not found") that turns a
// ProfessionalLearningEvidence's videoAssetId pointer into real bytes.
//
// LOCAL-BACKEND ONLY, DELIBERATELY (Section 5/38 of this stage's task --
// "NO PRODUCTION S3 WRITE"): readImageFile (image-storage.ts) is reused
// verbatim -- it is already completely content-agnostic (confined local
// file read, no image-specific validation), exactly like
// persistUploadedLearningVideoAsset (video-asset-storage.ts) already
// reuses saveImageFile verbatim for the write side. An S3-backed video
// read is deliberately NOT implemented here: this acceptance stage never
// writes video bytes to S3 (persistUploadedLearningVideoAsset's own
// local-storage fallback is relied on by construction, since no
// production object-storage write mode is configured for this test), so
// there is no real, tested consumer for an S3 read path yet. Building it
// now, untested, would repeat exactly the "premature infrastructure"
// pattern Stage 8.5L5's own report flagged for the byte-level reader as a
// whole -- one level deeper. A future stage that genuinely needs it
// should build and test it against a real S3-backed video row.

export type ResolveLearningEvidenceVideoMediaReason = "VIDEO_ASSET_NOT_FOUND" | "VIDEO_UNAVAILABLE" | "VIDEO_TOO_LARGE" | "STORAGE_READ_FAILURE" | "VIDEO_S3_READ_NOT_IMPLEMENTED";

export type ResolveLearningEvidenceVideoMediaResult =
  | { readonly status: "resolved"; readonly media: ProfessionalLearningExtractorVideoMedia }
  | { readonly status: "unavailable"; readonly reason: ResolveLearningEvidenceVideoMediaReason };

// Generous relative to Gemini's own inline-request ceiling -- this is a
// last-resort safety bound on what this acceptance-sized reader will ever
// load fully into memory, not a claim about what any provider transport
// can accept (the File API path used for the real provider call has its
// own, separate size handling).
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export async function resolveLearningEvidenceVideoMedia(ownerUserId: string, videoAssetId: string): Promise<ResolveLearningEvidenceVideoMediaResult> {
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

  return { status: "unavailable", reason: "VIDEO_S3_READ_NOT_IMPLEMENTED" };
}
