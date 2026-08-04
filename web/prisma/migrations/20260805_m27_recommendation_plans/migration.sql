-- M27: Hair Recommendation Engine (Color + Treatment).
--
-- Strictly additive. All six columns are nullable, with no DEFAULT, so every
-- existing Analysis row is completely unaffected -- no backfill, no implied
-- history that never happened.
--
-- The full six-column set (Color + Treatment) is introduced in this single
-- migration even though the Treatment engine and the request-flow wiring for
-- both engines are deferred to GO-3, per explicit approval: the schema for
-- M27 is introduced once, not incrementally across GO-2/GO-3.
--
--   colorPlan            -- ColorPlan (contracts.ts), JSON, set by GO-2's
--                            repository once color-plan-engine.ts is invoked
--                            (not yet wired to any route in GO-2).
--   desiredColorResult    -- DesiredColorResult (contracts.ts). Dormant in
--                            GO-2: no application code reads/writes this
--                            column until GO-3 wires the color engine into
--                            analyzeInitial and the analysis/start route.
--   grayPercentage        -- GrayPercentage (contracts.ts). Dormant in GO-2,
--                            same as above.
--   treatmentPlan         -- TreatmentPlan (contracts.ts, to be added in
--                            GO-3). Dormant until the Treatment engine exists.
--   scalpCondition        -- Treatment-domain input (contracts.ts, GO-3).
--                            Dormant until GO-3.
--   treatmentGoalDetail   -- Treatment-domain input (contracts.ts, GO-3).
--                            Dormant until GO-3.

ALTER TABLE "Analysis" ADD COLUMN "colorPlan" JSONB;
ALTER TABLE "Analysis" ADD COLUMN "desiredColorResult" TEXT;
ALTER TABLE "Analysis" ADD COLUMN "grayPercentage" TEXT;
ALTER TABLE "Analysis" ADD COLUMN "treatmentPlan" JSONB;
ALTER TABLE "Analysis" ADD COLUMN "scalpCondition" TEXT;
ALTER TABLE "Analysis" ADD COLUMN "treatmentGoalDetail" TEXT;
