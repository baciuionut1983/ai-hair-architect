-- Professional Skill Engine, Stage 6 -- PROFESSIONAL EXECUTION PLAN.
-- Hand-curated (see session precedent, e.g. the Stage 5
-- 20260911_professional_reasoning_proposal migration): the raw
-- `prisma migrate diff` output for this schema change also contained the
-- same recurring, unrelated, pre-existing drift stripped from every prior
-- hand-curated migration in this repo (WebhookEndpoint FK,
-- Analysis.updatedAt DROP DEFAULT, Client timestamp type, various
-- RenameForeignKey/RenameIndex identifier-length-truncation noise). Only
-- the statements actually intended by this stage's own schema edit are
-- included below.

-- CreateTable
CREATE TABLE "ProfessionalExecutionPlan" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "currentSnapshotId" TEXT NOT NULL,
    "currentSnapshotVersion" INTEGER NOT NULL,
    "targetSnapshotId" TEXT NOT NULL,
    "targetSnapshotVersion" INTEGER NOT NULL,
    "sourceReasoningProposalId" TEXT NOT NULL,
    "reasoningProposalContextFingerprint" VARCHAR(64) NOT NULL,
    "planPayload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "readiness" TEXT NOT NULL,
    "professionalOverrides" JSONB,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(6),
    "supersededByPlanId" TEXT,
    "supersededAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "ProfessionalExecutionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalExecutionPlan_ownerUserId_clientId_sourceReason_idx" ON "ProfessionalExecutionPlan"("ownerUserId", "clientId", "sourceReasoningProposalId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ProfessionalExecutionPlan_ownerUserId_clientId_status_idx" ON "ProfessionalExecutionPlan"("ownerUserId", "clientId", "status");

-- AddForeignKey
ALTER TABLE "ProfessionalExecutionPlan" ADD CONSTRAINT "ProfessionalExecutionPlan_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalExecutionPlan" ADD CONSTRAINT "ProfessionalExecutionPlan_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalExecutionPlan" ADD CONSTRAINT "ProfessionalExecutionPlan_sourceReasoningProposalId_fkey" FOREIGN KEY ("sourceReasoningProposalId") REFERENCES "ProfessionalReasoningProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
