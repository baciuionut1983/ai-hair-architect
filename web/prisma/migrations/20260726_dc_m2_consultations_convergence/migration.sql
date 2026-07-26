DO $$
BEGIN
  IF to_regclass('"Consultation"') IS NOT NULL THEN
    RAISE EXCEPTION 'DC_M2_CONSULTATION_TABLE_ALREADY_EXISTS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Client"
    GROUP BY "id", "ownerUserId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DC_M2_CLIENT_CANDIDATE_KEY_PREFLIGHT_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Analysis"
    GROUP BY "id", "ownerUserId", "clientId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DC_M2_ANALYSIS_CANDIDATE_KEY_PREFLIGHT_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Analysis" a
    LEFT JOIN "User" u ON u."id" = a."ownerUserId"
    WHERE u."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'DC_M2_ANALYSIS_OWNER_PREFLIGHT_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Analysis" a
    LEFT JOIN "Client" c
      ON c."id" = a."clientId"
     AND c."ownerUserId" = a."ownerUserId"
    WHERE c."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'DC_M2_ANALYSIS_CLIENT_PREFLIGHT_FAILED';
  END IF;
END $$;

ALTER TABLE "Client"
  ADD CONSTRAINT "Client_id_ownerUserId_key"
  UNIQUE ("id", "ownerUserId");

ALTER TABLE "Analysis"
  ADD CONSTRAINT "Analysis_id_ownerUserId_clientId_key"
  UNIQUE ("id", "ownerUserId", "clientId");

CREATE TABLE "Consultation" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL,
  "summary" VARCHAR(4000) NOT NULL,
  "nextSteps" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Consultation_ownerUserId_createdAt_id_idx"
  ON "Consultation"("ownerUserId", "createdAt", "id");

CREATE INDEX "Consultation_ownerUserId_clientId_createdAt_id_idx"
  ON "Consultation"("ownerUserId", "clientId", "createdAt", "id");

CREATE INDEX "Consultation_analysisId_ownerUserId_clientId_idx"
  ON "Consultation"("analysisId", "ownerUserId", "clientId");

ALTER TABLE "Consultation"
  ADD CONSTRAINT "Consultation_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Consultation"
  ADD CONSTRAINT "Consultation_clientId_ownerUserId_fkey"
  FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Consultation"
  ADD CONSTRAINT "Consultation_analysisId_ownerUserId_clientId_fkey"
  FOREIGN KEY ("analysisId", "ownerUserId", "clientId") REFERENCES "Analysis"("id", "ownerUserId", "clientId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
