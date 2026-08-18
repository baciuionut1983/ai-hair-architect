-- AI Usage & Cost Metering Phase 1: purely additive accounting/
-- observability foundation. No existing table, column, constraint, or
-- index is altered, dropped, or renamed, and no existing row data is
-- touched.
--
-- This file was generated via `prisma migrate diff` against the live test
-- database and then manually curated to remove unrelated pre-existing
-- drift picked up by that diff (WebhookEndpoint FK/index normalization,
-- Analysis updatedAt default drop, Client timestamp precision, and
-- several RenameForeignKey/RenameIndex constraint-name normalizations
-- already present in the database ahead of any migration file) -- none of
-- that drift is part of this task's scope, matching the same curation
-- already documented in the 20260804_m26_auth_tokens migration.

-- CreateEnum
CREATE TYPE "AiUsageModality" AS ENUM ('TEXT_GENERATION', 'IMAGE_ANALYSIS', 'IMAGE_GENERATION', 'VIDEO_GENERATION', 'STT', 'TTS');

-- CreateEnum
CREATE TYPE "AiUsageOutcome" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiUsageCostBasis" AS ENUM ('EXACT', 'CALCULATED', 'ESTIMATED', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerUserId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "clientId" TEXT,
    "analysisId" TEXT,
    "feature" VARCHAR(64) NOT NULL,
    "modality" "AiUsageModality" NOT NULL,
    "correlationId" VARCHAR(64) NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "providerRequestId" VARCHAR(128),
    "usage" JSONB NOT NULL DEFAULT '{}',
    "usageAvailable" BOOLEAN NOT NULL DEFAULT false,
    "estimatedCostMicros" BIGINT,
    "currency" VARCHAR(3),
    "pricingVersion" VARCHAR(32),
    "costBasis" "AiUsageCostBasis" NOT NULL DEFAULT 'UNAVAILABLE',
    "outcome" "AiUsageOutcome" NOT NULL,
    "errorCategory" VARCHAR(64),
    "latencyMs" INTEGER,

    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageEvent_idempotencyKey_key" ON "AiUsageEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AiUsageEvent_ownerUserId_createdAt_idx" ON "AiUsageEvent"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageEvent_feature_createdAt_idx" ON "AiUsageEvent"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageEvent_provider_model_createdAt_idx" ON "AiUsageEvent"("provider", "model", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageEvent_createdAt_idx" ON "AiUsageEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AiUsageEvent_correlationId_idx" ON "AiUsageEvent"("correlationId");

-- AddForeignKey
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
