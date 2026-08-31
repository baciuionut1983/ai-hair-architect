-- Video Demonstration, Stage 2 hardening: a separate atomic claim marker
-- guarding the "provider says done -> download/persist/mark COMPLETED"
-- window against two concurrent pollers racing the same generation.
ALTER TABLE "VideoDemonstrationGeneration"
  ADD COLUMN "completionClaimedAt" TIMESTAMP(6);
