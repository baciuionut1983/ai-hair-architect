-- AI Proposed Look (Phase 2), Stage 1 (schema only): one new, strictly
-- additive table. Hand-written (not generated via `prisma migrate dev`)
-- because the local database user does not have CREATEDB permission, so
-- Prisma's shadow-database diff is unavailable here -- the same situation as
-- every prior hand-written migration in this repo (see e.g.
-- 20260814_analysis_correction_consultation_message,
-- 20260805_m28_client_history, 20260812_billing_checkout_lock). No existing
-- table, column, constraint, or index is altered, renamed, or dropped, and
-- no existing row data is touched.
--
-- AnalysisProposal: the durable, frozen record of one deterministic-engine
-- proposal for a single Client in a single vertical, moving through the
-- application-validated lifecycle DRAFT | CONFIRMED | REJECTED | SUPERSEDED
-- (Stage 2). "vertical" and "status" are plain TEXT, deliberately NOT
-- Postgres enums, matching Analysis.phase -- adding a vertical or adjusting
-- the lifecycle later must not require a schema migration. "evidenceSnapshot"
-- (frozen INPUT evidence read from the source Analysis) and "payload" (frozen
-- engine OUTPUT) are NOT NULL JSONB; "edits", "consideredMemory" and
-- "promotedConsultationSources" are nullable JSONB provenance arrays.
--
-- The composite foreign key to "Analysis" (id, ownerUserId, clientId) -- and
-- to "Client" (id, ownerUserId) -- makes it impossible at the database level
-- to attach a proposal to an Analysis or Client belonging to a different
-- owner or a different client, exactly as AnalysisCorrection / ClientFormula
-- already do. "sourceImageAssetId", "sourceImageAnalysisId",
-- "primaryConsultationMessageId", "supersededByProposalId" and
-- "confirmedByUserId" are intentionally plain columns with NO foreign key
-- (soft pointers), following the AiUsageEvent.clientId/analysisId and
-- AuditLog.resourceId precedent and ProfessionalMemory.createdByUserId.
--
-- AUTHORITATIVE INVARIANT (see the CREATE UNIQUE INDEX ... WHERE at the end
-- of this file): at most one CONFIRMED proposal may exist per
-- (ownerUserId, clientId, vertical). Prisma's schema language has no native
-- partial/filtered unique index, so this constraint lives only here in
-- migration SQL -- it is deliberately absent from schema.prisma and a later
-- `prisma migrate dev` diff must not be allowed to "fix" it away. Same
-- pattern as "WebhookEndpointSecretVersion_one_current_per_endpoint" and
-- "WebhookEvent_ownerUserId_producerIdempotencyKey_not_null_key" in
-- 20260720_m10a_delivery_contracts.

-- CreateTable
CREATE TABLE "AnalysisProposal" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "analysisSnapshotAt" TIMESTAMP(6) NOT NULL,
    "sourceImageAssetId" TEXT,
    "sourceImageAnalysisId" TEXT,
    "engineVersion" TEXT NOT NULL,
    "evidenceSnapshot" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "edits" JSONB,
    "consideredMemory" JSONB,
    "primaryConsultationMessageId" TEXT,
    "promotedConsultationSources" JSONB,
    "supersededByProposalId" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(6),
    "rejectedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "AnalysisProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalysisProposal_clientId_ownerUserId_createdAt_id_idx"
  ON "AnalysisProposal"("clientId", "ownerUserId", "createdAt", "id");

CREATE INDEX "AnalysisProposal_analysisId_ownerUserId_clientId_idx"
  ON "AnalysisProposal"("analysisId", "ownerUserId", "clientId");

CREATE INDEX "AnalysisProposal_ownerUserId_clientId_vertical_idx"
  ON "AnalysisProposal"("ownerUserId", "clientId", "vertical");

ALTER TABLE "AnalysisProposal"
  ADD CONSTRAINT "AnalysisProposal_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AnalysisProposal"
  ADD CONSTRAINT "AnalysisProposal_clientId_ownerUserId_fkey"
  FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AnalysisProposal"
  ADD CONSTRAINT "AnalysisProposal_analysisId_ownerUserId_clientId_fkey"
  FOREIGN KEY ("analysisId", "ownerUserId", "clientId") REFERENCES "Analysis"("id", "ownerUserId", "clientId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial UNIQUE INDEX -- the authoritative invariant that Prisma's schema
-- language cannot express (it has no native partial/filtered unique index).
-- At most one row may have status = 'CONFIRMED' per
-- (ownerUserId, clientId, vertical). This statement is the ONLY place this
-- constraint exists; it is intentionally not represented in schema.prisma,
-- and a future `prisma migrate dev` diff must not be allowed to drop it.
-- Mirrors the existing partial unique indexes added in
-- 20260720_m10a_delivery_contracts.
CREATE UNIQUE INDEX "AnalysisProposal_one_confirmed_per_owner_client_vertical"
  ON "AnalysisProposal" ("ownerUserId", "clientId", "vertical")
  WHERE "status" = 'CONFIRMED';
