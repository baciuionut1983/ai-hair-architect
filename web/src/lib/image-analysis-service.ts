import { ImageAsset, ImageAnalysis } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  validateUploadBatch,
  validateMagicBytes,
  sanitizeFileName,
} from '@/lib/image-upload-validation';
import { saveImageFile } from '@/lib/image-storage';
import { processImageForStorage } from '@/lib/image-normalizer';
import { getProvider, ImageAnalysisResult } from '@/lib/image-analysis-provider';

export interface UploadedAsset {
  asset: ImageAsset;
  analysis: ImageAnalysis;
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

    const storagePath = await saveImageFile(userId, asset.id, asset.fileName, processed.buffer);

    await prisma.imageAsset.update({
      where: { id: asset.id },
      data: { storagePath },
    });

    const provider = getProvider('mock-deterministic');
    const analysisResult = await provider.analyze({
      imageBuffer: processed.buffer,
      mimeType: file.type,
      userId,
      clientId,
    });

    const analysis = await prisma.imageAnalysis.create({
      data: {
        assetId: asset.id,
        status: 'draft',
        providerName: provider.name,
        modelVersion: provider.modelVersion,
        analysisPayload: analysisResult.result as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        confidences: analysisResult.confidences as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        unknownFields: Object.entries(analysisResult.result)
          .filter(([, v]) => v === 'unknown' || v === null)
          .map(([k]) => k),
        warnings: analysisResult.warnings,
        limitations: analysisResult.limitations,
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

export async function getAnalysisForAsset(
  assetId: string,
  userId: string
): Promise<ImageAnalysis | null> {
  const analysis = await prisma.imageAnalysis.findFirst({
    where: {
      asset: {
        id: assetId,
        ownerUserId: userId,
      },
    },
  });

  return analysis || null;
}
