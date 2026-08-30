-- Real AI Photo Preview, Stage 2 -- schema/migration only. Hand-authored,
-- same reasoning as every prior migration in this domain: a real
-- `prisma migrate diff` against this environment's live datasource reports
-- substantial PRE-EXISTING, unrelated schema drift not authorized by this
-- stage -- none of it is included below.
--
-- Two additive, safe changes:
--
-- 1. PhotoPreviewGeneration.attemptCount -- how many times a real provider
--    attempt has been claimed for one generation row. Defaults to 0;
--    existing rows (all from Stage 1, none of which were ever executed)
--    stay correctly at 0.
ALTER TABLE "PhotoPreviewGeneration" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

-- 2. ImageAsset.origin -- distinguishes a client-uploaded source photo
--    ("upload") from a Photo Preview provider's own generated output
--    ("ai_generated"). Defaults to "upload" -- every existing row really
--    is a client upload, so this default is exactly correct with no
--    separate backfill needed.
ALTER TABLE "ImageAsset" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'upload';
