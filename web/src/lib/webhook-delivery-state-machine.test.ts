import { describe, expect, it } from "vitest";

import {
  assertWebhookDeliveryTransition,
  canTransitionWebhookDelivery,
  getLeaseExpiryFailureStatus,
  isWebhookDeliveryTerminal,
} from "@/lib/webhook-delivery-state-machine";

describe("webhook delivery state machine", () => {
  it("allows approved transitions", () => {
    expect(canTransitionWebhookDelivery("pending", "dispatching")).toBe(true);
    expect(canTransitionWebhookDelivery("failed_retryable", "dispatching")).toBe(true);
    expect(canTransitionWebhookDelivery("dispatching", "delivered")).toBe(true);
    expect(canTransitionWebhookDelivery("dispatching", "failed_retryable")).toBe(true);
    expect(canTransitionWebhookDelivery("dispatching", "failed_terminal")).toBe(true);
  });

  it("rejects forbidden transitions", () => {
    expect(canTransitionWebhookDelivery("delivered", "dispatching")).toBe(false);
    expect(() => assertWebhookDeliveryTransition("pending", "delivered")).toThrow("not allowed");
  });

  it("marks terminal states", () => {
    expect(isWebhookDeliveryTerminal("delivered")).toBe(true);
    expect(isWebhookDeliveryTerminal("failed_terminal")).toBe(true);
    expect(isWebhookDeliveryTerminal("canceled")).toBe(true);
    expect(isWebhookDeliveryTerminal("pending")).toBe(false);
  });

  it("uses failed_retryable for lease expiry", () => {
    expect(getLeaseExpiryFailureStatus()).toBe("failed_retryable");
  });
});