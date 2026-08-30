-- Real AI Photo Preview, Stage 1 -- schema/migration only. Hand-authored,
-- exactly like the migrations this one builds on
-- (20260827_analysis_proposal, 20260829_technical_visual_map,
-- 20260829_technical_visual_map_spatial_binding), for the same reason: a
-- real `prisma migrate diff` against this environment's live datasource
-- reports substantial PRE-EXISTING, unrelated schema drift not authorized
-- by this stage -- none of it is included below.
--
-- Only the one change actually authorized for Stage 1 is included: the new
-- PhotoPreviewGeneration table. No existing table is altered.
--
-- analysisProposalId / technicalVisualMapId / spatialBindingId /
-- sourceImageAssetId / sourceImageAnalysisId are all deliberately NOT
-- foreign keys here -- see this table's own doc comment in schema.prisma
-- for the two independent reasons (TechnicalVisualMapSpatialBinding has no
-- `@@unique([id, ownerUserId, clientId])` today, and the real integrity
-- guarantee this row needs comes from its own frozen snapshot fields, not a
-- live relation). ownerUserId/clientId follow the exact existing
-- owner/client integrity convention, reusing Client's own already-existing
-- @@unique([id, ownerUserId]) -- no schema change needed there.
CREATE TABLE "PhotoPreviewGeneration" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "analysisProposalId" TEXT NOT NULL,
    "analysisProposalConfirmedAt" TIMESTAMP(6) NOT NULL,
    "technicalVisualMapId" TEXT NOT NULL,
    "mapVersion" INTEGER NOT NULL,
    "spatialBindingId" TEXT NOT NULL,
    "spatialVersion" INTEGER NOT NULL,
    "sourceImageAssetId" TEXT NOT NULL,
    "sourceImageAnalysisId" TEXT,
    "viewLabel" TEXT NOT NULL,
    "frozenSourceWidth" INTEGER NOT NULL,
    "frozenSourceHeight" INTEGER NOT NULL,
    "frozenSourceOrientation" INTEGER NOT NULL,
    "frozenSourceContentSha256" CHAR(64),
    "frozenSourceStorageVersionId" VARCHAR(1024),
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "generationSchemaVersion" TEXT NOT NULL,
    "sealedRequest" JSONB NOT NULL,
    "requestFingerprint" VARCHAR(64) NOT NULL,
    "variationIndex" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "generatedImageAssetId" TEXT,
    "errorCode" TEXT,
    "errorMetadata" JSONB,
    "requestedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(6),
    "completedAt" TIMESTAMP(6),
    "failedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "PhotoPreviewGeneration_pkey" PRIMARY KEY ("id")
);

-- Idempotency backstop (task §18/§20) -- a DB-level unique constraint, not
-- an application-only check. See computePhotoPreviewRequestFingerprint
-- (photo-preview-contracts.ts) for exactly what this fingerprint is
-- derived from.
CREATE UNIQUE INDEX "PhotoPreviewGeneration_requestFingerprint_key" ON "PhotoPreviewGeneration"("requestFingerprint");

-- Access-pattern indexes -- owner/client listing; spatial-binding-scoped
-- history; status-based lookups (e.g. a future worker claiming REQUESTED
-- rows). No speculative indexes beyond what these three named patterns
-- justify.
CREATE INDEX "PhotoPreviewGeneration_ownerUserId_clientId_idx" ON "PhotoPreviewGeneration"("ownerUserId", "clientId");
CREATE INDEX "PhotoPreviewGeneration_spatialBindingId_ownerUserId_clien_idx" ON "PhotoPreviewGeneration"("spatialBindingId", "ownerUserId", "clientId");
CREATE INDEX "PhotoPreviewGeneration_status_idx" ON "PhotoPreviewGeneration"("status");

ALTER TABLE "PhotoPreviewGeneration" ADD CONSTRAINT "PhotoPreviewGeneration_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PhotoPreviewGeneration" ADD CONSTRAINT "PhotoPreviewGeneration_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;
