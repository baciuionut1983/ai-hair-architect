import { describe, expect, it } from "vitest";

import {
  buildBusinessPersistenceCheck,
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

  it("returns NOT_READY and 503 with known critical blockers", async () => {
    const result = await evaluateReadiness({
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
    expect(result.payload.checks).toHaveLength(5);
    expect(result.payload.checks.filter((check) => check.status === "FAIL").length).toBeGreaterThan(0);
    expect(result.payload.businessPersistenceDomains).toEqual([
      {
        domain: "clients",
        persistenceState: "durable",
        guardEnforcement: "active",
        availability: "available",
        productionReady: true,
      },
      {
        domain: "consultations",
        persistenceState: "durable",
        guardEnforcement: "active",
        availability: "available",
        productionReady: true,
      },
      {
        domain: "analyses",
        persistenceState: "durable",
        guardEnforcement: "active",
        availability: "available",
        productionReady: true,
      },
      {
        domain: "appointments",
        persistenceState: "durable",
        guardEnforcement: "active",
        availability: "available",
        productionReady: true,
      },
      {
        domain: "notifications",
        persistenceState: "durable",
        guardEnforcement: "active",
        availability: "available",
        productionReady: true,
      },
    ]);
    expect(
      result.payload.checks.find((check) => check.code === "BUSINESS_PERSISTENCE_PRODUCTION_READY"),
    ).toMatchObject({
      status: "PASS",
      message: "All essential business persistence domains are durable and production-ready.",
    });
  });

  it("derives PASS only when every essential registry domain is durable and production-ready", () => {
    const domains = [
      "clients",
      "consultations",
      "analyses",
      "appointments",
      "notifications",
    ].map((domain) => ({
      domain: domain as "clients" | "consultations" | "analyses" | "appointments" | "notifications",
      persistenceState: "durable" as const,
      guardEnforcement: "active" as const,
      availability: "available" as const,
      productionReady: true,
    }));

    expect(buildBusinessPersistenceCheck(domains)).toEqual({
      code: "BUSINESS_PERSISTENCE_PRODUCTION_READY",
      status: "PASS",
      critical: true,
      message: "All essential business persistence domains are durable and production-ready.",
    });
  });

  it("derives FAIL for durable domains that are not production-ready", () => {
    const domains = [
      {
        domain: "appointments" as const,
        persistenceState: "durable" as const,
        guardEnforcement: "active" as const,
        availability: "blocked" as const,
        productionReady: false,
      },
    ];

    expect(buildBusinessPersistenceCheck(domains)).toMatchObject({
      status: "FAIL",
      message: expect.stringContaining("appointments (durable, productionReady=false)"),
    });
  });

  it("surfaces BILLING_WEBHOOK_AUTHENTICITY_READY as FAIL when billing processing mode is unset, without affecting other checks", async () => {
    const result = await evaluateReadiness({
      requestId: "req-billing-1",
      env: { NODE_ENV: "test" },
    });

    expect(result.payload.checks.find((check) => check.code === "BILLING_WEBHOOK_AUTHENTICITY_READY")).toMatchObject({
      status: "FAIL",
      message: "Billing webhook processing is not enabled.",
    });
    expect(result.payload.checks).toHaveLength(5);
  });

  it("surfaces BILLING_CHECKOUT_READY as FAIL when checkout is not enabled, without affecting the webhook check", async () => {
    const result = await evaluateReadiness({
      requestId: "req-checkout-1",
      env: { NODE_ENV: "test" },
    });

    expect(result.payload.checks.find((check) => check.code === "BILLING_CHECKOUT_READY")).toMatchObject({
      status: "FAIL",
      message: 'Stripe Checkout is not enabled (BILLING_PROCESSING_MODE is not "enabled").',
    });
    expect(result.payload.checks).toHaveLength(5);
  });

  it("surfaces BILLING_CHECKOUT_READY as FAIL with issue detail when enabled but misconfigured", async () => {
    const result = await evaluateReadiness({
      requestId: "req-checkout-2",
      env: { NODE_ENV: "test", BILLING_PROCESSING_MODE: "enabled" },
    });

    const check = result.payload.checks.find((check) => check.code === "BILLING_CHECKOUT_READY");
    expect(check).toMatchObject({ status: "FAIL" });
    expect(check?.message).toContain("issue(s)");
  });

  it("surfaces BILLING_CHECKOUT_READY as PASS when checkout configuration is fully valid", async () => {
    const result = await evaluateReadiness({
      requestId: "req-checkout-3",
      env: {
        NODE_ENV: "test",
        BILLING_PROCESSING_MODE: "enabled",
        STRIPE_SECRET_KEY: "sk_test_secret",
        STRIPE_PRICE_PRO: "price_pro",
        STRIPE_PRICE_SALON: "price_salon",
        STRIPE_PRICE_BUSINESS: "price_business",
        APP_BASE_URL: "https://app.example.com",
      },
    });

    expect(result.payload.checks.find((check) => check.code === "BILLING_CHECKOUT_READY")).toMatchObject({
      status: "PASS",
      message: "Stripe Checkout is ready.",
    });
  });

  const billingReadySuite = process.env.TEST_DATABASE_URL ? it : it.skip;

  billingReadySuite(
    "surfaces BILLING_WEBHOOK_AUTHENTICITY_READY as PASS when billing configuration is fully valid (real Postgres)",
    async () => {
      const result = await evaluateReadiness({
        requestId: "req-billing-2",
        env: {
          NODE_ENV: "test",
          BILLING_PROCESSING_MODE: "webhook_only",
          STRIPE_SECRET_KEY: `sk_test_${"a".repeat(24)}`,
          STRIPE_WEBHOOK_SECRET: `whsec_${"b".repeat(24)}`,
        },
      });

      expect(
        result.payload.checks.find((check) => check.code === "BILLING_WEBHOOK_AUTHENTICITY_READY"),
      ).toMatchObject({ status: "PASS", message: "Billing webhook processing is ready." });
    },
  );

  it.each(["development", "test"] as const)(
    "reports bypassed domain readiness in %s",
    async (runtime) => {
      const result = await evaluateReadiness({
        requestId: `req-${runtime}`,
        env: { NODE_ENV: runtime },
      });

      expect(result.httpStatus).toBe(503);
      expect(result.payload.status).toBe("NOT_READY");
      expect(result.payload.businessPersistenceDomains).toHaveLength(5);
      const clients = result.payload.businessPersistenceDomains.find((domain) => domain.domain === "clients");
      expect(clients).toMatchObject({
        persistenceState: "durable",
        guardEnforcement: "bypassed",
        availability: "available",
        productionReady: true,
      });
      expect(result.payload.businessPersistenceDomains.find((domain) => domain.domain === "consultations"))
        .toMatchObject({
          persistenceState: "durable",
          guardEnforcement: "bypassed",
          availability: "available",
          productionReady: true,
        });
      expect(result.payload.businessPersistenceDomains.find((domain) => domain.domain === "analyses"))
        .toMatchObject({
          persistenceState: "durable",
          guardEnforcement: "bypassed",
          availability: "available",
          productionReady: true,
        });
      expect(result.payload.businessPersistenceDomains.find((domain) => domain.domain === "appointments"))
        .toMatchObject({
          persistenceState: "durable",
          guardEnforcement: "bypassed",
          availability: "available",
          productionReady: true,
        });
      expect(result.payload.businessPersistenceDomains.find((domain) => domain.domain === "notifications"))
        .toMatchObject({
          persistenceState: "durable",
          guardEnforcement: "bypassed",
          availability: "available",
          productionReady: true,
        });
    },
  );
});
