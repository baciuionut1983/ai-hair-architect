-- M13F restore governance retention ledger and query indexes

-- CreateEnum
CREATE TYPE "OpsBackupRestoreRetentionRunStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "OpsBackupRestoreRetentionRun" (
    "id" TEXT NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "status" "OpsBackupRestoreRetentionRunStatus" NOT NULL,
    "policyVersion" VARCHAR(32) NOT NULL,
    "batchLimit" INTEGER NOT NULL,
    "evaluationTime" TIMESTAMP(6) NOT NULL,
    "retentionFingerprint" VARCHAR(64) NOT NULL,
    "executionIdempotencyKey" VARCHAR(190) NOT NULL,
    "idempotencyFingerprint" VARCHAR(64) NOT NULL,
    "advisoryLockKey" VARCHAR(32) NOT NULL,
    "candidateRestoreRunCount" INTEGER NOT NULL DEFAULT 0,
    "candidateMaintenanceRunCount" INTEGER NOT NULL DEFAULT 0,
    "deletedRestoreRunCount" INTEGER NOT NULL DEFAULT 0,
    "deletedMaintenanceRunCount" INTEGER NOT NULL DEFAULT 0,
    "finalErrorCode" VARCHAR(80),
    "startedAt" TIMESTAMP(6) NOT NULL,
    "finishedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "OpsBackupRestoreRetentionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpsBackupRestoreRetentionRun_ownerUserId_executionIdempotencyKey_key"
  ON "OpsBackupRestoreRetentionRun"("ownerUserId", "executionIdempotencyKey");

-- CreateIndex
CREATE INDEX "OpsBackupRestoreRetentionRun_ownerUserId_status_startedAt_idx"
  ON "OpsBackupRestoreRetentionRun"("ownerUserId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "OpsBackupRestoreRetentionRun_ownerUserId_evaluationTime_idx"
  ON "OpsBackupRestoreRetentionRun"("ownerUserId", "evaluationTime");

-- CreateIndex
CREATE INDEX "OpsBackupRestoreRetentionRun_ownerUserId_createdAt_idx"
  ON "OpsBackupRestoreRetentionRun"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "OpsBackupRestoreRun_ownerUserId_status_finishedAt_id_idx"
  ON "OpsBackupRestoreRun"("ownerUserId", "status", "finishedAt", "id");

-- CreateIndex
CREATE INDEX "OpsBackupRestoreMaintenanceRun_ownerUserId_status_finishedAt_id_idx"
  ON "OpsBackupRestoreMaintenanceRun"("ownerUserId", "status", "finishedAt", "id");
