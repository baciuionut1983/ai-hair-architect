DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"Analysis"'::regclass
      AND conname IN (
        'Analysis_ownerUserId_fkey',
        'Analysis_clientId_ownerUserId_fkey'
      )
  ) THEN
    RAISE EXCEPTION 'DC_M3_ANALYSIS_FOREIGN_KEY_ALREADY_EXISTS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Analysis" a
    LEFT JOIN "User" u ON u."id" = a."ownerUserId"
    WHERE u."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'DC_M3_ANALYSIS_OWNER_PREFLIGHT_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Analysis" a
    LEFT JOIN "Client" c
      ON c."id" = a."clientId"
     AND c."ownerUserId" = a."ownerUserId"
    WHERE c."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'DC_M3_ANALYSIS_CLIENT_PREFLIGHT_FAILED';
  END IF;
END $$;

ALTER TABLE "Analysis"
  ADD CONSTRAINT "Analysis_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Analysis"
  ADD CONSTRAINT "Analysis_clientId_ownerUserId_fkey"
  FOREIGN KEY ("clientId", "ownerUserId") REFERENCES "Client"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE CASCADE;