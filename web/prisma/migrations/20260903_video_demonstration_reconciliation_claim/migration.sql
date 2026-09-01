-- Video Demonstration, reconciliation: a separate atomic claim, distinct
-- from completionClaimedAt (which only ever applies while status is
-- PROCESSING). Guards a rarer window -- a row already terminally FAILED
-- locally whose real providerOperationId can later be proven, via a
-- read-only poll, to have actually succeeded at the provider -- against
-- two concurrent reconciliation attempts both downloading the video and
-- creating two VideoAsset rows.
ALTER TABLE "VideoDemonstrationGeneration"
  ADD COLUMN "reconciliationClaimedAt" TIMESTAMP(6);
