-- M17 GO-2: billing persistence foundation (BillingCustomer, BillingSubscription,
-- BillingPayment, BillingWebhookEvent). Purely additive: no existing table, column,
-- constraint, or index is altered, renamed, or dropped. No data is modified.
--
-- This file was generated via `prisma migrate diff` against the live test database and
-- then manually curated to remove unrelated pre-existing drift picked up by that diff
-- (an out-of-date WebhookEndpoint foreign key/index and Analysis/Client column
-- definitions already present in the database ahead of any migration file) -- none of
-- that drift is part of M17's scope and none of it is included below.

-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('stripe');

-- CreateEnum
CREATE TYPE "BillingSubscriptionStatus" AS ENUM ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused');

-- CreateEnum
CREATE TYPE "BillingPaymentStatus" AS ENUM ('pending', 'succeeded', 'failed', 'refunded', 'disputed');

-- CreateEnum
CREATE TYPE "BillingWebhookEventStatus" AS ENUM ('received', 'processing', 'processed', 'ignored_out_of_order', 'ignored_unsupported', 'failed_retryable', 'failed_terminal');

-- CreateTable
CREATE TABLE "BillingCustomer" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL DEFAULT 'stripe',
    "providerCustomerId" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "BillingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "billingCustomerId" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL DEFAULT 'stripe',
    "providerSubscriptionId" VARCHAR(255) NOT NULL,
    "planKey" VARCHAR(64) NOT NULL,
    "status" "BillingSubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMP(6),
    "currentPeriodEnd" TIMESTAMP(6),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(6),
    "lastAppliedEventCreatedAt" TIMESTAMP(6),
    "lastAppliedEventId" VARCHAR(255),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPayment" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "billingSubscriptionId" TEXT,
    "provider" "BillingProvider" NOT NULL DEFAULT 'stripe',
    "providerInvoiceId" VARCHAR(255) NOT NULL,
    "providerPaymentIntentId" VARCHAR(255),
    "amountCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "BillingPaymentStatus" NOT NULL,
    "paidAt" TIMESTAMP(6),
    "failedAt" TIMESTAMP(6),
    "failureCode" VARCHAR(80),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL DEFAULT 'stripe',
    "providerEventId" VARCHAR(255) NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "apiVersion" VARCHAR(32),
    "status" "BillingWebhookEventStatus" NOT NULL DEFAULT 'received',
    "ownerUserId" TEXT,
    "providerCustomerId" VARCHAR(255),
    "providerSubscriptionId" VARCHAR(255),
    "providerInvoiceId" VARCHAR(255),
    "eventCreatedAt" TIMESTAMP(6) NOT NULL,
    "receivedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptedAt" TIMESTAMP(6),
    "processedAt" TIMESTAMP(6),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailureCode" VARCHAR(80),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingCustomer_ownerUserId_idx" ON "BillingCustomer"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_id_ownerUserId_key" ON "BillingCustomer"("id", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_provider_providerCustomerId_key" ON "BillingCustomer"("provider", "providerCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_ownerUserId_provider_key" ON "BillingCustomer"("ownerUserId", "provider");

-- CreateIndex
CREATE INDEX "BillingSubscription_ownerUserId_status_idx" ON "BillingSubscription"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "BillingSubscription_billingCustomerId_idx" ON "BillingSubscription"("billingCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_id_ownerUserId_key" ON "BillingSubscription"("id", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_provider_providerSubscriptionId_key" ON "BillingSubscription"("provider", "providerSubscriptionId");

-- CreateIndex
CREATE INDEX "BillingPayment_ownerUserId_createdAt_idx" ON "BillingPayment"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingPayment_billingSubscriptionId_idx" ON "BillingPayment"("billingSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPayment_provider_providerInvoiceId_key" ON "BillingPayment"("provider", "providerInvoiceId");

-- CreateIndex
CREATE INDEX "BillingWebhookEvent_ownerUserId_receivedAt_idx" ON "BillingWebhookEvent"("ownerUserId", "receivedAt");

-- CreateIndex
CREATE INDEX "BillingWebhookEvent_status_receivedAt_idx" ON "BillingWebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "BillingWebhookEvent_providerSubscriptionId_idx" ON "BillingWebhookEvent"("providerSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingWebhookEvent_provider_providerEventId_key" ON "BillingWebhookEvent"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "BillingCustomer" ADD CONSTRAINT "BillingCustomer_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_billingCustomerId_ownerUserId_fkey" FOREIGN KEY ("billingCustomerId", "ownerUserId") REFERENCES "BillingCustomer"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_billingSubscriptionId_ownerUserId_fkey" FOREIGN KEY ("billingSubscriptionId", "ownerUserId") REFERENCES "BillingSubscription"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;
