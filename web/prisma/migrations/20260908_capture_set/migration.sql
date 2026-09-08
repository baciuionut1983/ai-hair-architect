-- Multi-View Client Capture, Stage 2.5.i.21b -- minimal foundation only.
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
-- already documented in prisma/migrations/20260903_technical_demonstration_plan_stage1/migration.sql.
-- Not something this migration introduces or is authorized to touch.
-- Every line below is exactly, and only, what this stage's own
-- schema.prisma changes require: two new, additive tables, backward-
-- compatible, and reversible by a plain DROP.

-- CreateTable
CREATE TABLE "CaptureSet" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "captureSetVersion" INTEGER NOT NULL,
    "supersededByCaptureSetId" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "CaptureSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureSetImage" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "captureSetId" TEXT NOT NULL,
    "imageAssetId" TEXT NOT NULL,
    "viewLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "CaptureSetImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaptureSet_clientId_ownerUserId_createdAt_id_idx" ON "CaptureSet"("clientId", "ownerUserId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CaptureSet_ownerUserId_clientId_supersededByCaptureSetId_idx" ON "CaptureSet"("ownerUserId", "clientId", "supersededByCaptureSetId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureSet_clientId_ownerUserId_captureSetVersion_key" ON "CaptureSet"("clientId", "ownerUserId", "captureSetVersion");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureSet_id_ownerUserId_clientId_key" ON "CaptureSet"("id", "ownerUserId", "clientId");

-- CreateIndex
CREATE INDEX "CaptureSetImage_captureSetId_ownerUserId_clientId_idx" ON "CaptureSetImage"("captureSetId", "ownerUserId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureSetImage_captureSetId_viewLabel_key" ON "CaptureSetImage"("captureSetId", "viewLabel");

-- AddForeignKey
ALTER TABLE "CaptureSet" ADD CONSTRAINT "CaptureSet_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSet" ADD CONSTRAINT "CaptureSet_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSetImage" ADD CONSTRAINT "CaptureSetImage_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSetImage" ADD CONSTRAINT "CaptureSetImage_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSetImage" ADD CONSTRAINT "CaptureSetImage_captureSetId_ownerUserId_clientId_fkey" FOREIGN KEY ("captureSetId", "ownerUserId", "clientId") REFERENCES "CaptureSet"("id", "ownerUserId", "clientId") ON DELETE RESTRICT ON UPDATE CASCADE;
