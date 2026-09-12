-- Professional Skill Engine, Stage 8.5L2 -- PROFESSIONAL LEARNING
-- EVIDENCE FOUNDATION. Hand-curated (see session precedent): the raw
-- `prisma migrate diff` output for this schema change also contained the
-- same recurring, unrelated, pre-existing drift stripped from every prior
-- hand-curated migration in this repo (WebhookEndpoint FK, Analysis.
-- updatedAt DROP DEFAULT, Client timestamp type, various RenameForeignKey/
-- RenameIndex identifier-length-truncation noise). Only the statements
-- actually intended by this stage's own schema edit are included below.
-- ADDITIVE / NON-DESTRUCTIVE -- one new table plus its own indexes, FK
-- and CHECK constraint, and three new nullable/defaulted columns on
-- VideoAsset; no existing table, column, or historical row is altered or
-- removed.

-- AlterTable
ALTER TABLE "VideoAsset" ADD COLUMN     "deletedAt" TIMESTAMP(6),
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'generated_output',
ADD COLUMN     "retentionDeletesAt" TIMESTAMP(6);

-- CreateTable
CREATE TABLE "ProfessionalLearningEvidence" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "visibilityScope" TEXT NOT NULL DEFAULT 'PRIVATE_LEARNING_EVIDENCE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "title" VARCHAR(200),
    "originalText" VARCHAR(4000),
    "contentSha256" CHAR(64),
    "imageAssetId" TEXT,
    "captureSetId" TEXT,
    "videoAssetId" TEXT,
    "provenance" JSONB NOT NULL,
    "sourceMetadata" JSONB,
    "rightsClassification" TEXT NOT NULL,
    "parentEvidenceId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(6),
    "sourceMediaDeletedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "ProfessionalLearningEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalLearningEvidence_ownerUserId_status_createdAt_i_idx" ON "ProfessionalLearningEvidence"("ownerUserId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ProfessionalLearningEvidence_ownerUserId_evidenceType_idx" ON "ProfessionalLearningEvidence"("ownerUserId", "evidenceType");

-- CreateIndex
CREATE INDEX "ProfessionalLearningEvidence_imageAssetId_idx" ON "ProfessionalLearningEvidence"("imageAssetId");

-- CreateIndex
CREATE INDEX "ProfessionalLearningEvidence_captureSetId_idx" ON "ProfessionalLearningEvidence"("captureSetId");

-- CreateIndex
CREATE INDEX "ProfessionalLearningEvidence_videoAssetId_idx" ON "ProfessionalLearningEvidence"("videoAssetId");

-- CreateIndex
CREATE INDEX "VideoAsset_deletedAt_idx" ON "VideoAsset"("deletedAt");

-- CreateIndex
CREATE INDEX "VideoAsset_origin_retentionDeletesAt_id_idx" ON "VideoAsset"("origin", "retentionDeletesAt", "id");

-- AddForeignKey
ALTER TABLE "ProfessionalLearningEvidence" ADD CONSTRAINT "ProfessionalLearningEvidence_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint: exactly one of imageAssetId/captureSetId/videoAssetId
-- is populated, matching evidenceType, or none at all for text-only/
-- future-capable-only evidence -- the DB-level backstop behind
-- isValidProfessionalLearningEvidenceInput
-- (professional-learning-evidence-validators.ts). Mirrors
-- HairStateSnapshotEvidence_kind_pointer_check's own exact shape and
-- reasoning. Not expressible in schema.prisma directly; added here as raw
-- SQL, applied via the same `prisma db execute` step as the rest of this
-- migration.
ALTER TABLE "ProfessionalLearningEvidence" ADD CONSTRAINT "ProfessionalLearningEvidence_evidence_pointer_check" CHECK (
    ("evidenceType" IN ('TEXT', 'VOICE_TRANSCRIPT', 'EXTERNAL_RESEARCH', 'MANUFACTURER_SOURCE', 'TREND_SOURCE')
        AND "imageAssetId" IS NULL AND "captureSetId" IS NULL AND "videoAssetId" IS NULL) OR
    ("evidenceType" IN ('IMAGE', 'DIAGRAM')
        AND "imageAssetId" IS NOT NULL AND "captureSetId" IS NULL AND "videoAssetId" IS NULL) OR
    ("evidenceType" = 'IMAGE_SET'
        AND "captureSetId" IS NOT NULL AND "imageAssetId" IS NULL AND "videoAssetId" IS NULL) OR
    ("evidenceType" = 'VIDEO'
        AND "videoAssetId" IS NOT NULL AND "imageAssetId" IS NULL AND "captureSetId" IS NULL)
);
