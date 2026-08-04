import { createHash } from 'crypto';

import { ImageAsset, ImageAnalysis } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  validateUploadBatch,
  validateMagicBytes,
  sanitizeFileName,
} from '@/lib/image-upload-validation';
import { saveImageFile } from '@/lib/image-storage';
import { processImageForStorage } from '@/lib/image-normalizer';
import { ManualOnlyProvider, ImageAnalysisResult } from '@/lib/image-analysis-provider';
import { buildImageAssetObjectKey, type ObjectStorage } from '@/lib/object-storage';
import { createObjectStorageAliasResolver } from '@/lib/object-storage-alias-resolver';
import {
  loadObjectStorageConfig,
  validateObjectStorageWriteMode,
  type ObjectStorageMode,
} from '@/lib/object-storage-config';

export interface UploadedAsset {
  asset: ImageAsset;
  analysis: ImageAnalysis;
}

// Deliberately not imported from any backup/restore module (this is the live
// upload path, not a backup consumer) -- matches createObjectStorageAliasResolver's
// own real return type exactly.
type ObjectStorageResolver = (bucketAlias: string) => ObjectStorage | null | Promise<ObjectStorage | null>;

interface ObjectStorageWriteTarget {
  bucketAlias: string;
  resolve: ObjectStorageResolver;
}

// Resolved once per upload batch (not per-file), so every file in the same
// request is classified identically -- deterministic, no per-file coin-flip.
function resolveObjectStorageWriteTarget(): ObjectStorageWriteTarget | null {
  const { mode } = validateObjectStorageWriteMode(process.env);
  if (mode !== 'enabled') {
    return null;
  }

  const config = loadObjectStorageConfig(process.env, resolveRuntimeMode(process.env.NODE_ENV));
  if (config.backend !== 's3') {
    // Fail closed: an enabled write mode paired with a non-s3 configuration is a
    // misconfiguration, never a silent local-storage fallback.
    throw new Error('Object storage write mode is enabled but object storage is not configured for the s3 backend.');
  }

  return { bucketAlias: config.bucketAlias, resolve: createObjectStorageAliasResolver() };
}

function resolveRuntimeMode(nodeEnv: string | undefined): ObjectStorageMode {
  if (nodeEnv === 'production' || nodeEnv === 'development' || nodeEnv === 'test') {
    return nodeEnv;
  }
  return 'unknown';
}

async function writeImageToObjectStorage(
  asset: ImageAsset,
  body: Buffer,
  contentType: string,
  target: ObjectStorageWriteTarget
): Promise<void> {
  const contentSha256 = createHash('sha256').update(body).digest('hex');

  const storage = await target.resolve(target.bucketAlias);
  if (!storage) {
    throw new Error('Object storage is unavailable for the configured bucket alias.');
  }

  const reference = await storage.put({
    key: buildImageAssetObjectKey(asset.ownerUserId, asset.id),
    body,
    contentType,
    contentSha256,
  });

  // Integrity is confirmed via an independent head() round-trip against the
  // exact returned version, never assumed from the put() response alone.
  const verification = await storage.head({
    bucketAlias: reference.bucketAlias,
    key: reference.key,
    versionId: reference.versionId,
  });

  if (
    !reference.versionId ||
    verification.versionId !== reference.versionId ||
    verification.contentSha256 !== contentSha256 ||
    verification.sizeBytes !== body.length
  ) {
    throw new Error('Object storage integrity verification failed.');
  }

  // Single atomic update: the row only ever transitions from
  // storageBackend=null to a fully-populated, "available" object-backed row.
  // No intermediate object-backed state is ever persisted.
  await prisma.imageAsset.update({
    where: { id: asset.id },
    data: {
      storageBackend: 's3',
      storageBucketAlias: reference.bucketAlias,
      storageKey: reference.key,
      storageVersionId: reference.versionId,
      storageEtag: reference.etag,
      contentSha256,
      storageState: 'available',
      storageMigratedAt: null,
      objectDeletedAt: null,
      lastStorageErrorCode: null,
    },
  });
}

export async function uploadAndAnalyzeImages(
  userId: string,
  clientId: string,
  files: File[]
): Promise<UploadedAsset[]> {
  const validation = validateUploadBatch(files);
  if (validation) {
    throw new Error(validation.message);
  }

  const objectStorageTarget = resolveObjectStorageWriteTarget();

  const results: UploadedAsset[] = [];

  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(buffer);

    const magicValid = await validateMagicBytes(buffer, file.type);
    if (!magicValid) {
      throw new Error(`Invalid file format: ${file.name}`);
    }

    const processed = await processImageForStorage(Buffer.from(uint8), file.type);

    const asset = await prisma.imageAsset.create({
      data: {
        fileName: sanitizeFileName(file.name),
        mimeType: file.type,
        sizeBytes: processed.buffer.length,
        ownerUserId: userId,
        clientId,
        storagePath: `pending`,
        exifStripped: processed.exifStripped,
        normalizedOrientation: processed.orientation,
      },
    });

    if (objectStorageTarget) {
      // No local-disk fallback: a failure here leaves the row exactly as
      // created (storageBackend=null, storagePath="pending") and the upload
      // request fails closed.
      await writeImageToObjectStorage(asset, processed.buffer, file.type, objectStorageTarget);
    } else {
      const storagePath = await saveImageFile(userId, asset.id, asset.fileName, processed.buffer);

      await prisma.imageAsset.update({
        where: { id: asset.id },
        data: { storagePath },
      });
    }

    // Upload never invokes an AI provider -- it only creates the canonical
    // "not yet analyzed" placeholder (M21). processImageAnalysis (invoked
    // later, only after explicit consent via request-ai-analysis) remains
    // the sole place that ever calls a real AI provider. providerName stays
    // PLACEHOLDER_PROVIDER_NAME ("manual-only", matching
    // image-analysis-job-repository.ts's own constant) and consent stays
    // unset, so queueAnalysisForExternalProvider can later recognize this
    // exact row as a fresh, reusable placeholder rather than creating a
    // second one.
    const placeholder = new ManualOnlyProvider();
    const placeholderResult = await placeholder.analyze();

    const analysis = await prisma.imageAnalysis.create({
      data: {
        assetId: asset.id,
        status: 'draft',
        providerName: placeholder.name,
        modelVersion: placeholder.modelVersion,
        analysisPayload: placeholderResult.result as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        confidences: placeholderResult.confidences as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        unknownFields: Object.entries(placeholderResult.result)
          .filter(([, v]) => v === 'unknown' || v === null)
          .map(([k]) => k),
        warnings: placeholderResult.warnings,
        limitations: placeholderResult.limitations,
      },
    });

    const updatedAsset = await prisma.imageAsset.findUniqueOrThrow({
      where: { id: asset.id },
    });

    results.push({
      asset: updatedAsset,
      analysis,
    });
  }

  return results;
}

export async function reviewAnalysis(
  analysisId: string,
  corrections: Partial<ImageAnalysisResult>,
  userId: string
): Promise<ImageAnalysis> {
  const analysis = await prisma.imageAnalysis.findUniqueOrThrow({
    where: { id: analysisId },
  });

  if (analysis.status !== 'draft') {
    throw new Error('Only draft analyses can be reviewed');
  }

  await prisma.imageAnalysisReview.create({
    data: {
      analysisId,
      reviewedByUserId: userId,
      manualCorrections: corrections,
      confirmationTimestamp: new Date(),
    },
  });

  const updatedAnalysis = await prisma.imageAnalysis.update({
    where: { id: analysisId },
    data: {
      status: 'confirmed',
      analysisPayload: Object.assign({}, analysis.analysisPayload || {}, corrections),
    },
  });

  return updatedAnalysis;
}
