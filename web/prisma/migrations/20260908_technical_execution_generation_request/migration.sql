-- Technical Execution Generation Authorization + Image Qualification
-- Persistence Gate, Stage 2.5.i.22 -- minimal foundation only.
--
-- Hand-curated from a live-DB diff: the raw `prisma migrate diff` output
-- against this local dev database also contained unrelated PRE-EXISTING
-- drift (a WebhookEndpoint FK drop/recreate, an Analysis.updatedAt
-- default drop, Client column type changes, and several constraint/index
-- RENAMEs on tables this task never touches -- Notification,
-- TechnicalVisualMapSpatialBinding, WebhookDelivery, PhotoPreviewGeneration,
-- VideoDemonstrationGeneration, TechnicalVisualMap, WebhookEndpointSecretVersion,
-- OpsBackupRestore*, OpsImageAssetRetentionRun, AnalysisCorrection) --
-- the exact same PRE-EXISTING identifier-length-truncation phenomenon
-- already documented in
-- prisma/migrations/20260903_technical_demonstration_plan_stage1/migration.sql
-- and prisma/migrations/20260908_capture_set/migration.sql. Not
-- something this migration introduces or is authorized to touch. Every
-- line below is exactly, and only, what this stage's own schema.prisma
-- changes require: one new, additive table, one new unique index on the
-- existing CaptureSetImage table, backward-compatible, and reversible.

-- CreateTable
CREATE TABLE "TechnicalExecutionGenerationRequest" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "captureSetId" TEXT NOT NULL,
    "captureSetImageId" TEXT NOT NULL,
    "imageAssetId" TEXT NOT NULL,
    "consentGrantedAt" TIMESTAMP(6),
    "consentVersion" TEXT,
    "qualificationStatus" TEXT NOT NULL,
    "qualificationEvidenceSource" TEXT,
    "qualificationReason" VARCHAR(2000),
    "qualifiedAt" TIMESTAMP(6),
    "sealedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "TechnicalExecutionGenerationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicalExecutionGenerationRequest_ownerUserId_clientId_cr_idx" ON "TechnicalExecutionGenerationRequest"("ownerUserId", "clientId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "TechnicalExecutionGenerationRequest_captureSetId_ownerUserI_idx" ON "TechnicalExecutionGenerationRequest"("captureSetId", "ownerUserId", "clientId");

-- CreateIndex
CREATE INDEX "TechnicalExecutionGenerationRequest_captureSetImageId_owner_idx" ON "TechnicalExecutionGenerationRequest"("captureSetImageId", "ownerUserId", "clientId");

-- CreateIndex (new, additive uniqueness on the existing CaptureSetImage
-- table -- a Stage 2.5.i.22 prerequisite, mirroring how CaptureSet's own
-- @@unique([id, ownerUserId, clientId]) was itself added by Stage
-- 2.5.i.21b as a composite-FK-enabling prerequisite. Structurally safe:
-- CaptureSetImage.id is already the model's own primary key, globally
-- unique on its own -- this only ever adds a redundant-but-harmless
-- second uniqueness guarantee over columns that already co-occur
-- uniquely per row.)
CREATE UNIQUE INDEX "CaptureSetImage_id_ownerUserId_clientId_key" ON "CaptureSetImage"("id", "ownerUserId", "clientId");

-- AddForeignKey
ALTER TABLE "TechnicalExecutionGenerationRequest" ADD CONSTRAINT "TechnicalExecutionGenerationRequest_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalExecutionGenerationRequest" ADD CONSTRAINT "TechnicalExecutionGenerationRequest_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalExecutionGenerationRequest" ADD CONSTRAINT "TechnicalExecutionGenerationRequest_captureSetId_ownerUser_fkey" FOREIGN KEY ("captureSetId", "ownerUserId", "clientId") REFERENCES "CaptureSet"("id", "ownerUserId", "clientId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalExecutionGenerationRequest" ADD CONSTRAINT "TechnicalExecutionGenerationRequest_captureSetImageId_owne_fkey" FOREIGN KEY ("captureSetImageId", "ownerUserId", "clientId") REFERENCES "CaptureSetImage"("id", "ownerUserId", "clientId") ON DELETE RESTRICT ON UPDATE CASCADE;
