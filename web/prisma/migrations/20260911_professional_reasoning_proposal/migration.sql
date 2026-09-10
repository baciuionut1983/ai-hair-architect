-- Professional Skill Engine, Stage 5 -- PROFESSIONAL REASONING PROPOSAL.
-- Hand-curated (see session precedent): the raw `prisma migrate diff`
-- output for this schema change also contained the same recurring,
-- unrelated, pre-existing drift stripped from every prior hand-curated
-- migration in this repo (WebhookEndpoint FK, Analysis.updatedAt DROP
-- DEFAULT, Client timestamp type, various RenameForeignKey/RenameIndex
-- identifier-length-truncation noise). Only the statements actually
-- intended by this stage's own schema edit are included below.

-- CreateTable
CREATE TABLE "ProfessionalReasoningProposal" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "currentSnapshotId" TEXT NOT NULL,
    "currentSnapshotVersion" INTEGER NOT NULL,
    "targetSnapshotId" TEXT NOT NULL,
    "targetSnapshotVersion" INTEGER NOT NULL,
    "contextPayload" JSONB NOT NULL,
    "contextFingerprint" VARCHAR(64) NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "proposalPayload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(6),
    "rejectedAt" TIMESTAMP(6),
    "supersededByProposalId" TEXT,
    "supersededAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "ProfessionalReasoningProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalReasoningProposal_ownerUserId_clientId_createdA_idx" ON "ProfessionalReasoningProposal"("ownerUserId", "clientId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ProfessionalReasoningProposal_ownerUserId_clientId_status_idx" ON "ProfessionalReasoningProposal"("ownerUserId", "clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalReasoningProposal_contextFingerprint_provider_m_key" ON "ProfessionalReasoningProposal"("contextFingerprint", "provider", "model");

-- AddForeignKey
ALTER TABLE "ProfessionalReasoningProposal" ADD CONSTRAINT "ProfessionalReasoningProposal_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalReasoningProposal" ADD CONSTRAINT "ProfessionalReasoningProposal_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;
