-- Stage 2.5.i.23 -- TECHNICAL EXECUTION VIDEO, CONCRETE PROVIDER
-- INTEGRATION. Hand-curated (see AGENTS/session precedent): the raw
-- `prisma migrate diff` output for this schema change also contained
-- unrelated, pre-existing drift on WebhookEndpoint/Analysis/Client/
-- Notification/TechnicalVisualMapSpatialBinding/WebhookDelivery/
-- AnalysisCorrection/OpsBackupRestore*/OpsImageAssetRetentionRun/
-- PhotoPreviewGeneration/TechnicalVisualMap*/VideoDemonstrationGeneration/
-- WebhookEndpointSecretVersion (identifier-length-truncation renames and an
-- unrelated FK/column-type drift), the same category of drift stripped from
-- every prior hand-curated migration in this repo. Only the statements
-- actually intended by this stage's own schema edit are included below.

-- CreateTable
CREATE TABLE "TechnicalExecutionVideoGeneration" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "technicalExecutionGenerationRequestId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "providerInstruction" TEXT NOT NULL,
    "requestFingerprint" VARCHAR(64) NOT NULL,
    "status" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "providerOperationId" TEXT,
    "generatedVideoAssetId" TEXT,
    "completionClaimedAt" TIMESTAMP(6),
    "nextPollAt" TIMESTAMP(6),
    "errorCode" TEXT,
    "errorMetadata" JSONB,
    "requestedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(6),
    "startedAt" TIMESTAMP(6),
    "completedAt" TIMESTAMP(6),
    "failedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "TechnicalExecutionVideoGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicalExecutionVideoGeneration_ownerUserId_clientId_idx" ON "TechnicalExecutionVideoGeneration"("ownerUserId", "clientId");

-- CreateIndex
CREATE INDEX "TechnicalExecutionVideoGeneration_technicalExecutionGenerat_idx" ON "TechnicalExecutionVideoGeneration"("technicalExecutionGenerationRequestId", "ownerUserId", "clientId");

-- CreateIndex
CREATE INDEX "TechnicalExecutionVideoGeneration_status_idx" ON "TechnicalExecutionVideoGeneration"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalExecutionVideoGeneration_requestFingerprint_key" ON "TechnicalExecutionVideoGeneration"("requestFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalExecutionGenerationRequest_id_ownerUserId_clientId_key" ON "TechnicalExecutionGenerationRequest"("id", "ownerUserId", "clientId");

-- AddForeignKey
ALTER TABLE "TechnicalExecutionVideoGeneration" ADD CONSTRAINT "TechnicalExecutionVideoGeneration_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalExecutionVideoGeneration" ADD CONSTRAINT "TechnicalExecutionVideoGeneration_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalExecutionVideoGeneration" ADD CONSTRAINT "TechnicalExecutionVideoGeneration_technicalExecutionGenera_fkey" FOREIGN KEY ("technicalExecutionGenerationRequestId", "ownerUserId", "clientId") REFERENCES "TechnicalExecutionGenerationRequest"("id", "ownerUserId", "clientId") ON DELETE RESTRICT ON UPDATE CASCADE;
