-- Real AI Video Demonstration, Stage 1 -- schema/migration only.
-- Hand-authored, exactly like every prior migration in this domain (see
-- 20260830_photo_preview_generation and 20260831_photo_preview_generation_execution
-- for the same reasoning): the local database user has no CREATEDB
-- permission, so Prisma's shadow-database diff is unavailable, and a real
-- `prisma migrate diff` against this environment's live datasource reports
-- substantial PRE-EXISTING, unrelated schema drift not authorized by this
-- stage -- none of it is included below.
--
-- Two new, strictly additive tables. No existing table, column, constraint,
-- or index is altered, renamed, or dropped, and no existing row data is
-- touched.

-- CreateTable: VideoAsset -- durable video output storage, mirrors
-- ImageAsset's own storage-column shape so the existing S3 write/read
-- abstraction (object-storage.ts) is reused verbatim. Deliberately a
-- separate table from ImageAsset (Video Stage 0 Decision Lock, section
-- 7/H) -- see schema.prisma's own doc comment on this model for the full
-- reasoning.
CREATE TABLE "VideoAsset" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "storagePath" TEXT NOT NULL,
    "storageBackend" VARCHAR(16),
    "storageBucketAlias" VARCHAR(64),
    "storageKey" VARCHAR(512),
    "storageVersionId" VARCHAR(1024),
    "storageEtag" VARCHAR(256),
    "contentSha256" CHAR(64),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VideoAsset_ownerUserId_clientId_idx" ON "VideoAsset"("ownerUserId", "clientId");

ALTER TABLE "VideoAsset" ADD CONSTRAINT "VideoAsset_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VideoAsset" ADD CONSTRAINT "VideoAsset_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: VideoDemonstrationGeneration -- the durable, auditable video
-- generation job. photoPreviewGenerationId / analysisProposalId /
-- technicalVisualMapId / spatialBindingId / sourceGeneratedImageAssetId are
-- all deliberately VALIDATED POINTERS, NOT enforced database foreign keys
-- -- same established precedent as PhotoPreviewGeneration's own identical
-- pointers to ITS parents (PhotoPreviewGeneration itself has no
-- @@unique([id, ownerUserId, clientId]) today, so a real composite FK to it
-- is not possible without also migrating that already-shipped Stage 1
-- table -- explicitly out of scope for this stage; the real integrity
-- guarantee this row needs is "what was true at video-request-creation
-- time, forever", which the frozen snapshot fields provide directly).
CREATE TABLE "VideoDemonstrationGeneration" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "photoPreviewGenerationId" TEXT NOT NULL,
    "analysisProposalId" TEXT NOT NULL,
    "analysisProposalConfirmedAt" TIMESTAMP(6) NOT NULL,
    "technicalVisualMapId" TEXT NOT NULL,
    "mapVersion" INTEGER NOT NULL,
    "spatialBindingId" TEXT NOT NULL,
    "spatialVersion" INTEGER NOT NULL,
    "sourceGeneratedImageAssetId" TEXT NOT NULL,
    "frozenSourceContentSha256" CHAR(64),
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "generationSchemaVersion" TEXT NOT NULL,
    "sealedRequest" JSONB NOT NULL,
    "requestFingerprint" VARCHAR(64) NOT NULL,
    "variationIndex" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "providerOperationId" TEXT,
    "generatedVideoAssetId" TEXT,
    "errorCode" TEXT,
    "errorMetadata" JSONB,
    "requestedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(6),
    "startedAt" TIMESTAMP(6),
    "completedAt" TIMESTAMP(6),
    "failedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "VideoDemonstrationGeneration_pkey" PRIMARY KEY ("id")
);

-- Idempotency backstop -- a DB-level unique constraint, not an
-- application-only check. Identical precedent to
-- PhotoPreviewGeneration_requestFingerprint_key.
CREATE UNIQUE INDEX "VideoDemonstrationGeneration_requestFingerprint_key" ON "VideoDemonstrationGeneration"("requestFingerprint");

-- Access-pattern indexes -- owner/client listing; source-Photo-Preview-scoped
-- history; status-based lookups (recovery/polling). No speculative indexes
-- beyond what these three named patterns justify.
CREATE INDEX "VideoDemonstrationGeneration_ownerUserId_clientId_idx" ON "VideoDemonstrationGeneration"("ownerUserId", "clientId");
CREATE INDEX "VideoDemonstrationGeneration_photoPreviewGenerationId_own_idx" ON "VideoDemonstrationGeneration"("photoPreviewGenerationId", "ownerUserId", "clientId");
CREATE INDEX "VideoDemonstrationGeneration_status_idx" ON "VideoDemonstrationGeneration"("status");

ALTER TABLE "VideoDemonstrationGeneration" ADD CONSTRAINT "VideoDemonstrationGeneration_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VideoDemonstrationGeneration" ADD CONSTRAINT "VideoDemonstrationGeneration_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;
