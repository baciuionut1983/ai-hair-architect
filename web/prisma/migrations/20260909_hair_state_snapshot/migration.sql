-- Professional Skill Engine, Stage 2 -- HAIR STATE SNAPSHOT. Hand-curated
-- (see session precedent): the raw `prisma migrate diff` output for this
-- schema change also contained unrelated, pre-existing drift on
-- WebhookEndpoint/Analysis/Client/Notification/TechnicalVisualMapSpatialBinding/
-- WebhookDelivery/AnalysisCorrection/OpsBackupRestore*/PhotoPreviewGeneration/
-- TechnicalVisualMap*/VideoDemonstrationGeneration/WebhookEndpointSecretVersion
-- (identifier-length-truncation renames and an unrelated FK/column-type
-- drift), the same category of drift stripped from every prior hand-curated
-- migration in this repo. Only the statements actually intended by this
-- stage's own schema edit are included below.

-- CreateTable
CREATE TABLE "HairStateSnapshot" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "analysisId" TEXT,
    "analysisProposalId" TEXT,
    "technicalVisualMapId" TEXT,
    "sourceImageAssetId" TEXT,
    "generatorVersion" TEXT,
    "professionalAdjustments" JSONB,
    "supersededBySnapshotId" TEXT,
    "confirmedAt" TIMESTAMP(6),
    "supersededAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "HairStateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HairStateSnapshot_clientId_ownerUserId_createdAt_id_idx" ON "HairStateSnapshot"("clientId", "ownerUserId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "HairStateSnapshot_ownerUserId_clientId_role_status_idx" ON "HairStateSnapshot"("ownerUserId", "clientId", "role", "status");

-- CreateIndex
CREATE INDEX "HairStateSnapshot_analysisProposalId_idx" ON "HairStateSnapshot"("analysisProposalId");

-- CreateIndex
CREATE INDEX "HairStateSnapshot_technicalVisualMapId_idx" ON "HairStateSnapshot"("technicalVisualMapId");

-- CreateIndex
CREATE UNIQUE INDEX "HairStateSnapshot_ownerUserId_clientId_role_snapshotVersion_key" ON "HairStateSnapshot"("ownerUserId", "clientId", "role", "snapshotVersion");

-- AddForeignKey
ALTER TABLE "HairStateSnapshot" ADD CONSTRAINT "HairStateSnapshot_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairStateSnapshot" ADD CONSTRAINT "HairStateSnapshot_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;
