-- CreateTable WebhookEndpoint
CREATE TABLE "WebhookEndpoint" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "url" VARCHAR(2048) NOT NULL,
  "secretEncrypted" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) NOT NULL,

  CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebhookEndpoint_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- CreateIndex
CREATE INDEX "WebhookEndpoint_ownerUserId_idx" ON "WebhookEndpoint"("ownerUserId");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_ownerUserId_enabled_idx" ON "WebhookEndpoint"("ownerUserId", "enabled");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "WebhookEndpoint_ownerUserId_name_key" ON "WebhookEndpoint"("ownerUserId", "name");
