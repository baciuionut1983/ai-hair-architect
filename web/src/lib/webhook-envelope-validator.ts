import crypto from "crypto";

import type { WebhookEventEnvelope, WebhookEventType } from "@/lib/contracts";
import { getWebhookEventCatalogEntry, isWebhookEventType } from "@/lib/webhook-event-catalog";

export interface CreateWebhookEnvelopeInput {
  eventType: WebhookEventType;
  ownerUserId: string;
  resourceType: string;
  resourceId: string;
  data?: Record<string, unknown>;
  occurredAt?: string;
  eventId?: string;
  producerIdempotencyKey?: string;
}

export function createWebhookEventEnvelope(input: CreateWebhookEnvelopeInput): WebhookEventEnvelope {
  const entry = getWebhookEventCatalogEntry(input.eventType);

  return validateWebhookEventEnvelope({
    schemaVersion: entry.schemaVersion,
    eventId: input.eventId ?? crypto.randomUUID(),
    eventType: input.eventType,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    ownerUserId: input.ownerUserId,
    resource: {
      type: input.resourceType,
      id: input.resourceId,
    },
    data: input.data ?? {},
    meta: {
      dispatchEligible: entry.dispatchEligible,
      auditOnly: entry.auditOnly,
      sensitivity: entry.sensitivity,
      allowedSubscriberTypes: entry.allowedSubscriberTypes,
      ...(input.producerIdempotencyKey ? { producerIdempotencyKey: input.producerIdempotencyKey } : {}),
    },
  });
}

export function validateWebhookEventEnvelope(input: unknown): WebhookEventEnvelope {
  if (!input || typeof input !== "object") {
    throw new Error("Webhook event envelope must be an object.");
  }

  const candidate = input as Partial<WebhookEventEnvelope>;
  if (!candidate.schemaVersion || candidate.schemaVersion !== "1.0") {
    throw new Error("Webhook event envelope schemaVersion must be '1.0'.");
  }

  if (!candidate.eventId || typeof candidate.eventId !== "string") {
    throw new Error("Webhook event envelope eventId is required.");
  }

  if (!candidate.eventType || typeof candidate.eventType !== "string" || !isWebhookEventType(candidate.eventType)) {
    throw new Error("Webhook event envelope eventType is invalid.");
  }

  if (!candidate.occurredAt || typeof candidate.occurredAt !== "string" || Number.isNaN(Date.parse(candidate.occurredAt))) {
    throw new Error("Webhook event envelope occurredAt must be a valid ISO timestamp.");
  }

  if (!candidate.ownerUserId || typeof candidate.ownerUserId !== "string") {
    throw new Error("Webhook event envelope ownerUserId is required.");
  }

  if (!candidate.resource || typeof candidate.resource !== "object") {
    throw new Error("Webhook event envelope resource is required.");
  }

  if (!candidate.resource.type || !candidate.resource.id) {
    throw new Error("Webhook event envelope resource.type and resource.id are required.");
  }

  if (!candidate.meta || typeof candidate.meta !== "object") {
    throw new Error("Webhook event envelope meta is required.");
  }

  const entry = getWebhookEventCatalogEntry(candidate.eventType);
  if (candidate.meta.auditOnly !== entry.auditOnly || candidate.meta.dispatchEligible !== entry.dispatchEligible) {
    throw new Error(`Webhook event envelope metadata does not match catalog for ${candidate.eventType}.`);
  }

  if (candidate.meta.auditOnly && candidate.meta.dispatchEligible) {
    throw new Error("Webhook event envelope cannot be both auditOnly and dispatchEligible.");
  }

  return {
    schemaVersion: candidate.schemaVersion,
    eventId: candidate.eventId,
    eventType: candidate.eventType,
    occurredAt: candidate.occurredAt,
    ownerUserId: candidate.ownerUserId,
    resource: {
      type: candidate.resource.type,
      id: candidate.resource.id,
    },
    data: (candidate.data ?? {}) as Record<string, unknown>,
    meta: {
      dispatchEligible: candidate.meta.dispatchEligible,
      auditOnly: candidate.meta.auditOnly,
      sensitivity: entry.sensitivity,
      allowedSubscriberTypes: entry.allowedSubscriberTypes,
      ...(candidate.meta.producerIdempotencyKey
        ? { producerIdempotencyKey: candidate.meta.producerIdempotencyKey }
        : {}),
    },
  };
}