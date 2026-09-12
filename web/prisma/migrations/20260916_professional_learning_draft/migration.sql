-- Professional Skill Engine, Stage 8.5L4 -- PROFESSIONAL LEARNING
-- DISCERNMENT + STRUCTURED KNOWLEDGE EXTRACTION DRAFT. Hand-curated (see
-- session precedent): only the statements actually intended by this
-- stage's own schema edit are included below.
-- ADDITIVE / NON-DESTRUCTIVE -- one new table plus its own indexes and
-- FK; no existing table, column, or historical row is altered or
-- removed. Local/test database only -- NOT applied to production this
-- stage.

-- CreateTable
CREATE TABLE "ProfessionalLearningDraft" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "sourceEvidenceId" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "discernmentCategory" TEXT NOT NULL,
    "comparisonOutcome" TEXT NOT NULL,
    "comparedSkillId" TEXT,
    "extraction" JSONB NOT NULL,
    "conflictDetail" JSONB,
    "correctsDraftId" TEXT,
    "supersededByDraftId" TEXT,
    "correctionNote" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "ProfessionalLearningDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalLearningDraft_sourceEvidenceId_extractorVersi_key" ON "ProfessionalLearningDraft"("sourceEvidenceId", "extractorVersion");

-- CreateIndex
CREATE INDEX "ProfessionalLearningDraft_ownerUserId_status_createdAt_id_idx" ON "ProfessionalLearningDraft"("ownerUserId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ProfessionalLearningDraft_sourceEvidenceId_idx" ON "ProfessionalLearningDraft"("sourceEvidenceId");

-- CreateIndex
CREATE INDEX "ProfessionalLearningDraft_correctsDraftId_idx" ON "ProfessionalLearningDraft"("correctsDraftId");

-- AddForeignKey
ALTER TABLE "ProfessionalLearningDraft" ADD CONSTRAINT "ProfessionalLearningDraft_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
