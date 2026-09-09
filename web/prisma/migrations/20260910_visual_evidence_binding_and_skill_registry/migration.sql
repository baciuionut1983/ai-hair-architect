-- Professional Skill Engine, Stage 3 -- VISUAL EVIDENCE BINDING +
-- PROFESSIONAL SKILL REGISTRY FOUNDATION. Hand-curated (see session
-- precedent): the raw `prisma migrate diff` output for this schema
-- change also contained the same recurring, unrelated, pre-existing
-- drift stripped from every prior hand-curated migration in this repo
-- (WebhookEndpoint FK, Analysis.updatedAt DROP DEFAULT, Client timestamp
-- type, various RenameForeignKey/RenameIndex identifier-length-
-- truncation noise on Notification/TechnicalVisualMapSpatialBinding/
-- WebhookDelivery/AnalysisCorrection/OpsBackupRestore*/
-- PhotoPreviewGeneration/TechnicalVisualMap*/VideoDemonstrationGeneration/
-- WebhookEndpointSecretVersion). Only the statements actually intended by
-- this stage's own schema edit are included below.

-- CreateTable
CREATE TABLE "HairStateSnapshotEvidence" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "hairStateSnapshotId" TEXT NOT NULL,
    "evidenceKind" TEXT NOT NULL,
    "evidenceRole" TEXT NOT NULL,
    "imageAssetId" TEXT,
    "captureSetId" TEXT,
    "viewLabel" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "HairStateSnapshotEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalSkillDefinition" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "vertical" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "authorityType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(6),
    "supersededBySkillDefinitionId" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "ProfessionalSkillDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HairStateSnapshotEvidence_ownerUserId_clientId_idx" ON "HairStateSnapshotEvidence"("ownerUserId", "clientId");

-- CreateIndex
CREATE INDEX "HairStateSnapshotEvidence_hairStateSnapshotId_idx" ON "HairStateSnapshotEvidence"("hairStateSnapshotId");

-- CreateIndex
CREATE INDEX "HairStateSnapshotEvidence_imageAssetId_idx" ON "HairStateSnapshotEvidence"("imageAssetId");

-- CreateIndex
CREATE INDEX "HairStateSnapshotEvidence_captureSetId_idx" ON "HairStateSnapshotEvidence"("captureSetId");

-- CreateIndex
CREATE INDEX "ProfessionalSkillDefinition_vertical_status_idx" ON "ProfessionalSkillDefinition"("vertical", "status");

-- CreateIndex
CREATE INDEX "ProfessionalSkillDefinition_skillId_status_idx" ON "ProfessionalSkillDefinition"("skillId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalSkillDefinition_skillId_version_key" ON "ProfessionalSkillDefinition"("skillId", "version");

-- AddForeignKey
ALTER TABLE "HairStateSnapshotEvidence" ADD CONSTRAINT "HairStateSnapshotEvidence_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairStateSnapshotEvidence" ADD CONSTRAINT "HairStateSnapshotEvidence_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HairStateSnapshotEvidence" ADD CONSTRAINT "HairStateSnapshotEvidence_hairStateSnapshotId_fkey" FOREIGN KEY ("hairStateSnapshotId") REFERENCES "HairStateSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint: exactly one of imageAssetId/captureSetId is
-- populated, matching evidenceKind -- the DB-level backstop behind
-- isValidHairStateSnapshotEvidenceInput (hair-state-snapshot-evidence-
-- validators.ts). Not expressible in schema.prisma directly; added here
-- as raw SQL, applied via the same `prisma db execute` step as the rest
-- of this migration.
ALTER TABLE "HairStateSnapshotEvidence" ADD CONSTRAINT "HairStateSnapshotEvidence_kind_pointer_check" CHECK (
    ("evidenceKind" = 'IMAGE_ASSET' AND "imageAssetId" IS NOT NULL AND "captureSetId" IS NULL) OR
    ("evidenceKind" = 'CAPTURE_SET' AND "captureSetId" IS NOT NULL AND "imageAssetId" IS NULL)
);
