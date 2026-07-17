-- CreateTable ImageAsset
CREATE TABLE "ImageAsset" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "exifStripped" BOOLEAN NOT NULL DEFAULT false,
    "normalizedOrientation" INTEGER NOT NULL DEFAULT 0,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "retentionDeletesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable ImageAnalysis
CREATE TABLE "ImageAnalysis" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "providerName" TEXT NOT NULL DEFAULT 'manual-only',
    "modelVersion" TEXT NOT NULL DEFAULT 'mock-1.0',
    "analysisPayload" JSONB NOT NULL DEFAULT '{}',
    "confidences" JSONB NOT NULL DEFAULT '{}',
    "unknownFields" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "limitations" JSONB NOT NULL DEFAULT '[]',
    "consentTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "retentionDeletesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable ImageAnalysisReview
CREATE TABLE "ImageAnalysisReview" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "manualCorrections" JSONB NOT NULL DEFAULT '{}',
    "confirmationTimestamp" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageAnalysisReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImageAsset_ownerUserId_idx" ON "ImageAsset"("ownerUserId");

-- CreateIndex
CREATE INDEX "ImageAsset_clientId_idx" ON "ImageAsset"("clientId");

-- CreateIndex
CREATE INDEX "ImageAsset_ownerUserId_clientId_idx" ON "ImageAsset"("ownerUserId", "clientId");

-- CreateIndex
CREATE INDEX "ImageAsset_deletedAt_idx" ON "ImageAsset"("deletedAt");

-- CreateIndex
CREATE INDEX "ImageAnalysis_assetId_idx" ON "ImageAnalysis"("assetId");

-- CreateIndex
CREATE INDEX "ImageAnalysis_status_idx" ON "ImageAnalysis"("status");

-- CreateIndex
CREATE INDEX "ImageAnalysis_deletedAt_idx" ON "ImageAnalysis"("deletedAt");

-- CreateIndex
CREATE INDEX "ImageAnalysisReview_analysisId_idx" ON "ImageAnalysisReview"("analysisId");

-- CreateIndex
CREATE INDEX "ImageAnalysisReview_reviewedByUserId_idx" ON "ImageAnalysisReview"("reviewedByUserId");

-- AddForeignKey - ImageAnalysis.assetId
ALTER TABLE "ImageAnalysis" ADD CONSTRAINT "ImageAnalysis_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ImageAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey - ImageAnalysisReview.analysisId
ALTER TABLE "ImageAnalysisReview" ADD CONSTRAINT "ImageAnalysisReview_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ImageAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey - Analysis.imageAssetId (optional - can be null)
ALTER TABLE "Analysis" ADD COLUMN "imageAssetId" TEXT;
ALTER TABLE "Analysis" ADD COLUMN "imageAnalysisId" TEXT;
ALTER TABLE "Analysis" ADD COLUMN "m8DraftCreatedAt" TIMESTAMP(3);
ALTER TABLE "Analysis" ADD COLUMN "m8FinalizedAt" TIMESTAMP(3);
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "ImageAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_imageAnalysisId_fkey" FOREIGN KEY ("imageAnalysisId") REFERENCES "ImageAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddIndex
CREATE INDEX "Analysis_imageAssetId_idx" ON "Analysis"("imageAssetId");
CREATE INDEX "Analysis_imageAnalysisId_idx" ON "Analysis"("imageAnalysisId");
