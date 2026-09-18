-- Stage 8.5T1.4.b.1 -- ADDITIVE ONLY. Adds one nullable JSONB column to
-- store professional review decisions about the T1.4.a procedural
-- interpretation (never the interpretation itself, which is derived
-- fresh on every read and never persisted). Every existing row gets
-- NULL; no backfill.
ALTER TABLE "ProfessionalLearningDraft" ADD COLUMN "proceduralReview" JSONB;
