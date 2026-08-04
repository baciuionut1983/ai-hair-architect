-- M25 GO-2: real, metadata-only delivery ledger for operational/
-- transactional email. Purely additive: no existing table, column,
-- constraint, or index is altered, dropped, or renamed. No existing row's
-- existing data is modified.
--
-- This file was generated via `prisma migrate diff` against the live test
-- database and then manually curated to remove unrelated pre-existing
-- drift picked up by that diff (WebhookEndpoint FK/index normalization,
-- Analysis updatedAt default drop, Client timestamp precision, and several
-- RenameForeignKey/RenameIndex constraint-name normalizations already
-- present in the database ahead of any migration file) -- none of that
-- drift is part of M25's scope and none of it is included below.
--
-- No email body/content column exists here by design: only metadata
-- needed for delivery tracking and support/debugging is persisted
-- (subject, category, status, idempotencyKey, providerMessageId, a safe
-- truncated failure reason, and timestamps). The rendered email body is
-- never stored.

-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('transactional', 'security', 'onboarding', 'product', 'billing', 'administrative');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "EmailNotification" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "category" "EmailCategory" NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "recipientEmail" VARCHAR(320) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'pending',
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "providerMessageId" VARCHAR(255),
    "failureCode" VARCHAR(80),
    "failureMessageSafe" VARCHAR(500),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "relatedEntityType" VARCHAR(40),
    "relatedEntityId" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(6),
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "EmailNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailNotification_idempotencyKey_key" ON "EmailNotification"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailNotification_ownerUserId_createdAt_idx" ON "EmailNotification"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailNotification_status_createdAt_idx" ON "EmailNotification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmailNotification_category_idx" ON "EmailNotification"("category");

-- AddForeignKey
ALTER TABLE "EmailNotification" ADD CONSTRAINT "EmailNotification_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
