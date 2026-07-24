import { describe, expect, it } from "vitest";

import {
  evaluateReadiness,
  getBillingWebhookProductionError,
  isProductionRuntime,
  PRODUCTION_POLICY_ERROR_CODES,
} from "@/lib/production-guards";

describe("production guards", () => {
  it("detects production runtime mode", () => {
    expect(isProductionRuntime({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionRuntime({ NODE_ENV: "development" })).toBe(false);
  });

  it("blocks billing webhook unconditionally in production", () => {
    const error = getBillingWebhookProductionError({ NODE_ENV: "production" });

    expect(error).toMatchObject({
      code: PRODUCTION_POLICY_ERROR_CODES.BILLING_WEBHOOK_DISABLED,
      httpStatus: 503,
    });
  });

  it("does not block billing webhook in non-production", () => {
    const error = getBillingWebhookProductionError({ NODE_ENV: "test" });
    expect(error).toBeNull();
  });

  it("returns NOT_READY and 503 with known critical blockers", () => {
    const result = evaluateReadiness({
      requestId: "req-1",
      now: new Date("2026-07-24T00:00:00.000Z"),
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://db",
        WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64")
      }
    });

    expect(result.httpStatus).toBe(503);
    expect(result.payload.status).toBe("NOT_READY");
    expect(result.payload.requestId).toBe("req-1");
    expect(result.payload.checks).toHaveLength(4);
    expect(result.payload.checks.filter((check) => check.status === "FAIL").length).toBeGreaterThan(0);
  });
});
