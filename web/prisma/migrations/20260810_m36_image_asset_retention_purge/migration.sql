CREATE TABLE "OpsImageAssetRetentionRun" (
  "id" TEXT NOT NULL,
  "ownerUserId" UUID NOT NULL,
  "mode" VARCHAR(16) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "reasonAuditSafe" VARCHAR(200),
  "executionIdempotencyKey" VARCHAR(190),
  "idempotencyFingerprint" VARCHAR(64),
  "advisoryLockKey" VARCHAR(32) NOT NULL,
  "startedAt" TIMESTAMP(6) NOT NULL,
  "finishedAt" TIMESTAMP(6),
  "eligibleCount" INTEGER NOT NULL,
  "purgedCount" INTEGER NOT NULL,
  "failedCount" INTEGER NOT NULL,
  "errorCode" VARCHAR(80),
  "errorMessageSafe" VARCHAR(500),
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OpsImageAssetRetentionRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpsImageAssetRetentionRun_ownerUserId_executionIdempotencyKey_key"
  ON "OpsImageAssetRetentionRun"("ownerUserId", "executionIdempotencyKey");

CREATE INDEX "OpsImageAssetRetentionRun_ownerUserId_createdAt_idx"
  ON "OpsImageAssetRetentionRun"("ownerUserId", "createdAt");

CREATE INDEX "OpsImageAssetRetentionRun_ownerUserId_startedAt_idx"
  ON "OpsImageAssetRetentionRun"("ownerUserId", "startedAt");
