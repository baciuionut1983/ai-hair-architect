import crypto from "crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  WebhookAllowedSubscriberType,
  WebhookAttemptOutcome,
  WebhookDeliveryStatus,
  WebhookEventEnvelope,
  WebhookEventSensitivity,
  WebhookEventType,
  WebhookFailureCode,
  WebhookFailureDomain,
  WebhookRetryClassification,
} from "@/lib/contracts";
import { prisma } from "@/lib/prisma";
import { decryptSecret, getMasterKeyFromEnv, hmacSignPayload } from "@/lib/webhook-crypto";
import { classifyWebhookRetry } from "@/lib/webhook-retry-classifier";
import {
  calculateWebhookRetryDelayMs,
  computeWebhookLeaseExpiresAt,
  WEBHOOK_LEASE_DURATION_MS,
} from "@/lib/webhook-delivery-retry-policy";
import { sendWebhookRequestSafe, WebhookSafeHttpError } from "@/lib/webhook-safe-http-client";
import { getWebhookEventCatalogEntry } from "@/lib/webhook-event-catalog";

export interface WebhookDeliveryWorkerOptions {
  client?: PrismaClient;
  now?: Date;
  limit?: number;
  random?: () => number;
  sendRequest?: typeof sendWebhookRequestSafe;
  masterKey?: Buffer;
  timeoutMs?: number;
  maxResponseBytes?: number;
  leaseDurationMs?: number;
}

export interface WebhookDeliveryWorkerResult {
  processed: number;
  delivered: number;
  retryable: number;
  terminal: number;
  skipped: number;
}

export interface WebhookDeliveryQueueStats {
  pending: number;
  dispatching: number;
  delivered: number;
  failedRetryable: number;
  failedTerminal: number;
  canceled: number;
  oldestPendingAgeMs: number | null;
}

interface ClaimedDeliveryRecord {
  id: string;
  ownerUserId: string;
  attemptCount: number;
  maxAttempts: number;
  connectivityMaxAttempts: number;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  targetUrlSnapshot: string;
  signatureSchemeSnapshot: string;
  secretVersionSnapshot: number;
  eventTypeSnapshot: string;
  approvedHeadersSnapshot: unknown;
  attemptId: string;
  event: {
    id: string;
    ownerUserId: string;
    eventType: string;
    schemaVersion: string;
    producerIdempotencyKey: string | null;
    resourceType: string;
    resourceId: string;
    occurredAt: Date;
    payload: unknown;
    dispatchEligible: boolean;
    auditOnly: boolean;
    sensitivity: string;
  };
  secretVersion: {
    secretEncrypted: string;
  };
};

type DbClient = PrismaClient | Prisma.TransactionClient;

function getDb(client?: PrismaClient): PrismaClient {
  return client ?? prisma;
}

function normalizeHeaders(snapshot: unknown): Record<string, string> {
  if (!snapshot || typeof snapshot !== "object") {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(snapshot as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim().length > 0) {
      result[key] = value;
    }
  }

  return result;
}

function normalizePayloadData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function getFailureClassificationFromError(error: unknown): WebhookRetryClassification {
  if (error instanceof WebhookSafeHttpError) {
    switch (error.code) {
      case "TIMEOUT":
        return classifyWebhookRetry({ systemErrorCode: "TIMEOUT" });
      case "BLOCKED_IP":
        return classifyWebhookRetry({ systemErrorCode: "BLOCKED_IP" });
      case "TLS_ERROR":
        return classifyWebhookRetry({ systemErrorCode: "TLS_ERROR" });
      case "INVALID_URL":
      case "UNSUPPORTED_PROTOCOL":
        return classifyWebhookRetry({ systemErrorCode: "INVALID_URL" });
      case "DNS_FAILED":
        return classifyWebhookRetry({ systemErrorCode: "EAI_AGAIN" });
      case "CONNECTION_ERROR":
        return classifyWebhookRetry({ systemErrorCode: "ECONNRESET" });
      case "REQUEST_FAILED":
      default:
        return classifyWebhookRetry({ internalErrorKind: "internal_transient" });
    }
  }

  return classifyWebhookRetry({ internalErrorKind: "internal_transient" });
}

function buildWebhookDeliveryEnvelope(record: ClaimedDeliveryRecord): WebhookEventEnvelope {
  const catalogEntry = getWebhookEventCatalogEntry(record.event.eventType as WebhookEventType);

  return {
    schemaVersion: record.event.schemaVersion as "1.0",
    eventId: record.event.id,
    eventType: record.event.eventType as WebhookEventType,
    occurredAt: record.event.occurredAt.toISOString(),
    ownerUserId: record.ownerUserId,
    resource: {
      type: record.event.resourceType,
      id: record.event.resourceId,
    },
    data: normalizePayloadData(record.event.payload),
    meta: {
      dispatchEligible: record.event.dispatchEligible,
      auditOnly: record.event.auditOnly,
      sensitivity: record.event.sensitivity as WebhookEventSensitivity,
      allowedSubscriberTypes: catalogEntry.allowedSubscriberTypes as WebhookAllowedSubscriberType[],
      ...(record.event.producerIdempotencyKey
        ? { producerIdempotencyKey: record.event.producerIdempotencyKey }
        : {}),
    },
  };
}

async function claimDeliveryLease(
  client: DbClient,
  deliveryId: string,
  now: Date,
  leaseToken: string,
  leaseDurationMs: number,
) {
  const claim = await client.webhookDelivery.updateMany({
    where: {
      id: deliveryId,
      status: {
        in: ["pending", "failed_retryable"],
      },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
    },
    data: {
      status: "dispatching",
      leaseToken,
      leaseExpiresAt: computeWebhookLeaseExpiresAt(now, leaseDurationMs),
      lastAttemptAt: now,
      attemptCount: {
        increment: 1,
      },
    },
  });

  if (claim.count !== 1) {
    return null;
  }

  const delivery = await client.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      event: true,
      secretVersion: true,
    },
  });

  if (!delivery) {
    return null;
  }

  const attempt = await client.webhookDeliveryAttempt.create({
    data: {
      webhookDeliveryId: delivery.id,
      attemptNumber: delivery.attemptCount,
      startedAt: now,
    },
  });

  return {
    ...delivery,
    attemptId: attempt.id,
  } as ClaimedDeliveryRecord;
}

async function finalizeClaimedDelivery(
  client: DbClient,
  claimed: ClaimedDeliveryRecord,
  leaseToken: string,
  classification: WebhookRetryClassification,
  response: { statusCode: number | null; responseTimeMs: number; truncated: boolean },
  completedAt: Date,
  random: () => number,
) {
  const delivery = await client.webhookDelivery.findUnique({
    where: { id: claimed.id },
  });

  if (!delivery || delivery.leaseToken !== leaseToken) {
    return null;
  }

  const attemptOutcome: WebhookAttemptOutcome =
    classification.deliveryStatus === "delivered" ? "success" : classification.outcome;

  const maxAttemptsReached = classification.deliveryStatus === "failed_retryable" && claimed.attemptCount >= claimed.maxAttempts;
  const finalStatus: Extract<WebhookDeliveryStatus, "delivered" | "failed_retryable" | "failed_terminal"> =
    classification.deliveryStatus === "delivered"
      ? "delivered"
      : maxAttemptsReached
        ? "failed_terminal"
        : classification.deliveryStatus;

  const nextAttemptAt =
    finalStatus === "failed_retryable"
      ? new Date(
          completedAt.getTime() +
            calculateWebhookRetryDelayMs({
              attemptNumber: claimed.attemptCount,
              classification,
              connectivityMaxAttempts: claimed.connectivityMaxAttempts,
              random,
            }),
        )
      : null;

  const updatedAttempt = await client.webhookDeliveryAttempt.updateMany({
    where: {
      id: claimed.attemptId,
      webhookDeliveryId: claimed.id,
    },
    data: {
      completedAt,
      durationMs: Math.max(0, response.responseTimeMs),
      httpStatus: response.statusCode,
      outcome: attemptOutcome,
      failureDomain: classification.failureDomain,
      failureCode: classification.failureCode,
      errorCode: response.statusCode === null ? classification.failureCode : null,
      errorMessageSafe: response.statusCode === null ? classification.failureCode : null,
      responseTruncated: response.truncated,
    },
  });

  if (updatedAttempt.count !== 1) {
    return null;
  }

  return client.webhookDelivery.update({
    where: { id: claimed.id },
    data: {
      status: finalStatus,
      deliveredAt: finalStatus === "delivered" ? completedAt : null,
      nextAttemptAt,
      lastFailureDomain: classification.failureDomain,
      lastFailureCode: classification.failureCode,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
}

export async function processWebhookDeliveryById(
  deliveryId: string,
  options: WebhookDeliveryWorkerOptions = {},
) {
  const client = getDb(options.client);
  const now = options.now ?? new Date();
  const leaseToken = crypto.randomUUID();
  const leaseDurationMs = options.leaseDurationMs ?? WEBHOOK_LEASE_DURATION_MS;
  const sendRequest = options.sendRequest ?? sendWebhookRequestSafe;
  const random = options.random ?? Math.random;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxResponseBytes = options.maxResponseBytes ?? 64 * 1024;

  const claimed = await client.$transaction(async tx => {
    const delivery = await claimDeliveryLease(tx, deliveryId, now, leaseToken, leaseDurationMs);
    if (!delivery) {
      return null;
    }

    return delivery as ClaimedDeliveryRecord;
  });

  if (!claimed) {
    return { processed: false, status: "skipped" as const };
  }

  let masterKey: Buffer;
  try {
    masterKey = options.masterKey ?? getMasterKeyFromEnv();
  } catch {
    masterKey = Buffer.alloc(0);
  }

  let classification: WebhookRetryClassification;
  let response: { statusCode: number | null; responseTimeMs: number; truncated: boolean } = {
    statusCode: null,
    responseTimeMs: 0,
    truncated: false,
  };

  try {
    if (masterKey.length !== 32) {
      throw new Error("WEBHOOK_SECRET_ENCRYPTION_KEY is required for delivery processing.");
    }

    const secret = decryptSecret(claimed.secretVersion.secretEncrypted, claimed.ownerUserId, masterKey);
    const envelope = buildWebhookDeliveryEnvelope(claimed);
    const payload = JSON.stringify(envelope);
    const timestamp = now.toISOString();
    const signature = hmacSignPayload(payload, timestamp, secret);

    response = await sendRequest({
      url: claimed.targetUrlSnapshot,
      method: "POST",
      headers: {
        ...normalizeHeaders(claimed.approvedHeadersSnapshot),
        "Content-Type": "application/json",
        "X-Webhook-Event": claimed.eventTypeSnapshot,
        "X-Webhook-Timestamp": timestamp,
        "X-Webhook-Signature": signature,
        "User-Agent": "AI-Hair-Architect-Webhook-Worker/1.0",
      },
      body: payload,
      timeoutMs,
      maxResponseBytes,
    });

    classification = classifyWebhookRetry({ httpStatus: response.statusCode });
  } catch (error) {
    classification = getFailureClassificationFromError(error);

    if (error instanceof WebhookSafeHttpError) {
      response = {
        statusCode: null,
        responseTimeMs: 0,
        truncated: false,
      };
    }
  }

  const completedAt = options.now ?? new Date();
  const finalized = await client.$transaction(async tx =>
    finalizeClaimedDelivery(tx, claimed, leaseToken, classification, response, completedAt, random),
  );

  if (!finalized) {
    return { processed: false, status: "skipped" as const };
  }

  return {
    processed: true,
    status: finalized.status,
    classification,
    deliveryId: finalized.id,
    attemptCount: finalized.attemptCount,
  } as const;
}

export async function processWebhookDeliveryBatch(
  options: WebhookDeliveryWorkerOptions = {},
): Promise<WebhookDeliveryWorkerResult> {
  const client = getDb(options.client);
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.floor(options.limit ?? 10));

  const candidates = await client.webhookDelivery.findMany({
    where: {
      status: {
        in: ["pending", "failed_retryable"],
      },
      AND: [
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
      ],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: {
      id: true,
      attemptCount: true,
      maxAttempts: true,
    },
  });

  const result: WebhookDeliveryWorkerResult = {
    processed: 0,
    delivered: 0,
    retryable: 0,
    terminal: 0,
    skipped: 0,
  };

  for (const candidate of candidates) {
    if (candidate.attemptCount >= candidate.maxAttempts) {
      result.skipped += 1;
      continue;
    }

    const processed = await processWebhookDeliveryById(candidate.id, {
      ...options,
      client,
      now,
    });

    if (!processed.processed) {
      result.skipped += 1;
      continue;
    }

    result.processed += 1;
    if (processed.status === "delivered") {
      result.delivered += 1;
    } else if (processed.status === "failed_retryable") {
      result.retryable += 1;
    } else if (processed.status === "failed_terminal") {
      result.terminal += 1;
    } else {
      result.skipped += 1;
    }
  }

  return result;
}

export async function getWebhookDeliveryQueueStats(
  options: Pick<WebhookDeliveryWorkerOptions, "client" | "now"> = {},
): Promise<WebhookDeliveryQueueStats> {
  const client = getDb(options.client);
  const now = options.now ?? new Date();

  const [pending, dispatching, delivered, failedRetryable, failedTerminal, canceled, oldestPending] = await Promise.all([
    client.webhookDelivery.count({ where: { status: "pending" } }),
    client.webhookDelivery.count({ where: { status: "dispatching" } }),
    client.webhookDelivery.count({ where: { status: "delivered" } }),
    client.webhookDelivery.count({ where: { status: "failed_retryable" } }),
    client.webhookDelivery.count({ where: { status: "failed_terminal" } }),
    client.webhookDelivery.count({ where: { status: "canceled" } }),
    client.webhookDelivery.findFirst({
      where: { status: { in: ["pending", "failed_retryable"] } },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      select: { createdAt: true },
    }),
  ]);

  return {
    pending,
    dispatching,
    delivered,
    failedRetryable,
    failedTerminal,
    canceled,
    oldestPendingAgeMs: oldestPending ? Math.max(0, now.getTime() - oldestPending.createdAt.getTime()) : null,
  };
}