import { describe, expect, it } from "vitest";

import {
  assertNamespacedProducerIdempotencyKey,
  buildDeliveryIdempotencyKey,
  buildProducerIdempotencyKey,
} from "@/lib/webhook-idempotency";

describe("webhook idempotency helpers", () => {
  it("builds namespaced producer idempotency keys", () => {
    expect(
      buildProducerIdempotencyKey({
        producer: "image-analysis",
        operation: "ready-for-m8",
        stableId: "analysis-123",
      })
    ).toBe("image-analysis/ready-for-m8/analysis-123");
  });

  it("rejects non-namespaced producer keys", () => {
    expect(() => assertNamespacedProducerIdempotencyKey("bad-key")).toThrow("must be namespaced");
  });

  it("builds deterministic delivery idempotency keys", () => {
    const one = buildDeliveryIdempotencyKey("endpoint-1", "event-1");
    const two = buildDeliveryIdempotencyKey("endpoint-1", "event-1");
    expect(one).toBe(two);
  });

  it("changes delivery idempotency key when endpoint or event changes", () => {
    const base = buildDeliveryIdempotencyKey("endpoint-1", "event-1");
    expect(buildDeliveryIdempotencyKey("endpoint-2", "event-1")).not.toBe(base);
    expect(buildDeliveryIdempotencyKey("endpoint-1", "event-2")).not.toBe(base);
  });
});