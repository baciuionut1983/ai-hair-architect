import { describe, expect, it } from "vitest";

import {
  getWebhookEventCatalogEntry,
  isWebhookEventType,
  validateWebhookEventCatalogEntry,
  WEBHOOK_EVENT_CATALOG,
} from "@/lib/webhook-event-catalog";

describe("webhook event catalog", () => {
  it("contains the approved M10A event types", () => {
    expect(Object.keys(WEBHOOK_EVENT_CATALOG)).toEqual([
      "image.analysis.ready_for_m8",
      "image.analysis.failed",
      "audit.security.detected",
      "webhook.test.completed",
      "webhook.secret.rotated",
    ]);
  });

  it("marks audit-only events as non-dispatchable", () => {
    const auditSecurity = getWebhookEventCatalogEntry("audit.security.detected");
    expect(auditSecurity.auditOnly).toBe(true);
    expect(auditSecurity.dispatchEligible).toBe(false);
  });

  it("recognizes valid event types", () => {
    expect(isWebhookEventType("image.analysis.ready_for_m8")).toBe(true);
    expect(isWebhookEventType("not.valid")).toBe(false);
  });

  it("rejects contradictory audit-only dispatch settings", () => {
    expect(() =>
      validateWebhookEventCatalogEntry({
        ...getWebhookEventCatalogEntry("webhook.test.completed"),
        dispatchEligible: true,
      })
    ).toThrow("cannot be audit-only and dispatch-eligible");
  });
});