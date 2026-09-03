-- Technical Demonstration, Stage 1 (cutting plan foundation only).
--
-- Hand-curated from a live-DB diff: the raw `prisma migrate diff` output
-- against this local dev database also contained unrelated PRE-EXISTING
-- drift (a WebhookEndpoint FK drop/recreate, an Analysis.updatedAt
-- default drop, Client column type changes, and several constraint/index
-- RENAMEs on tables this task never touches -- TechnicalVisualMapSpatialBinding,
-- Notification, WebhookDelivery, PhotoPreviewGeneration,
-- VideoDemonstrationGeneration, TechnicalVisualMap, WebhookEndpointSecretVersion,
-- OpsBackupRestore*). That drift is almost certainly Postgres's own silent
-- identifier-length truncation of Prisma's auto-generated constraint/index
-- names on original creation, now showing up as a spurious rename when
-- diffed against the untruncated schema-declared names -- a PRE-EXISTING
-- condition, not something this migration introduces or is authorized to
-- touch. Every line below is exactly, and only, what this stage's own
-- schema.prisma changes require: additive, backward-compatible, and
-- reversible by a plain DROP.

-- AlterTable: AnalysisProposal.sourceKind -- additive, NOT NULL with a
-- default, so every existing row (all of them produced by the
-- deterministic cutting engine from client AI analysis, before this
-- column existed) is safely and correctly backfilled to 'AI_ANALYSIS' in
-- the same statement that adds the column. No separate backfill step
-- needed, no existing row can ever end up NULL here.
ALTER TABLE "AnalysisProposal" ADD COLUMN     "sourceKind" TEXT NOT NULL DEFAULT 'AI_ANALYSIS';

-- CreateTable
CREATE TABLE "TechnicalDemonstrationPlan" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "analysisProposalId" TEXT NOT NULL,
    "analysisProposalConfirmedAt" TIMESTAMP(6) NOT NULL,
    "vertical" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "planVersion" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "generatorVersion" TEXT NOT NULL,
    "requestFingerprint" VARCHAR(64) NOT NULL,
    "supersededByPlanId" TEXT,
    "confirmedAt" TIMESTAMP(6),
    "supersededAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "TechnicalDemonstrationPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalDemonstrationStep" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "stepSchemaVersion" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "explanation" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "TechnicalDemonstrationStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicalDemonstrationPlan_clientId_ownerUserId_createdAt_i_idx" ON "TechnicalDemonstrationPlan"("clientId", "ownerUserId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "TechnicalDemonstrationPlan_analysisProposalId_ownerUserId_c_idx" ON "TechnicalDemonstrationPlan"("analysisProposalId", "ownerUserId", "clientId");

-- CreateIndex
CREATE INDEX "TechnicalDemonstrationPlan_ownerUserId_clientId_vertical_st_idx" ON "TechnicalDemonstrationPlan"("ownerUserId", "clientId", "vertical", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalDemonstrationPlan_requestFingerprint_key" ON "TechnicalDemonstrationPlan"("requestFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalDemonstrationPlan_analysisProposalId_ownerUserId_c_key" ON "TechnicalDemonstrationPlan"("analysisProposalId", "ownerUserId", "clientId", "vertical", "planVersion");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalDemonstrationPlan_id_ownerUserId_clientId_key" ON "TechnicalDemonstrationPlan"("id", "ownerUserId", "clientId");

-- CreateIndex
CREATE INDEX "TechnicalDemonstrationStep_clientId_ownerUserId_planId_idx" ON "TechnicalDemonstrationStep"("clientId", "ownerUserId", "planId");

-- CreateIndex
CREATE INDEX "TechnicalDemonstrationStep_planId_ownerUserId_clientId_step_idx" ON "TechnicalDemonstrationStep"("planId", "ownerUserId", "clientId", "stepNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalDemonstrationStep_planId_ownerUserId_clientId_step_key" ON "TechnicalDemonstrationStep"("planId", "ownerUserId", "clientId", "stepNumber");

-- AddForeignKey
ALTER TABLE "TechnicalDemonstrationPlan" ADD CONSTRAINT "TechnicalDemonstrationPlan_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalDemonstrationPlan" ADD CONSTRAINT "TechnicalDemonstrationPlan_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalDemonstrationPlan" ADD CONSTRAINT "TechnicalDemonstrationPlan_analysisProposalId_ownerUserId__fkey" FOREIGN KEY ("analysisProposalId", "ownerUserId", "clientId") REFERENCES "AnalysisProposal"("id", "ownerUserId", "clientId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalDemonstrationStep" ADD CONSTRAINT "TechnicalDemonstrationStep_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalDemonstrationStep" ADD CONSTRAINT "TechnicalDemonstrationStep_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalDemonstrationStep" ADD CONSTRAINT "TechnicalDemonstrationStep_planId_ownerUserId_clientId_fkey" FOREIGN KEY ("planId", "ownerUserId", "clientId") REFERENCES "TechnicalDemonstrationPlan"("id", "ownerUserId", "clientId") ON DELETE RESTRICT ON UPDATE CASCADE;
