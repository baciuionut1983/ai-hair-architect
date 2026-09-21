-- T1.6.2.b.1: additive, owner-scoped append-only decision history.
CREATE TABLE "ProfessionalFieldClaimDecision" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "professionalValue" TEXT,
    "candidateResolution" TEXT NOT NULL,
    "observationDigest" TEXT NOT NULL,
    "observationDigestVersion" TEXT NOT NULL,
    "specificationVersion" TEXT NOT NULL,
    "specificationDigest" TEXT NOT NULL,
    "note" TEXT,
    "reviewedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfessionalFieldClaimDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfessionalLearningDraft_id_ownerUserId_key" ON "ProfessionalLearningDraft"("id", "ownerUserId");
CREATE UNIQUE INDEX "ProfessionalFieldClaimDecision_draftId_field_revision_key" ON "ProfessionalFieldClaimDecision"("draftId", "field", "revision");
CREATE INDEX "ProfessionalFieldClaimDecision_ownerUserId_draftId_field_re_idx" ON "ProfessionalFieldClaimDecision"("ownerUserId", "draftId", "field", "revision");
ALTER TABLE "ProfessionalFieldClaimDecision" ADD CONSTRAINT "ProfessionalFieldClaimDecision_draftId_ownerUserId_fkey" FOREIGN KEY ("draftId", "ownerUserId") REFERENCES "ProfessionalLearningDraft"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE RESTRICT;
