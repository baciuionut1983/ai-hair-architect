import type { ImageAsset } from "@prisma/client";

import {
  ObjectStorageWriteModeRequiredError,
  resolveObjectStorageWriteTarget,
  resolveRuntimeMode,
  writeImageToObjectStorage,
} from "@/lib/image-analysis-service";
import { saveImageFile } from "@/lib/image-storage";
import { processImageForStorage } from "@/lib/image-normalizer";
import { sanitizeFileName, validateMagicBytes, validateUploadBatch, type UploadValidationError } from "@/lib/image-upload-validation";
import { prisma } from "@/lib/prisma";

// AI Hair Architect, Professional Skill Engine Stage 8.5L3 -- LEARNING
// EVIDENCE IMAGE INGESTION. Reuses the EXACT canonical ImageAsset
// creation pipeline uploadAndAnalyzeImages (image-analysis-service.ts)
// already uses -- the same validateUploadBatch/validateMagicBytes/
// sanitizeFileName validation, the same processImageForStorage (EXIF
// strip + orientation normalize), the same durable S3/local storage
// decision (resolveObjectStorageWriteTarget/writeImageToObjectStorage/
// saveImageFile). Deliberately does NOT call uploadAndAnalyzeImages
// itself, and creates NO ImageAnalysis row: that row is
// client-photo-analysis product surface (M21's "not yet analyzed"
// placeholder feeding into Analysis review), which has no meaning for a
// private teaching photo and would incorrectly surface teaching material
// inside a client's analysis history (Stage 8.5L2's own "Learning
// Evidence != user/client content" rule). Task Part 6/11: "reuse
// existing canonical image infrastructure... do not create another image
// storage system" -- this file is exactly that reuse, minus the one
// piece (ImageAnalysis) that belongs to a different product surface.
//
// clientId here is INFRASTRUCTURE-ONLY storage scoping, never evidence
// scoping: ImageAsset.clientId remains a required column on the
// foundational, unmodified ImageAsset model (out of scope to change in
// this stage -- see the Stage 8.5L3 report's own "asset ownership
// resolution" section), but the resulting ProfessionalLearningEvidence
// row (professional-learning-evidence-repository.ts) carries no clientId
// at all and is never presented anywhere as "belonging to" this client.

export class LearningEvidenceImageValidationError extends Error {
  constructor(readonly detail: UploadValidationError) {
    super(detail.message);
    this.name = "LearningEvidenceImageValidationError";
  }
}

export class LearningEvidenceImageMagicBytesError extends Error {
  constructor(readonly fileName: string) {
    super(`File content does not match its declared type: ${fileName}`);
    this.name = "LearningEvidenceImageMagicBytesError";
  }
}

// Creates ONE canonical ImageAsset per file, in order -- the caller
// decides whether the result becomes a single IMAGE/DIAGRAM evidence row
// (one file) or an IMAGE_SET evidence row via a CaptureSet (multiple
// files, see learning-evidence-repository-actions.ts). Order is
// preserved (files[i] -> result[i]), matching Part 7's "preserve
// ordering where current CaptureSet supports it".
export async function uploadLearningEvidenceImageAssets(
  ownerUserId: string,
  clientId: string,
  files: readonly File[],
): Promise<ImageAsset[]> {
  const validation = validateUploadBatch([...files]);
  if (validation) {
    throw new LearningEvidenceImageValidationError(validation);
  }

  const objectStorageTarget = resolveObjectStorageWriteTarget();
  if (!objectStorageTarget && resolveRuntimeMode(process.env.NODE_ENV) === "production") {
    throw new ObjectStorageWriteModeRequiredError();
  }

  const created: ImageAsset[] = [];
  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(buffer);

    const magicValid = await validateMagicBytes(buffer, file.type);
    if (!magicValid) {
      throw new LearningEvidenceImageMagicBytesError(file.name);
    }

    const processed = await processImageForStorage(Buffer.from(uint8), file.type);

    const asset = await prisma.imageAsset.create({
      data: {
        fileName: sanitizeFileName(file.name),
        mimeType: file.type,
        sizeBytes: processed.buffer.length,
        ownerUserId,
        clientId,
        storagePath: "pending",
        exifStripped: processed.exifStripped,
        normalizedOrientation: processed.orientation,
        width: processed.width,
        height: processed.height,
      },
    });

    if (objectStorageTarget) {
      await writeImageToObjectStorage(asset, processed.buffer, file.type, objectStorageTarget);
    } else {
      const storagePath = await saveImageFile(ownerUserId, asset.id, asset.fileName, processed.buffer);
      await prisma.imageAsset.update({ where: { id: asset.id }, data: { storagePath } });
    }

    created.push(await prisma.imageAsset.findUniqueOrThrow({ where: { id: asset.id } }));
  }

  return created;
}
