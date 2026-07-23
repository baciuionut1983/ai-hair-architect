-- CreateEnum
CREATE TYPE "OpsBackupRestoreRunStatus" AS ENUM ('started', 'completed', 'failed');

-- CreateTable
CREATE TABLE "OpsBackupRestoreRun" (
    "id" TEXT NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "backupId" VARCHAR(120) NOT NULL,
    "actorUserId" UUID NOT NULL,
    "correlationRequestId" VARCHAR(120) NOT NULL,
    "strategy" VARCHAR(32) NOT NULL,
    "previewFingerprint" VARCHAR(64) NOT NULL,
    "currentStateFingerprint" VARCHAR(64) NOT NULL,
    "status" "OpsBackupRestoreRunStatus" NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "startedAt" TIMESTAMP(6) NOT NULL,
    "finishedAt" TIMESTAMP(6),
    "finalErrorCode" VARCHAR(80),
    "deletedClientCount" INTEGER,
    "deletedAnalysisCount" INTEGER,
    "deletedImageAssetCount" INTEGER,
    "deletedImageAnalysisCount" INTEGER,
    "deletedImageAnalysisReviewCount" INTEGER,
    "restoredClientCount" INTEGER,
    "restoredAnalysisCount" INTEGER,
    "restoredImageAssetCount" INTEGER,
    "restoredImageAnalysisCount" INTEGER,
    "restoredImageAnalysisReviewCount" INTEGER,
    "warningCodes" JSONB,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "OpsBackupRestoreRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpsBackupRestoreRun_ownerUserId_startedAt_id_idx" ON "OpsBackupRestoreRun"("ownerUserId", "startedAt", "id");

-- CreateIndex
CREATE INDEX "OpsBackupRestoreRun_ownerUserId_status_startedAt_id_idx" ON "OpsBackupRestoreRun"("ownerUserId", "status", "startedAt", "id");

-- CreateIndex
CREATE INDEX "OpsBackupRestoreRun_ownerUserId_backupId_startedAt_id_idx" ON "OpsBackupRestoreRun"("ownerUserId", "backupId", "startedAt", "id");

-- CreateIndex
CREATE INDEX "OpsBackupRestoreRun_ownerUserId_correlationRequestId_startedAt_id_idx" ON "OpsBackupRestoreRun"("ownerUserId", "correlationRequestId", "startedAt", "id");
