-- M18 GO-1: consent evidence, provider-attempt ledger, and quota/claim
-- foundation for ImageAnalysis. Purely additive: no existing table, column,
-- constraint, or index is altered in a destructive way, dropped, or renamed.
-- No existing row's existing data is modified.
--
-- This file was generated via `prisma migrate diff` against the live test
-- database and then manually curated to remove unrelated pre-existing drift
-- picked up by that diff (out-of-date WebhookEndpoint/Notification/
-- WebhookDelivery/OpsBackupRestore*/WebhookEndpointSecretVersion constraint
-- and index definitions, plus Analysis/Client column adjustments, already
-- present in the database ahead of any migration file) -- none of that drift
-- is part of M18's scope and none of it is included below.
--
-- ImageAnalysis intentionally gains no ownerUserId column: it is already
-- reachable via the existing ImageAsset.ownerUserId relation, and adding a
-- new NOT NULL column here would have required touching the upload flow and
-- the M15 restore path, both out of scope for GO-1. Only the new
-- ImageAnalysisProviderAttempt ledger table -- which has no pre-existing
-- callers -- carries its own ownerUserId.

-- AlterTable
ALTER TABLE "ImageAnalysis"
  ADD COLUMN "externalAiConsentGrantedAt" TIMESTAMP(6),
  ADD COLUMN "externalAiConsentVersion" VARCHAR(32),
  ADD COLUMN "lastFailureCode" VARCHAR(80);

-- CreateTable
CREATE TABLE "ImageAnalysisProviderAttempt" (
    "id" TEXT NOT NULL,
    "imageAnalysisId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "providerName" VARCHAR(64) NOT NULL,
    "modelVersion" VARCHAR(64) NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageAnalysisProviderAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImageAnalysisProviderAttempt_ownerUserId_createdAt_idx" ON "ImageAnalysisProviderAttempt"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ImageAnalysisProviderAttempt_imageAnalysisId_idx" ON "ImageAnalysisProviderAttempt"("imageAnalysisId");

-- CreateIndex
CREATE UNIQUE INDEX "ImageAnalysisProviderAttempt_imageAnalysisId_attemptNumber_key" ON "ImageAnalysisProviderAttempt"("imageAnalysisId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "ImageAnalysisProviderAttempt" ADD CONSTRAINT "ImageAnalysisProviderAttempt_imageAnalysisId_fkey" FOREIGN KEY ("imageAnalysisId") REFERENCES "ImageAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageAnalysisProviderAttempt" ADD CONSTRAINT "ImageAnalysisProviderAttempt_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
