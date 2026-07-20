-- M10C: dedicated terminal failure timestamp for reliable failedLast24h metric
ALTER TABLE "WebhookDelivery"
ADD COLUMN "failedTerminalAt" TIMESTAMP(6);

CREATE INDEX "WebhookDelivery_ownerUserId_failedTerminalAt_idx"
  ON "WebhookDelivery"("ownerUserId", "failedTerminalAt");
