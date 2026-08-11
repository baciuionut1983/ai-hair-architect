-- Adds BillingCheckoutLock: at most one in-flight Stripe checkout per
-- (ownerUserId, provider), enforced by the composite primary key itself so
-- the guarantee holds across any number of app instances sharing this
-- database. Hand-written (not generated via `prisma migrate dev`) because
-- the local database user does not have CREATEDB permission, so Prisma's
-- shadow-database diff is unavailable here -- same situation as the M17
-- migration's own header notes. Purely additive: no existing table,
-- column, constraint, or index is altered, renamed, or dropped.

-- CreateTable
CREATE TABLE "BillingCheckoutLock" (
    "ownerUserId" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL DEFAULT 'stripe',
    "plan" VARCHAR(64) NOT NULL,
    "providerSessionId" VARCHAR(255),
    "acquiredAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(6) NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "BillingCheckoutLock_pkey" PRIMARY KEY ("ownerUserId", "provider")
);

-- CreateIndex
CREATE INDEX "BillingCheckoutLock_expiresAt_idx" ON "BillingCheckoutLock"("expiresAt");

-- AddForeignKey
ALTER TABLE "BillingCheckoutLock" ADD CONSTRAINT "BillingCheckoutLock_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
