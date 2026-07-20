-- M10A delivery contracts, persistence model, and security invariants

-- 1. PostgreSQL ENUMs
CREATE TYPE "WebhookDeliveryStatus" AS ENUM (
  'pending',
  'dispatching',
  'delivered',
  'failed_retryable',
  'failed_terminal',
  'canceled'
);

CREATE TYPE "WebhookAttemptOutcome" AS ENUM (
  'success',
  'retryable_failure',
  'terminal_failure'
);

CREATE TYPE "WebhookFailureDomain" AS ENUM (
  'destination',
  'security',
  'configuration',
  'platform_internal'
);

CREATE TYPE "WebhookFailureCode" AS ENUM (
  'none',
  'timeout',
  'connection_refused',
  'connection_reset',
  'host_unreachable',
  'network_unreachable',
  'dns_temporary',
  'dns_not_found',
  'http_3xx_redirect_blocked',
  'http_408',
  'http_425',
  'http_429',
  'http_5xx',
  'http_4xx_non_retryable',
  'ssrf_blocked',
  'tls_certificate_error',
  'invalid_url',
  'endpoint_disabled',
  'endpoint_deleted',
  'internal_transient',
  'internal_persistent'
);

-- 2. WebhookEndpoint changes
ALTER TABLE "WebhookEndpoint"
ADD COLUMN "deletedAt" TIMESTAMP(6);

CREATE UNIQUE INDEX "WebhookEndpoint_id_ownerUserId_key"
  ON "WebhookEndpoint"("id", "ownerUserId");

-- 3. WebhookEndpointSecretVersion
CREATE TABLE "WebhookEndpointSecretVersion" (
  "id" TEXT NOT NULL,
  "webhookEndpointId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "secretEncrypted" TEXT NOT NULL,
  "signatureScheme" VARCHAR(64) NOT NULL DEFAULT 'hmac_sha256_v1',
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(6),
  "retainUntil" TIMESTAMP(6),

  CONSTRAINT "WebhookEndpointSecretVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebhookEndpointSecretVersion_webhookEndpointId_ownerUserId_fkey"
    FOREIGN KEY ("webhookEndpointId", "ownerUserId")
    REFERENCES "WebhookEndpoint"("id", "ownerUserId")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "WebhookEndpointSecretVersion_webhookEndpointId_createdAt_idx"
  ON "WebhookEndpointSecretVersion"("webhookEndpointId", "createdAt");

CREATE INDEX "WebhookEndpointSecretVersion_ownerUserId_retainUntil_idx"
  ON "WebhookEndpointSecretVersion"("ownerUserId", "retainUntil");

CREATE UNIQUE INDEX "WebhookEndpointSecretVersion_id_webhookEndpointId_ownerUserId_key"
  ON "WebhookEndpointSecretVersion"("id", "webhookEndpointId", "ownerUserId");

CREATE UNIQUE INDEX "WebhookEndpointSecretVersion_webhookEndpointId_version_key"
  ON "WebhookEndpointSecretVersion"("webhookEndpointId", "version");

-- 4. M9D backfill
-- Backfill preserves the existing encrypted secret verbatim.
-- The deterministic TEXT identifier keeps the migration pure SQL and repeatable
-- without introducing a dependency on UUID/CUID generation extensions.
-- The new versioned table becomes the forward-compatible secret model, while
-- WebhookEndpoint.secretEncrypted remains temporarily for M9D route compatibility.
INSERT INTO "WebhookEndpointSecretVersion" (
  "id",
  "webhookEndpointId",
  "ownerUserId",
  "version",
  "secretEncrypted",
  "signatureScheme",
  "isCurrent",
  "createdAt"
)
SELECT
  'whsv_' || substr(md5("id" || ':' || "ownerUserId"), 1, 24),
  "id",
  "ownerUserId",
  1,
  "secretEncrypted",
  'hmac_sha256_v1',
  true,
  COALESCE("createdAt", CURRENT_TIMESTAMP)
FROM "WebhookEndpoint";

-- 5. WebhookEvent
CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "eventType" VARCHAR(120) NOT NULL,
  "schemaVersion" VARCHAR(16) NOT NULL,
  "producerIdempotencyKey" VARCHAR(190),
  "resourceType" VARCHAR(80) NOT NULL,
  "resourceId" VARCHAR(120) NOT NULL,
  "occurredAt" TIMESTAMP(6) NOT NULL,
  "payload" JSONB NOT NULL,
  "dispatchEligible" BOOLEAN NOT NULL,
  "auditOnly" BOOLEAN NOT NULL,
  "sensitivity" VARCHAR(32) NOT NULL,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookEvent_ownerUserId_createdAt_idx"
  ON "WebhookEvent"("ownerUserId", "createdAt");

CREATE INDEX "WebhookEvent_eventType_occurredAt_idx"
  ON "WebhookEvent"("eventType", "occurredAt");

CREATE UNIQUE INDEX "WebhookEvent_id_ownerUserId_key"
  ON "WebhookEvent"("id", "ownerUserId");

-- 6. WebhookDelivery
CREATE TABLE "WebhookDelivery" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "webhookEventId" TEXT NOT NULL,
  "webhookEndpointId" TEXT NOT NULL,
  "secretVersionId" TEXT NOT NULL,
  "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 6,
  "connectivityMaxAttempts" INTEGER NOT NULL DEFAULT 3,
  "nextAttemptAt" TIMESTAMP(6),
  "lastAttemptAt" TIMESTAMP(6),
  "deliveredAt" TIMESTAMP(6),
  "leaseToken" VARCHAR(120),
  "leaseExpiresAt" TIMESTAMP(6),
  "lastFailureDomain" "WebhookFailureDomain",
  "lastFailureCode" "WebhookFailureCode" NOT NULL DEFAULT 'none',
  "idempotencyKey" VARCHAR(190) NOT NULL,
  "targetUrlSnapshot" VARCHAR(2048) NOT NULL,
  "signatureSchemeSnapshot" VARCHAR(64) NOT NULL,
  "secretVersionSnapshot" INTEGER NOT NULL,
  "eventTypeSnapshot" VARCHAR(120) NOT NULL,
  "approvedHeadersSnapshot" JSONB,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) NOT NULL,

  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebhookDelivery_webhookEventId_ownerUserId_fkey"
    FOREIGN KEY ("webhookEventId", "ownerUserId")
    REFERENCES "WebhookEvent"("id", "ownerUserId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WebhookDelivery_webhookEndpointId_ownerUserId_fkey"
    FOREIGN KEY ("webhookEndpointId", "ownerUserId")
    REFERENCES "WebhookEndpoint"("id", "ownerUserId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WebhookDelivery_secretVersionId_webhookEndpointId_ownerUserId_fkey"
    FOREIGN KEY ("secretVersionId", "webhookEndpointId", "ownerUserId")
    REFERENCES "WebhookEndpointSecretVersion"("id", "webhookEndpointId", "ownerUserId")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "WebhookDelivery_ownerUserId_status_nextAttemptAt_idx"
  ON "WebhookDelivery"("ownerUserId", "status", "nextAttemptAt");

CREATE INDEX "WebhookDelivery_ownerUserId_leaseExpiresAt_idx"
  ON "WebhookDelivery"("ownerUserId", "leaseExpiresAt");

CREATE INDEX "WebhookDelivery_webhookEndpointId_createdAt_idx"
  ON "WebhookDelivery"("webhookEndpointId", "createdAt");

CREATE INDEX "WebhookDelivery_secretVersionId_idx"
  ON "WebhookDelivery"("secretVersionId");

CREATE UNIQUE INDEX "WebhookDelivery_webhookEndpointId_webhookEventId_key"
  ON "WebhookDelivery"("webhookEndpointId", "webhookEventId");

CREATE UNIQUE INDEX "WebhookDelivery_ownerUserId_idempotencyKey_key"
  ON "WebhookDelivery"("ownerUserId", "idempotencyKey");

-- 7. WebhookDeliveryAttempt
CREATE TABLE "WebhookDeliveryAttempt" (
  "id" TEXT NOT NULL,
  "webhookDeliveryId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(6) NOT NULL,
  "completedAt" TIMESTAMP(6),
  "durationMs" INTEGER,
  "httpStatus" INTEGER,
  "outcome" "WebhookAttemptOutcome",
  "failureDomain" "WebhookFailureDomain",
  "failureCode" "WebhookFailureCode",
  "errorCode" VARCHAR(80),
  "errorMessageSafe" VARCHAR(500),
  "responseTruncated" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebhookDeliveryAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebhookDeliveryAttempt_webhookDeliveryId_fkey"
    FOREIGN KEY ("webhookDeliveryId")
    REFERENCES "WebhookDelivery"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "WebhookDeliveryAttempt_webhookDeliveryId_attemptNumber_idx"
  ON "WebhookDeliveryAttempt"("webhookDeliveryId", "attemptNumber");

CREATE INDEX "WebhookDeliveryAttempt_createdAt_idx"
  ON "WebhookDeliveryAttempt"("createdAt");

CREATE UNIQUE INDEX "WebhookDeliveryAttempt_webhookDeliveryId_attemptNumber_key"
  ON "WebhookDeliveryAttempt"("webhookDeliveryId", "attemptNumber");

-- 8. Indexes and partial unique indexes
CREATE UNIQUE INDEX "WebhookEvent_ownerUserId_producerIdempotencyKey_not_null_key"
  ON "WebhookEvent" ("ownerUserId", "producerIdempotencyKey")
  WHERE "producerIdempotencyKey" IS NOT NULL;

CREATE UNIQUE INDEX "WebhookEndpointSecretVersion_one_current_per_endpoint"
  ON "WebhookEndpointSecretVersion" ("webhookEndpointId")
  WHERE "isCurrent" = true;