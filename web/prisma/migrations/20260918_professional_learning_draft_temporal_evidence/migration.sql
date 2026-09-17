-- AI Hair Architect, Professional Skill Engine Stage 8.5T1.2 --
-- TEMPORAL OBSERVATION PRESERVATION. Hand-curated (see this repo's own
-- precedent, e.g. 20260917_professional_learning_review): the local
-- database user lacks CREATEDB, so `prisma migrate dev`'s shadow
-- database cannot be created here -- only the single statement this
-- schema edit actually intends is included below.
-- ADDITIVE / NON-DESTRUCTIVE ONLY -- one new nullable column on an
-- existing table; no existing column, row, or table is altered, dropped,
-- or rewritten. Every existing ProfessionalLearningDraft row is
-- unaffected and remains fully valid with this column NULL. No backfill.

-- AlterTable
ALTER TABLE "ProfessionalLearningDraft" ADD COLUMN "temporalEvidence" JSONB;
