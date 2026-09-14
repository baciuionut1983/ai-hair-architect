-- Professional Skill Engine, Stage 8.5L5.R2 -- PROFESSIONAL REVIEW OF
-- BLIND LONG-VIDEO EXTRACTION. Hand-curated (see session precedent): only
-- the statements actually intended by this stage's own schema edit are
-- included below.
-- ADDITIVE / NON-DESTRUCTIVE -- one new table plus its own indexes and
-- FK; no existing table, column, or historical row is altered or
-- removed. Local/test database only -- NOT applied to production this
-- stage.

-- CreateTable
CREATE TABLE "ProfessionalLearningReview" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "sourceEvidenceId" TEXT NOT NULL,
    "reviewedExtractionVersion" TEXT NOT NULL,
    "approvedResultHash" CHAR(64) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROFESSIONALLY_VALIDATED',
    "approvalDetail" JSONB NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(6) NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "ProfessionalLearningReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalLearningReview_sourceEvidenceId_reviewedExtra_key" ON "ProfessionalLearningReview"("sourceEvidenceId", "reviewedExtractionVersion");

-- CreateIndex
CREATE INDEX "ProfessionalLearningReview_ownerUserId_status_createdAt_i_idx" ON "ProfessionalLearningReview"("ownerUserId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ProfessionalLearningReview_sourceEvidenceId_idx" ON "ProfessionalLearningReview"("sourceEvidenceId");

-- AddForeignKey
ALTER TABLE "ProfessionalLearningReview" ADD CONSTRAINT "ProfessionalLearningReview_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
