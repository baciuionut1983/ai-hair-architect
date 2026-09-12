-- Professional Skill Engine, Stage 8.5L3.1 -- LARGE MEDIA INGESTION
-- HARDENING. Hand-curated (see session precedent): the raw
-- `prisma migrate diff` output for this schema change also contained the
-- same recurring, unrelated, pre-existing drift stripped from every prior
-- hand-curated migration in this repo (WebhookEndpoint FK, Analysis.
-- updatedAt DROP DEFAULT, Client timestamp type, various RenameForeignKey/
-- RenameIndex identifier-length-truncation noise). Only the statements
-- actually intended by this stage's own schema edit are included below.
-- ADDITIVE / NON-DESTRUCTIVE -- one new table plus its own indexes and
-- FK, and two new nullable/defaulted columns; no existing table, column,
-- or historical row is altered or removed. Every existing CaptureSet row
-- defaults to purpose='CLIENT_MULTIVIEW', which is exactly what every
-- such row already structurally is -- no backfill needed.

-- AlterTable
ALTER TABLE "CaptureSet" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'CLIENT_MULTIVIEW';

-- AlterTable
ALTER TABLE "CaptureSetImage" ADD COLUMN     "ordinalPosition" INTEGER;

-- CreateTable
CREATE TABLE "ProfessionalLearningUploadSession" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'PROFESSIONAL_LEARNING',
    "mediaKind" TEXT NOT NULL DEFAULT 'VIDEO',
    "fileName" VARCHAR(255) NOT NULL,
    "contentType" VARCHAR(128) NOT NULL,
    "expectedSizeBytes" INTEGER NOT NULL,
    "expectedChecksumSha256" CHAR(64),
    "storageBucketAlias" VARCHAR(64) NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "providerUploadId" VARCHAR(512),
    "partSizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "videoAssetId" TEXT,
    "evidenceId" TEXT,
    "errorCode" VARCHAR(80),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,
    "expiresAt" TIMESTAMP(6) NOT NULL,
    "completedAt" TIMESTAMP(6),
    "abortedAt" TIMESTAMP(6),
    "failedAt" TIMESTAMP(6),

    CONSTRAINT "ProfessionalLearningUploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalLearningUploadSession_ownerUserId_status_create_idx" ON "ProfessionalLearningUploadSession"("ownerUserId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ProfessionalLearningUploadSession_status_expiresAt_idx" ON "ProfessionalLearningUploadSession"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalLearningUploadSession_storageBucketAlias_storag_key" ON "ProfessionalLearningUploadSession"("storageBucketAlias", "storageKey");

-- AddForeignKey
ALTER TABLE "ProfessionalLearningUploadSession" ADD CONSTRAINT "ProfessionalLearningUploadSession_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalLearningUploadSession" ADD CONSTRAINT "ProfessionalLearningUploadSession_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;
