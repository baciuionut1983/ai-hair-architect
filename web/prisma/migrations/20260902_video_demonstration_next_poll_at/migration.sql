-- Video Demonstration, Stage 3: bounded polling cadence. The recovery
-- worker's sweep uses this to decide which PROCESSING rows are due for
-- another poll attempt, instead of polling every eligible row on every
-- sweep tick.
ALTER TABLE "VideoDemonstrationGeneration"
  ADD COLUMN "nextPollAt" TIMESTAMP(6);
