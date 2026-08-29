-- Technical Visual Map, Stage 1 (schema only): one additive composite
-- constraint on an existing table, plus one new, strictly additive table.
-- Hand-written (not generated via `prisma migrate dev`) for the same reason
-- as every prior hand-written migration in this repo: the local database
-- user has no CREATEDB permission, so Prisma's shadow-database diff is
-- unavailable (see e.g. 20260827_analysis_proposal, 20260814_analysis_
-- correction_consultation_message, 20260812_billing_checkout_lock). No
-- existing table, column, constraint, or index is altered, renamed, or
-- dropped, and no existing row data is touched.
--
-- Part 1 -- AnalysisProposal composite uniqueness (Decision Lock finding):
-- AnalysisProposal previously had no composite unique beyond its own "id",
-- unlike Analysis's existing @@unique([id, ownerUserId, clientId]). Verified
-- safe before writing this: AnalysisProposal had 0 rows at migration time
-- (SELECT COUNT(*) FROM "AnalysisProposal" = 0), and "id" alone is already
-- the table's PRIMARY KEY (globally unique), so no existing or future row
-- can ever violate a 3-column composite unique that includes "id" as one of
-- its columns -- this ADD CONSTRAINT is unconditionally safe regardless of
-- data and requires no cleanup. This is purely additive; it changes no
-- existing query, relation, or application behavior -- it only makes a real,
-- database-enforced composite FK possible from TechnicalVisualMap to
-- AnalysisProposal(id, ownerUserId, clientId), the same integrity pattern
-- AnalysisProposal itself already relies on for its own "analysis" relation.
--
-- Part 2 -- TechnicalVisualMap: the durable, frozen record of one
-- deterministic map derived from a single CONFIRMED AnalysisProposal, moving
-- through the application-validated lifecycle DRAFT | CONFIRMED | SUPERSEDED
-- (Stage 2) -- deliberately no REJECTED state (Decision Lock: a map is a
-- derived artifact of an already-confirmed proposal, not an independently
-- evaluated option). "vertical" and "status" are plain TEXT, deliberately
-- NOT Postgres enums, matching AnalysisProposal.vertical/status and
-- Analysis.phase. "payload" is NOT NULL JSONB and deliberately untyped at
-- the SQL level -- the locked semantic shape (six anatomical zones, typed
-- per-zone intent, zone relationships, preserve/safety constraints) is
-- Stage 2 application-level work, not a Stage 1 schema concern.
-- "professionalAdjustments" is nullable JSONB, mirroring
-- AnalysisProposal.edits exactly (frozen-baseline + additive-adjustment).
-- "sourceImageAssetId"/"sourceImageAnalysisId" are intentionally plain
-- columns with NO foreign key (soft pointers), following the exact
-- AnalysisProposal precedent -- V1 is semantic-only, no coordinates, no
-- image dimensions, no crop geometry.
--
-- The composite foreign key to "AnalysisProposal" (id, ownerUserId,
-- clientId) -- and to "Client" (id, ownerUserId) -- makes it impossible at
-- the database level to attach a map to a proposal or client belonging to a
-- different owner or a different client, exactly as AnalysisProposal itself
-- already does for Analysis/Client.
--
-- AUTHORITATIVE INVARIANT (see the CREATE UNIQUE INDEX ... WHERE at the end
-- of this file): at most one CONFIRMED map may exist per (ownerUserId,
-- clientId, analysisProposalId, vertical) -- note this scope deliberately
-- includes analysisProposalId, unlike AnalysisProposal's own confirmed-index
-- scope (ownerUserId, clientId, vertical) -- each confirmed proposal has its
-- own independent map-authority slot; confirming a newer proposal does not
-- make an older proposal's map "compete" for the same slot. Prisma's schema
-- language has no native partial/filtered unique index, so this constraint
-- lives only here in migration SQL -- it is deliberately absent from
-- schema.prisma and a future `prisma migrate dev` diff must not be allowed
-- to "fix" it away. Same pattern as
-- "AnalysisProposal_one_confirmed_per_owner_client_vertical" in
-- 20260827_analysis_proposal, itself following
-- "WebhookEndpointSecretVersion_one_current_per_endpoint" in
-- 20260720_m10a_delivery_contracts.
--
-- A separate, ordinary (non-partial) unique index additionally prevents two
-- rows from ever sharing the same mapVersion within the locked authority
-- scope -- this one applies to every row regardless of status, so multiple
-- DRAFT and multiple SUPERSEDED rows remain structurally allowed (only the
-- version NUMBER must be unique per scope, not the row itself).
--
-- supersededByMapId is intentionally a plain column with NO enforced
-- self-relation FK -- same tradeoff already accepted for
-- AnalysisProposal.supersededByProposalId (no existing self-referencing
-- relation to mirror in this schema, and a composite-key self-relation here
-- would add real complexity for a pointer Stage 2's repository layer already
-- guarantees stays within the same (ownerUserId, clientId,
-- analysisProposalId, vertical) scope). No supersession is performed by
-- this migration; Stage 2 repository logic owns that behavior.

-- Part 1: AnalysisProposal composite uniqueness (additive, safe on 0 rows).
ALTER TABLE "AnalysisProposal"
  ADD CONSTRAINT "AnalysisProposal_id_ownerUserId_clientId_key"
  UNIQUE ("id", "ownerUserId", "clientId");

-- Part 2: CreateTable
CREATE TABLE "TechnicalVisualMap" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "analysisProposalId" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mapVersion" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sourceImageAssetId" TEXT,
    "sourceImageAnalysisId" TEXT,
    "generatorVersion" TEXT NOT NULL,
    "professionalAdjustments" JSONB,
    "supersededByMapId" TEXT,
    "confirmedAt" TIMESTAMP(6),
    "supersededAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "TechnicalVisualMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TechnicalVisualMap_analysisProposalId_ownerUserId_clientId_vertical_mapVersion_key"
  ON "TechnicalVisualMap"("analysisProposalId", "ownerUserId", "clientId", "vertical", "mapVersion");

CREATE INDEX "TechnicalVisualMap_clientId_ownerUserId_createdAt_id_idx"
  ON "TechnicalVisualMap"("clientId", "ownerUserId", "createdAt", "id");

CREATE INDEX "TechnicalVisualMap_analysisProposalId_ownerUserId_clientId_idx"
  ON "TechnicalVisualMap"("analysisProposalId", "ownerUserId", "clientId");

CREATE INDEX "TechnicalVisualMap_ownerUserId_clientId_analysisProposalId_vertical_idx"
  ON "TechnicalVisualMap"("ownerUserId", "clientId", "analysisProposalId", "vertical");

ALTER TABLE "TechnicalVisualMap"
  ADD CONSTRAINT "TechnicalVisualMap_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TechnicalVisualMap"
  ADD CONSTRAINT "TechnicalVisualMap_clientId_ownerUserId_fkey"
  FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TechnicalVisualMap"
  ADD CONSTRAINT "TechnicalVisualMap_analysisProposalId_ownerUserId_clientId_fkey"
  FOREIGN KEY ("analysisProposalId", "ownerUserId", "clientId") REFERENCES "AnalysisProposal"("id", "ownerUserId", "clientId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial UNIQUE INDEX -- the authoritative invariant that Prisma's schema
-- language cannot express (it has no native partial/filtered unique index).
-- At most one row may have status = 'CONFIRMED' per (ownerUserId, clientId,
-- analysisProposalId, vertical). This statement is the ONLY place this
-- constraint exists; it is intentionally not represented in schema.prisma,
-- and a future `prisma migrate dev` diff must not be allowed to drop it.
CREATE UNIQUE INDEX "TechnicalVisualMap_one_confirmed_per_owner_client_proposal_vertical"
  ON "TechnicalVisualMap" ("ownerUserId", "clientId", "analysisProposalId", "vertical")
  WHERE "status" = 'CONFIRMED';
