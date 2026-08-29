-- Technical Visual Map, Stage 5A -- schema/migration only. Hand-authored,
-- exactly like the two migrations this one builds on
-- (20260827_analysis_proposal, 20260829_technical_visual_map), because this
-- migration also needs a hand-written partial unique index Prisma's own
-- `migrate dev` cannot express.
--
-- Only the three changes actually authorized for Stage 5A are included here.
-- A real `prisma migrate diff` against this environment's live datasource
-- also reported a substantial amount of PRE-EXISTING, unrelated schema
-- drift (a WebhookEndpoint foreign key drop/recreate, Analysis/Client
-- column default/type changes, and several index/constraint renames caused
-- by Postgres's 63-character identifier truncation differing from Prisma's
-- current idealized name) -- none of that is Stage 5A's concern and none of
-- it is included below. Touching it was explicitly out of scope and would
-- have been an unrelated refactor.

-- Part 1: TechnicalVisualMap composite-uniqueness prerequisite.
-- Additive and structurally safe regardless of existing data -- `id` is
-- already this table's own primary key (globally unique on its own), so
-- this can only ever add a redundant-but-harmless second uniqueness
-- guarantee over columns that already co-occur uniquely per row. Verified
-- against the real database before writing this migration: 0 existing
-- TechnicalVisualMap rows (see the Stage 5A final report's pre-migration
-- data check for the exact query run).
ALTER TABLE "TechnicalVisualMap" ADD CONSTRAINT "TechnicalVisualMap_id_ownerUserId_clientId_key" UNIQUE ("id", "ownerUserId", "clientId");

-- Part 2: ImageAsset gains nullable dimension columns for the NORMALIZED/
-- STORED bytes this asset actually persists and /content serves -- never
-- pre-normalization EXIF dimensions, never a "display" size. No mandatory
-- backfill: existing rows remain valid with NULL width/height.
ALTER TABLE "ImageAsset" ADD COLUMN "width" INTEGER;
ALTER TABLE "ImageAsset" ADD COLUMN "height" INTEGER;

-- Part 3: the new TechnicalVisualMapSpatialBinding table.
CREATE TABLE "TechnicalVisualMapSpatialBinding" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "technicalVisualMapId" TEXT NOT NULL,
    "sourceImageAssetId" TEXT NOT NULL,
    "sourceImageAnalysisId" TEXT,
    "viewLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "spatialVersion" INTEGER NOT NULL,
    "geometrySchemaVersion" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "frozenWidth" INTEGER NOT NULL,
    "frozenHeight" INTEGER NOT NULL,
    "frozenOrientation" INTEGER NOT NULL,
    "frozenContentSha256" CHAR(64),
    "frozenStorageVersionId" VARCHAR(1024),
    "supersededBySpatialBindingId" TEXT,
    "confirmedAt" TIMESTAMP(6),
    "supersededAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "TechnicalVisualMapSpatialBinding_pkey" PRIMARY KEY ("id")
);

-- Ordinary version-uniqueness within the locked authority scope (Decision
-- Lock 12/13) -- mirrors TechnicalVisualMap's own mapVersion unique exactly.
CREATE UNIQUE INDEX "TechnicalVisualMapSpatialBinding_technicalVisualMapId_own_key" ON "TechnicalVisualMapSpatialBinding"("technicalVisualMapId", "ownerUserId", "clientId", "sourceImageAssetId", "viewLabel", "spatialVersion");

-- Access-pattern indexes (owner/client/map; map+image+view history ordered
-- by version; current-authority resolution by status) -- no speculative
-- indexes beyond what these three named patterns justify.
CREATE INDEX "TechnicalVisualMapSpatialBinding_clientId_ownerUserId_tec_idx" ON "TechnicalVisualMapSpatialBinding"("clientId", "ownerUserId", "technicalVisualMapId");
CREATE INDEX "TechnicalVisualMapSpatialBinding_technicalVisualMapId_ow2_idx" ON "TechnicalVisualMapSpatialBinding"("technicalVisualMapId", "ownerUserId", "clientId", "sourceImageAssetId", "viewLabel", "spatialVersion");
CREATE INDEX "TechnicalVisualMapSpatialBinding_ownerUserId_clientId_tec_idx" ON "TechnicalVisualMapSpatialBinding"("ownerUserId", "clientId", "technicalVisualMapId", "sourceImageAssetId", "viewLabel", "status");

-- Foreign keys. ownerUserId/clientId follow the exact existing owner/client
-- integrity convention (Decision Lock 9), reusing Client's own already-
-- existing @@unique([id, ownerUserId]) -- no schema change needed there.
-- technicalVisualMapId is a REAL composite FK (Decision Lock 8/16/17) to the
-- prerequisite unique added in Part 1 above -- never trusted as a bare,
-- unscoped id. sourceImageAssetId is deliberately NOT a foreign key here
-- (Decision Lock 10/16) -- see the schema.prisma doc comment on that column
-- for why a validated pointer is the correct choice, not a database FK.
ALTER TABLE "TechnicalVisualMapSpatialBinding" ADD CONSTRAINT "TechnicalVisualMapSpatialBinding_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TechnicalVisualMapSpatialBinding" ADD CONSTRAINT "TechnicalVisualMapSpatialBinding_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TechnicalVisualMapSpatialBinding" ADD CONSTRAINT "TechnicalVisualMapSpatialBinding_technicalVisualMapId_fkey" FOREIGN KEY ("technicalVisualMapId", "ownerUserId", "clientId") REFERENCES "TechnicalVisualMap"("id", "ownerUserId", "clientId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The one constraint Prisma's own schema language cannot express: at most
-- ONE CONFIRMED spatial binding per exact (ownerUserId, clientId,
-- technicalVisualMapId, sourceImageAssetId, viewLabel) scope, while still
-- allowing unlimited DRAFT and SUPERSEDED rows in that same scope (a plain
-- unique constraint would wrongly block those). Exact structural mirror of
-- TechnicalVisualMap's own
-- "TechnicalVisualMap_one_confirmed_per_owner_client_proposal_vertical"
-- partial index (20260829_technical_visual_map/migration.sql), which itself
-- mirrors AnalysisProposal's own precedent one migration before that.
CREATE UNIQUE INDEX "TechnicalVisualMapSpatialBinding_one_confirmed_per_scope" ON "TechnicalVisualMapSpatialBinding" ("ownerUserId", "clientId", "technicalVisualMapId", "sourceImageAssetId", "viewLabel") WHERE "status" = 'CONFIRMED';
