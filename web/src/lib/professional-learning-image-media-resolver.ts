import { prisma } from "@/lib/prisma";
import { createObjectStorageAliasResolver } from "@/lib/object-storage-alias-resolver";
import { loadValidatedImageBuffer, ProcessingPreClaimError, type AssetStorageRow } from "@/lib/image-analysis-processing-service";
import type { ProfessionalLearningExtractorImageMedia } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R2 -- PRIVATE
// IMAGE MEDIA RESOLUTION (Part 9/11). Deliberately reuses
// loadValidatedImageBuffer (image-analysis-processing-service.ts)
// UNCHANGED -- the exact same ownership-scoped, bounded-size,
// real-byte-MIME-validated, dual-backend (S3/legacy-local) read every
// other image-consuming feature in this app already uses (that file's
// own header already documents Photo Preview reusing it for the
// identical reason: "rather than a second, competing implementation").
// This file adds NO new image transport of its own -- it only adds the
// ownership-scoped LOOKUP that turns a ProfessionalLearningEvidence's
// imageAssetId pointer into the AssetStorageRow that function expects.
//
// PRIVACY (Part 11): the resulting bytes are read into memory ONCE,
// base64-encoded inline into the Gemini request body (professional-
// learning-extractor-gemini.ts), and never touch any other host --  no
// public URL is ever created, no S3 bucket policy or CORS is ever
// touched, nothing is uploaded anywhere. This is the SAME transport
// mechanism image-analysis-provider-gemini.ts already uses in production
// for client photo analysis.
//
// OWNERSHIP IS FAIL-CLOSED: the ImageAsset lookup is scoped by
// ownerUserId in the WHERE clause itself (never filtered after the
// fact) -- a foreign or nonexistent asset resolves to `null`,
// indistinguishable from each other to the caller, exactly like every
// other ownership-scoped lookup in this codebase.

export type ResolveLearningEvidenceImageMediaResult =
  | { readonly status: "resolved"; readonly media: ProfessionalLearningExtractorImageMedia }
  | { readonly status: "unavailable"; readonly reason: string };

export async function resolveLearningEvidenceImageMedia(ownerUserId: string, imageAssetId: string): Promise<ResolveLearningEvidenceImageMediaResult> {
  const asset = await prisma.imageAsset.findFirst({ where: { id: imageAssetId, ownerUserId } });
  if (!asset) {
    return { status: "unavailable", reason: "IMAGE_ASSET_NOT_FOUND" };
  }

  const assetRow: AssetStorageRow = {
    id: asset.id,
    ownerUserId: asset.ownerUserId,
    clientId: asset.clientId,
    mimeType: asset.mimeType,
    storageBackend: asset.storageBackend,
    storagePath: asset.storagePath,
    storageState: asset.storageState,
    contentSha256: asset.contentSha256,
  };

  try {
    const buffer = await loadValidatedImageBuffer(assetRow, createObjectStorageAliasResolver());
    return { status: "resolved", media: { buffer, mimeType: asset.mimeType } };
  } catch (error) {
    if (error instanceof ProcessingPreClaimError) {
      return { status: "unavailable", reason: error.code };
    }
    return { status: "unavailable", reason: "STORAGE_READ_FAILURE" };
  }
}
