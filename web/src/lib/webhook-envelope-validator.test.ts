import { describe, expect, it } from "vitest";

import { createWebhookEventEnvelope, validateWebhookEventEnvelope } from "@/lib/webhook-envelope-validator";

describe("webhook envelope validator", () => {
  it("creates and validates a canonical envelope", () => {
    const envelope = createWebhookEventEnvelope({
      eventType: "image.analysis.ready_for_m8",
      ownerUserId: "user-1",
      resourceType: "analysis",
      resourceId: "analysis-1",
      data: { ready: true },
    });

    const validated = validateWebhookEventEnvelope(envelope);
    expect(validated.eventType).toBe("image.analysis.ready_for_m8");
    expect(validated.meta.dispatchEligible).toBe(true);
  });

  it("rejects invalid event types", () => {
    expect(() =>
      validateWebhookEventEnvelope({
        schemaVersion: "1.0",
        eventId: "evt-1",
        eventType: "bad.type",
        occurredAt: new Date().toISOString(),
        ownerUserId: "user-1",
        resource: { type: "analysis", id: "a-1" },
        data: {},
        meta: {
          dispatchEligible: true,
          auditOnly: false,
        },
      })
    ).toThrow("eventType is invalid");
  });

  it("rejects contradictory metadata", () => {
    expect(() =>
      validateWebhookEventEnvelope({
        schemaVersion: "1.0",
        eventId: "evt-1",
        eventType: "audit.security.detected",
        occurredAt: new Date().toISOString(),
        ownerUserId: "user-1",
        resource: { type: "audit", id: "a-1" },
        data: {},
        meta: {
          dispatchEligible: true,
          auditOnly: true,
        },
      })
    ).toThrow("metadata does not match catalog");
  });

  it("rejects invalid timestamps", () => {
    expect(() =>
      validateWebhookEventEnvelope({
        schemaVersion: "1.0",
        eventId: "evt-1",
        eventType: "image.analysis.failed",
        occurredAt: "not-a-date",
        ownerUserId: "user-1",
        resource: { type: "analysis", id: "a-1" },
        data: {},
        meta: {
          dispatchEligible: true,
          auditOnly: false,
        },
      })
    ).toThrow("occurredAt must be a valid ISO timestamp");
  });
});