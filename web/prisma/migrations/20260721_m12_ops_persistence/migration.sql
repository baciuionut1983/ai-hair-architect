-- M12 ops persistence: backup snapshots and retention run ledger

CREATE TABLE "OpsBackupSnapshot" (
  "id" TEXT NOT NULL,
  "ownerUserId" UUID NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "checksumAlgorithm" VARCHAR(32) NOT NULL,
  "schemaVersion" VARCHAR(16) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OpsBackupSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OpsBackupSnapshot_ownerUserId_createdAt_idx"
  ON "OpsBackupSnapshot"("ownerUserId", "createdAt");

CREATE TABLE "OpsRetentionRun" (
  "id" TEXT NOT NULL,
  "ownerUserId" UUID NOT NULL,
  "mode" VARCHAR(16) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "olderThanDays" INTEGER NOT NULL,
  "reasonAuditSafe" VARCHAR(200),
  "executionIdempotencyKey" VARCHAR(190),
  "idempotencyFingerprint" VARCHAR(64),
  "advisoryLockKey" VARCHAR(32) NOT NULL,
  "startedAt" TIMESTAMP(6) NOT NULL,
  "finishedAt" TIMESTAMP(6),
  "pushQueueAffected" INTEGER NOT NULL,
  "auditEventsAffected" INTEGER NOT NULL,
  "errorCode" VARCHAR(80),
  "errorMessageSafe" VARCHAR(500),
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OpsRetentionRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpsRetentionRun_ownerUserId_executionIdempotencyKey_key"
  ON "OpsRetentionRun"("ownerUserId", "executionIdempotencyKey");

CREATE INDEX "OpsRetentionRun_ownerUserId_createdAt_idx"
  ON "OpsRetentionRun"("ownerUserId", "createdAt");

CREATE INDEX "OpsRetentionRun_ownerUserId_startedAt_idx"
  ON "OpsRetentionRun"("ownerUserId", "startedAt");

CREATE TABLE "OpsPushQueueEntry" (
  "id" TEXT NOT NULL,
  "ownerUserId" UUID NOT NULL,
  "channel" VARCHAR(16) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "body" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(6),

  CONSTRAINT "OpsPushQueueEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OpsPushQueueEntry_ownerUserId_createdAt_idx"
  ON "OpsPushQueueEntry"("ownerUserId", "createdAt");

CREATE INDEX "OpsPushQueueEntry_ownerUserId_status_idx"
  ON "OpsPushQueueEntry"("ownerUserId", "status");