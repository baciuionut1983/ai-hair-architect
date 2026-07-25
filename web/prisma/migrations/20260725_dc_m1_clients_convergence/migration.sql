DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Client" c
    LEFT JOIN "User" u ON u.id = c."ownerUserId"
    WHERE u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'DC_M1_CLIENT_OWNER_PREFLIGHT_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Client"
    WHERE name IS NULL OR btrim(name) = '' OR char_length(name) > 200
  ) THEN
    RAISE EXCEPTION 'DC_M1_CLIENT_NAME_PREFLIGHT_FAILED';
  END IF;
END $$;

ALTER TABLE "Client" RENAME COLUMN "name" TO "fullName";
ALTER TABLE "Client"
  ALTER COLUMN "fullName" TYPE VARCHAR(200),
  ADD COLUMN "email" VARCHAR(320),
  ADD COLUMN "phone" VARCHAR(40),
  ADD COLUMN "notes" VARCHAR(4000),
  ADD COLUMN "deletedAt" TIMESTAMP(6);

DROP INDEX IF EXISTS "Client_ownerUserId_idx";
CREATE INDEX "Client_ownerUserId_deletedAt_updatedAt_id_idx"
  ON "Client"("ownerUserId", "deletedAt", "updatedAt", "id");

ALTER TABLE "Client"
  ADD CONSTRAINT "Client_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;