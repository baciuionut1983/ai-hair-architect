-- Professional Skill Engine, Stage 7 -- TECHNICAL DEMONSTRATION SCENE
-- PLAN. Hand-curated (see the Stage 5/6 migration precedent): the raw
-- `prisma migrate diff` output for this schema change also contained the
-- same recurring, unrelated, pre-existing drift stripped from every prior
-- hand-curated migration in this repo (WebhookEndpoint FK,
-- Analysis.updatedAt DROP DEFAULT, Client timestamp type, various
-- RenameForeignKey/RenameIndex identifier-length-truncation noise). Only
-- the statements actually intended by this stage's own schema edit are
-- included below. ADDITIVE / NON-DESTRUCTIVE -- one new table plus its
-- own indexes and FKs; no existing table, column, or historical row is
-- altered.

-- CreateTable
CREATE TABLE "ProfessionalExecutionScenePlan" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sourceExecutionPlanId" TEXT NOT NULL,
    "sourceExecutionPlanFingerprint" VARCHAR(64) NOT NULL,
    "scenePlanFingerprint" VARCHAR(64) NOT NULL,
    "compilerVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "scenePlanPayload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "readiness" TEXT NOT NULL,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(6),
    "supersededByScenePlanId" TEXT,
    "supersededAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "ProfessionalExecutionScenePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalExecutionScenePlan_ownerUserId_clientId_sourceE_idx" ON "ProfessionalExecutionScenePlan"("ownerUserId", "clientId", "sourceExecutionPlanId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ProfessionalExecutionScenePlan_ownerUserId_clientId_status_idx" ON "ProfessionalExecutionScenePlan"("ownerUserId", "clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalExecutionScenePlan_scenePlanFingerprint_key" ON "ProfessionalExecutionScenePlan"("scenePlanFingerprint");

-- AddForeignKey
ALTER TABLE "ProfessionalExecutionScenePlan" ADD CONSTRAINT "ProfessionalExecutionScenePlan_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalExecutionScenePlan" ADD CONSTRAINT "ProfessionalExecutionScenePlan_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalExecutionScenePlan" ADD CONSTRAINT "ProfessionalExecutionScenePlan_sourceExecutionPlanId_fkey" FOREIGN KEY ("sourceExecutionPlanId") REFERENCES "ProfessionalExecutionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
