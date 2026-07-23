-- AlterEnum
ALTER TYPE "OpsBackupRestoreRunStatus" ADD VALUE IF NOT EXISTS 'indeterminate';

-- CreateEnum
CREATE TYPE "OpsBackupRestoreMaintenanceRunStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "OpsBackupRestoreMaintenanceRun" (
    "id" TEXT NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "status" "OpsBackupRestoreMaintenanceRunStatus" NOT NULL,
    "staleThresholdMinutes" INTEGER NOT NULL,
    "evaluationTime" TIMESTAMP(6) NOT NULL,
    "maintenanceFingerprint" VARCHAR(64) NOT NULL,
    "executionIdempotencyKey" VARCHAR(190) NOT NULL,
    "idempotencyFingerprint" VARCHAR(64) NOT NULL,
    "advisoryLockKey" VARCHAR(32) NOT NULL,
    "candidatesScanned" INTEGER NOT NULL DEFAULT 0,
    "candidatesReconciledIndeterminate" INTEGER NOT NULL DEFAULT 0,
    "finalErrorCode" VARCHAR(80),
    "startedAt" TIMESTAMP(6) NOT NULL,
    "finishedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "OpsBackupRestoreMaintenanceRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpsBackupRestoreMaintenanceRun_ownerUserId_executionIdempotencyKey_key" ON "OpsBackupRestoreMaintenanceRun"("ownerUserId", "executionIdempotencyKey");

-- CreateIndex
CREATE INDEX "OpsBackupRestoreMaintenanceRun_ownerUserId_status_startedAt_idx" ON "OpsBackupRestoreMaintenanceRun"("ownerUserId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "OpsBackupRestoreMaintenanceRun_ownerUserId_createdAt_idx" ON "OpsBackupRestoreMaintenanceRun"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "OpsBackupRestoreMaintenanceRun_ownerUserId_evaluationTime_idx" ON "OpsBackupRestoreMaintenanceRun"("ownerUserId", "evaluationTime");