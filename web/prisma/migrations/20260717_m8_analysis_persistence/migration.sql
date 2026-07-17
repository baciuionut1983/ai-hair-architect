-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "hairType" TEXT NOT NULL,
    "density" TEXT NOT NULL,
    "porosity" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "clarificationRound" INTEGER NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "uncertaintyReasons" JSONB NOT NULL,
    "followUpQuestions" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "safetyNotes" JSONB NOT NULL,
    "faceShape" TEXT,
    "headShape" TEXT,
    "hairLength" TEXT,
    "hairTexture" TEXT,
    "hairCondition" TEXT,
    "growthPattern" TEXT,
    "targetShape" TEXT,
    "technicalCutPlan" JSONB,
    "clarificationAnswers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Analysis_ownerUserId_idx" ON "Analysis"("ownerUserId");

-- CreateIndex
CREATE INDEX "Analysis_clientId_idx" ON "Analysis"("clientId");

-- CreateIndex
CREATE INDEX "Analysis_ownerUserId_clientId_idx" ON "Analysis"("ownerUserId", "clientId");
