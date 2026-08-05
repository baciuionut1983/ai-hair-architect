-- M28: real Postgres persistence for the client CRM history that had been
-- in-memory only (milestone1-store.ts) since the M2/M3 era.
--
-- Strictly additive -- three new tables, zero changes to any existing
-- table, column, constraint, or row. No defaults or backfill invented:
-- these entities have no prior durable rows to migrate (the in-memory
-- store is process-local and is not read by this migration).
--
-- Ownership is enforced at the database level, not only in application
-- code: every row carries both clientId and ownerUserId, and the
-- composite foreign key to "Client" (clientId, ownerUserId) makes it
-- impossible to store a row whose client belongs to a different owner.
--
-- ClientFormula/ClientTreatment additionally carry an optional
-- sourceAnalysisId (pure traceability toward the AI-generated
-- ColorPlan/TreatmentPlan on Analysis, M27) -- never populated
-- automatically in M28. Its composite foreign key to "Analysis" (id,
-- ownerUserId, clientId) makes it impossible to link an Analysis
-- belonging to a different owner or a different client. ON DELETE
-- RESTRICT (not SET NULL): a composite SET NULL would need to null out
-- ownerUserId/clientId too, since they are part of the same relation,
-- but those columns are required. RESTRICT is also the project's
-- existing convention for owner/client foreign keys. Analysis has no
-- delete route today, so this is intentionally theoretical: an Analysis
-- referenced by CRM history cannot be deleted until the link is
-- explicitly removed, by design, for traceability.

CREATE TABLE "ClientPhoto" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientPhoto_clientId_ownerUserId_createdAt_id_idx"
  ON "ClientPhoto"("clientId", "ownerUserId", "createdAt", "id");

ALTER TABLE "ClientPhoto"
  ADD CONSTRAINT "ClientPhoto_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientPhoto"
  ADD CONSTRAINT "ClientPhoto_clientId_ownerUserId_fkey"
  FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ClientFormula" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "formulaName" TEXT NOT NULL,
    "formulaDetails" TEXT NOT NULL,
    "sourceAnalysisId" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientFormula_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientFormula_clientId_ownerUserId_createdAt_id_idx"
  ON "ClientFormula"("clientId", "ownerUserId", "createdAt", "id");

CREATE INDEX "ClientFormula_sourceAnalysisId_idx"
  ON "ClientFormula"("sourceAnalysisId");

ALTER TABLE "ClientFormula"
  ADD CONSTRAINT "ClientFormula_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientFormula"
  ADD CONSTRAINT "ClientFormula_clientId_ownerUserId_fkey"
  FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientFormula"
  ADD CONSTRAINT "ClientFormula_sourceAnalysisId_ownerUserId_clientId_fkey"
  FOREIGN KEY ("sourceAnalysisId", "ownerUserId", "clientId") REFERENCES "Analysis"("id", "ownerUserId", "clientId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ClientTreatment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "treatmentName" TEXT NOT NULL,
    "treatmentDetails" TEXT NOT NULL,
    "sourceAnalysisId" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientTreatment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientTreatment_clientId_ownerUserId_createdAt_id_idx"
  ON "ClientTreatment"("clientId", "ownerUserId", "createdAt", "id");

CREATE INDEX "ClientTreatment_sourceAnalysisId_idx"
  ON "ClientTreatment"("sourceAnalysisId");

ALTER TABLE "ClientTreatment"
  ADD CONSTRAINT "ClientTreatment_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientTreatment"
  ADD CONSTRAINT "ClientTreatment_clientId_ownerUserId_fkey"
  FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientTreatment"
  ADD CONSTRAINT "ClientTreatment_sourceAnalysisId_ownerUserId_clientId_fkey"
  FOREIGN KEY ("sourceAnalysisId", "ownerUserId", "clientId") REFERENCES "Analysis"("id", "ownerUserId", "clientId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
