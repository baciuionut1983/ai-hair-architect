import type { WebhookAllowedSubscriberType, WebhookEventCatalogEntry, WebhookEventType } from "@/lib/contracts";

const GENERIC_SUBSCRIBERS: WebhookAllowedSubscriberType[] = ["generic_webhook"];

export const WEBHOOK_EVENT_CATALOG: Record<WebhookEventType, WebhookEventCatalogEntry> = {
  "image.analysis.ready_for_m8": {
    eventType: "image.analysis.ready_for_m8",
    schemaVersion: "1.0",
    dispatchEligible: true,
    auditOnly: false,
    sensitivity: "internal_low",
    allowedSubscriberTypes: GENERIC_SUBSCRIBERS,
  },
  "image.analysis.failed": {
    eventType: "image.analysis.failed",
    schemaVersion: "1.0",
    dispatchEligible: true,
    auditOnly: false,
    sensitivity: "internal_moderate",
    allowedSubscriberTypes: GENERIC_SUBSCRIBERS,
  },
  "audit.security.detected": {
    eventType: "audit.security.detected",
    schemaVersion: "1.0",
    dispatchEligible: false,
    auditOnly: true,
    sensitivity: "internal_high",
    allowedSubscriberTypes: GENERIC_SUBSCRIBERS,
  },
  "webhook.test.completed": {
    eventType: "webhook.test.completed",
    schemaVersion: "1.0",
    dispatchEligible: false,
    auditOnly: true,
    sensitivity: "internal_moderate",
    allowedSubscriberTypes: GENERIC_SUBSCRIBERS,
  },
  "webhook.secret.rotated": {
    eventType: "webhook.secret.rotated",
    schemaVersion: "1.0",
    dispatchEligible: false,
    auditOnly: true,
    sensitivity: "internal_high",
    allowedSubscriberTypes: GENERIC_SUBSCRIBERS,
  },
};

export function getWebhookEventCatalogEntry(eventType: WebhookEventType): WebhookEventCatalogEntry {
  return WEBHOOK_EVENT_CATALOG[eventType];
}

export function isWebhookEventType(value: string): value is WebhookEventType {
  return value in WEBHOOK_EVENT_CATALOG;
}

export function validateWebhookEventCatalogEntry(entry: WebhookEventCatalogEntry): void {
  if (entry.auditOnly && entry.dispatchEligible) {
    throw new Error(`Event ${entry.eventType} cannot be audit-only and dispatch-eligible.`);
  }
}

export function validateWebhookEventCatalog(): void {
  for (const entry of Object.values(WEBHOOK_EVENT_CATALOG)) {
    validateWebhookEventCatalogEntry(entry);
  }
}

validateWebhookEventCatalog();