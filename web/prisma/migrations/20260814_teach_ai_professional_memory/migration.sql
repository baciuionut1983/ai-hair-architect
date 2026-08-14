CREATE TYPE "ProfessionalMemoryScope" AS ENUM ('client_specific', 'stylist_specific', 'shared_knowledge');
CREATE TYPE "ProfessionalMemoryKind" AS ENUM ('fact', 'professional_rule', 'preference', 'outcome', 'ai_observation');
CREATE TYPE "ProfessionalMemoryStatus" AS ENUM ('pending', 'active', 'revoked');
CREATE TYPE "ProfessionalMemorySource" AS ENUM ('typed', 'voice_transcript', 'consultation', 'analysis', 'outcome_feedback', 'import');

CREATE TABLE "ProfessionalMemory" (
  "id" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL, "clientId" TEXT,
  "scope" "ProfessionalMemoryScope" NOT NULL, "kind" "ProfessionalMemoryKind" NOT NULL,
  "status" "ProfessionalMemoryStatus" NOT NULL DEFAULT 'pending',
  "source" "ProfessionalMemorySource" NOT NULL, "content" VARCHAR(4000) NOT NULL,
  "provenance" JSONB NOT NULL, "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdByUserId" TEXT NOT NULL, "confirmedAt" TIMESTAMP(6), "revokedAt" TIMESTAMP(6),
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "ProfessionalMemory_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProfessionalMemoryAudit" (
  "id" TEXT NOT NULL, "memoryId" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL, "action" VARCHAR(32) NOT NULL, "details" JSONB NOT NULL,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfessionalMemoryAudit_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "VoiceTranscript" (
  "id" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL, "clientId" TEXT,
  "transcript" VARCHAR(4000) NOT NULL, "provider" VARCHAR(64) NOT NULL,
  "providerRequest" VARCHAR(200), "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoiceTranscript_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProfessionalMemory_ownerUserId_status_scope_updatedAt_idx" ON "ProfessionalMemory"("ownerUserId", "status", "scope", "updatedAt");
CREATE INDEX "ProfessionalMemory_ownerUserId_clientId_status_updatedAt_idx" ON "ProfessionalMemory"("ownerUserId", "clientId", "status", "updatedAt");
CREATE INDEX "ProfessionalMemoryAudit_ownerUserId_memoryId_createdAt_idx" ON "ProfessionalMemoryAudit"("ownerUserId", "memoryId", "createdAt");
CREATE INDEX "VoiceTranscript_ownerUserId_clientId_createdAt_idx" ON "VoiceTranscript"("ownerUserId", "clientId", "createdAt");
ALTER TABLE "ProfessionalMemory" ADD CONSTRAINT "ProfessionalMemory_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProfessionalMemory" ADD CONSTRAINT "ProfessionalMemory_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProfessionalMemoryAudit" ADD CONSTRAINT "ProfessionalMemoryAudit_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "ProfessionalMemory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProfessionalMemoryAudit" ADD CONSTRAINT "ProfessionalMemoryAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoiceTranscript" ADD CONSTRAINT "VoiceTranscript_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoiceTranscript" ADD CONSTRAINT "VoiceTranscript_clientId_ownerUserId_fkey" FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE CASCADE;
