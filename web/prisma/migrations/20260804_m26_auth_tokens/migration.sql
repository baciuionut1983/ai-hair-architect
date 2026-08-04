-- M26 GO-2: email verification + password reset token ledger. Purely
-- additive: no existing table, column, constraint, or index is altered in
-- a destructive way, dropped, or renamed. Existing row data is modified in
-- exactly one deliberate, documented way (see the backfill UPDATE below).
--
-- This file was generated via `prisma migrate diff` against the live test
-- database and then manually curated to remove unrelated pre-existing
-- drift picked up by that diff (WebhookEndpoint FK/index normalization,
-- Analysis updatedAt default drop, Client timestamp precision, and several
-- RenameForeignKey/RenameIndex constraint-name normalizations already
-- present in the database ahead of any migration file) -- none of that
-- drift is part of M26's scope and none of it is included below.
--
-- No raw token is ever persisted anywhere, only tokenHash (a SHA-256
-- digest computed application-side).

-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('email_verification', 'password_reset');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- Backfill (deliberate, documented, one-time): M26's email-verification
-- gate applies only to accounts created after this migration runs. Every
-- account that already existed was created under the old, non-gated
-- register flow and must never be retroactively locked out of an app it
-- already had full access to. Each existing row is marked verified as of
-- its own createdAt -- the moment it registered under the rules that were
-- actually in effect then -- rather than the migration's execution time,
-- which would fabricate a verification event that never happened. Rows
-- created after this migration get NULL from the column's own absence of
-- a default (see schema.prisma) and must complete the real M26 flow.
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_purpose_createdAt_idx" ON "AuthToken"("userId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
