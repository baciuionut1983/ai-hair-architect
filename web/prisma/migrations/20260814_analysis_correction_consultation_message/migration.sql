-- Conversational Professional AI milestone: two new, strictly additive
-- tables. Hand-written (not generated via `prisma migrate dev`) because the
-- local database user does not have CREATEDB permission, so Prisma's
-- shadow-database diff is unavailable here -- same situation as every prior
-- hand-written migration in this repo (see e.g. 20260812_billing_checkout_lock,
-- 20260805_m28_client_history). No existing table, column, constraint, or
-- index is altered, renamed, or dropped.
--
-- AnalysisCorrection: an append-only audit trail of every structured field
-- correction ever applied to an Analysis, with provenance (source enum) and
-- an optional free-text reason. Composite foreign key to "Analysis"
-- (id, ownerUserId, clientId) makes it impossible to record a correction
-- against an Analysis belonging to a different owner or a different client.
--
-- ConsultationMessage: append-only conversational AI history, scoped to
-- (ownerUserId, clientId) rather than strictly to one Analysis (a
-- conversation may start before a specific Analysis exists). analysisId is
-- nullable; when present, its composite foreign key to "Analysis"
-- (id, ownerUserId, clientId) provides the same owner/client integrity
-- guarantee as AnalysisCorrection.

-- CreateEnum
CREATE TYPE "AnalysisFieldSource" AS ENUM ('visual_ai', 'stylist_confirmed', 'client_reported', 'historical', 'assumed');

-- CreateEnum
CREATE TYPE "ConsultationMessageRole" AS ENUM ('stylist', 'assistant');

-- CreateTable
CREATE TABLE "AnalysisCorrection" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fieldName" VARCHAR(64) NOT NULL,
    "previousValue" JSONB,
    "newValue" JSONB NOT NULL,
    "source" "AnalysisFieldSource" NOT NULL,
    "reason" VARCHAR(2000),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisCorrection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalysisCorrection_analysisId_ownerUserId_clientId_created_idx"
  ON "AnalysisCorrection"("analysisId", "ownerUserId", "clientId", "createdAt");

CREATE INDEX "AnalysisCorrection_ownerUserId_createdAt_idx"
  ON "AnalysisCorrection"("ownerUserId", "createdAt");

ALTER TABLE "AnalysisCorrection"
  ADD CONSTRAINT "AnalysisCorrection_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AnalysisCorrection"
  ADD CONSTRAINT "AnalysisCorrection_clientId_ownerUserId_fkey"
  FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AnalysisCorrection"
  ADD CONSTRAINT "AnalysisCorrection_analysisId_ownerUserId_clientId_fkey"
  FOREIGN KEY ("analysisId", "ownerUserId", "clientId") REFERENCES "Analysis"("id", "ownerUserId", "clientId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ConsultationMessage" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "analysisId" TEXT,
    "role" "ConsultationMessageRole" NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "proposedCorrection" JSONB,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsultationMessage_ownerUserId_clientId_createdAt_idx"
  ON "ConsultationMessage"("ownerUserId", "clientId", "createdAt");

CREATE INDEX "ConsultationMessage_analysisId_ownerUserId_clientId_idx"
  ON "ConsultationMessage"("analysisId", "ownerUserId", "clientId");

ALTER TABLE "ConsultationMessage"
  ADD CONSTRAINT "ConsultationMessage_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConsultationMessage"
  ADD CONSTRAINT "ConsultationMessage_clientId_ownerUserId_fkey"
  FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConsultationMessage"
  ADD CONSTRAINT "ConsultationMessage_analysisId_ownerUserId_clientId_fkey"
  FOREIGN KEY ("analysisId", "ownerUserId", "clientId") REFERENCES "Analysis"("id", "ownerUserId", "clientId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
