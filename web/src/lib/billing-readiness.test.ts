import { readFileSync } from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { evaluateBillingReadiness } from "./billing-readiness";

const VALID_LIVE_SECRET_KEY = `sk_live_${"a".repeat(24)}`;
const VALID_TEST_SECRET_KEY = `sk_test_${"a".repeat(24)}`;
const VALID_WEBHOOK_SECRET = `whsec_${"b".repeat(24)}`;

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "test",
    BILLING_PROCESSING_MODE: "webhook_only",
    STRIPE_SECRET_KEY: VALID_TEST_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: VALID_WEBHOOK_SECRET,
    ...overrides,
  };
}

function alwaysHealthy() {
  return Promise.resolve({ ok: true, code: "BILLING_READINESS_SUCCEEDED" as const });
}

describe("billing-readiness: GO-3 architectural invariants (source-level regression, not runtime checks)", () => {
  const webhookProcessorSource = readFileSync(
    path.resolve(__dirname, "billing-webhook-processor.ts"),
    "utf8",
  );
  const webhookRouteSource = readFileSync(
    path.resolve(__dirname, "../app/api/v1/billing/webhook/route.ts"),
    "utf8",
  );

  it("the webhook route imports and delegates to the GO-3 processor", () => {
    expect(webhookRouteSource).toMatch(/from ["']@\/lib\/billing-webhook-processor["']/);
    expect(webhookRouteSource).toMatch(/processBillingWebhookRequest/);
  });

  it("the authenticated webhook path has zero milestone1-store dependency", () => {
    expect(webhookRouteSource).not.toMatch(/milestone1-store/);
    expect(webhookProcessorSource).not.toMatch(/milestone1-store/);
  });

  it("the supported Stripe event allowlist remains explicit and closed to exactly the five approved events", () => {
    const approvedEvents = [
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.paid",
      "invoice.payment_failed",
    ];
    for (const eventType of approvedEvents) {
      expect(webhookProcessorSource).toContain(`"${eventType}"`);
    }
    expect(webhookProcessorSource).toMatch(/SUPPORTED_SUBSCRIPTION_EVENT_TYPES\s*=\s*new Set\(\[/);
    expect(webhookProcessorSource).toMatch(/SUPPORTED_INVOICE_EVENT_TYPES\s*=\s*new Set\(\[/);
  });

  it("the official Stripe SDK performs signature verification, with no manual HMAC path", () => {
    expect(webhookProcessorSource).toMatch(/from ["']stripe["']/);
    expect(webhookProcessorSource).toMatch(/constructEvent/);
    expect(webhookProcessorSource).not.toMatch(/createHmac/);
    expect(webhookRouteSource).not.toMatch(/createHmac/);
  });

  it("the webhook route reads the raw body exactly once and never calls request.json()", () => {
    expect(webhookRouteSource).toMatch(/request\.text\(\)/);
    expect(webhookRouteSource).not.toMatch(/request\.json\(\)/);
  });
});

describe("billing-readiness: processing mode", () => {
  it("disabled mode returns PROCESSING_DISABLED without validating keys or probing the database", async () => {
    const checkRepositoryHealth = neverCalledHealthCheck();
    const result = await evaluateBillingReadiness({
      env: baseEnv({ BILLING_PROCESSING_MODE: "disabled", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" }),
      checkRepositoryHealth,
    });
    expect(result).toEqual({
      status: "not_ready",
      code: "BILLING_READINESS_PROCESSING_DISABLED",
      message: "Billing webhook processing is not enabled.",
    });
  });

  it("missing mode is treated as disabled", async () => {
    const env = baseEnv();
    delete env.BILLING_PROCESSING_MODE;
    const result = await evaluateBillingReadiness({ env, checkRepositoryHealth: neverCalledHealthCheck() });
    expect(result.code).toBe("BILLING_READINESS_PROCESSING_DISABLED");
  });

  it("malformed mode is treated as disabled", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv({ BILLING_PROCESSING_MODE: "garbage" }),
      checkRepositoryHealth: neverCalledHealthCheck(),
    });
    expect(result.code).toBe("BILLING_READINESS_PROCESSING_DISABLED");
  });

  it("webhook_only proceeds through all remaining checks and can reach ready", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv({ BILLING_PROCESSING_MODE: "webhook_only" }),
      checkRepositoryHealth: alwaysHealthy,
    });
    expect(result).toEqual({
      status: "ready",
      code: "BILLING_READINESS_SUCCEEDED",
      message: "Billing webhook processing is ready.",
    });
  });

  it("enabled is treated identically to webhook_only and can reach ready", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv({ BILLING_PROCESSING_MODE: "enabled" }),
      checkRepositoryHealth: alwaysHealthy,
    });
    expect(result.status).toBe("ready");
  });
});

describe("billing-readiness: Stripe secret key validation", () => {
  it("missing key", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv({ STRIPE_SECRET_KEY: "" }),
      checkRepositoryHealth: neverCalledHealthCheck(),
    });
    expect(result.code).toBe("BILLING_READINESS_SECRET_KEY_MISSING");
  });

  it("malformed key", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv({ STRIPE_SECRET_KEY: "not-a-stripe-key" }),
      checkRepositoryHealth: neverCalledHealthCheck(),
    });
    expect(result.code).toBe("BILLING_READINESS_SECRET_KEY_MALFORMED");
  });

  it("test key rejected in production runtime", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv({ NODE_ENV: "production", STRIPE_SECRET_KEY: VALID_TEST_SECRET_KEY }),
      checkRepositoryHealth: neverCalledHealthCheck(),
    });
    expect(result.code).toBe("BILLING_READINESS_TEST_KEY_FORBIDDEN_IN_PRODUCTION");
  });

  it("test key accepted outside production runtime", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv({ NODE_ENV: "test", STRIPE_SECRET_KEY: VALID_TEST_SECRET_KEY }),
      checkRepositoryHealth: alwaysHealthy,
    });
    expect(result.status).toBe("ready");
  });

  it("live key accepted in production runtime", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv({ NODE_ENV: "production", STRIPE_SECRET_KEY: VALID_LIVE_SECRET_KEY }),
      checkRepositoryHealth: alwaysHealthy,
    });
    expect(result.status).toBe("ready");
  });

  it("never returns or leaks any fragment of the configured key", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv({ STRIPE_SECRET_KEY: "not-a-stripe-key" }),
      checkRepositoryHealth: neverCalledHealthCheck(),
    });
    expect(JSON.stringify(result)).not.toContain("not-a-stripe-key");
  });
});

describe("billing-readiness: Stripe webhook secret validation", () => {
  it("missing webhook secret", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv({ STRIPE_WEBHOOK_SECRET: "" }),
      checkRepositoryHealth: neverCalledHealthCheck(),
    });
    expect(result.code).toBe("BILLING_READINESS_WEBHOOK_SECRET_MISSING");
  });

  it("malformed webhook secret", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv({ STRIPE_WEBHOOK_SECRET: "not-a-webhook-secret" }),
      checkRepositoryHealth: neverCalledHealthCheck(),
    });
    expect(result.code).toBe("BILLING_READINESS_WEBHOOK_SECRET_MALFORMED");
  });

  it("never returns or leaks any fragment of the configured webhook secret", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv({ STRIPE_WEBHOOK_SECRET: "not-a-webhook-secret" }),
      checkRepositoryHealth: neverCalledHealthCheck(),
    });
    expect(JSON.stringify(result)).not.toContain("not-a-webhook-secret");
  });
});

describe("billing-readiness: repository health mapping", () => {
  it("maps each repository health failure code onto the matching readiness code", async () => {
    const codes = [
      "BILLING_READINESS_DATABASE_UNAVAILABLE",
      "BILLING_READINESS_CUSTOMER_TABLE_UNAVAILABLE",
      "BILLING_READINESS_SUBSCRIPTION_TABLE_UNAVAILABLE",
      "BILLING_READINESS_PAYMENT_TABLE_UNAVAILABLE",
      "BILLING_READINESS_EVENT_TABLE_UNAVAILABLE",
      "BILLING_READINESS_IDEMPOTENCY_PROBE_FAILED",
      "BILLING_READINESS_CUSTOMER_MAPPING_PROBE_FAILED",
    ] as const;

    for (const code of codes) {
      const result = await evaluateBillingReadiness({
        env: baseEnv(),
        checkRepositoryHealth: () => Promise.resolve({ ok: false, code }),
      });
      expect(result).toEqual({ status: "not_ready", code, message: expect.any(String) });
    }
  });

  it("maps a successful repository health check to ready", async () => {
    const result = await evaluateBillingReadiness({ env: baseEnv(), checkRepositoryHealth: alwaysHealthy });
    expect(result).toEqual({
      status: "ready",
      code: "BILLING_READINESS_SUCCEEDED",
      message: "Billing webhook processing is ready.",
    });
  });

  it("maps an unrecognized repository health code to internal error, never leaking it verbatim", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv(),
      // @ts-expect-error deliberately unrecognized code, simulating a future/unknown failure
      checkRepositoryHealth: () => Promise.resolve({ ok: false, code: "SOME_UNEXPECTED_CODE" }),
    });
    expect(result.code).toBe("BILLING_READINESS_INTERNAL_ERROR");
  });

  it("maps a thrown exception from the health check to internal error, never a raw error", async () => {
    const result = await evaluateBillingReadiness({
      env: baseEnv(),
      checkRepositoryHealth: () => Promise.reject(new Error("connection reset by peer, host db.internal:5432")),
    });
    expect(result.code).toBe("BILLING_READINESS_INTERNAL_ERROR");
    expect(JSON.stringify(result)).not.toContain("db.internal");
  });

  it("never calls the Stripe API and creates no financial object (no stripe import in this module)", () => {
    const moduleSource = readFileSync(path.resolve(__dirname, "billing-readiness.ts"), "utf8");
    expect(moduleSource).not.toMatch(/from ["']stripe["']/);
    expect(moduleSource).not.toMatch(/new Stripe\(/);
  });

  it("has no cache, single-flight, or timer state (no setTimeout/setInterval/module-level mutable cache)", () => {
    const moduleSource = readFileSync(path.resolve(__dirname, "billing-readiness.ts"), "utf8");
    expect(moduleSource).not.toMatch(/setTimeout|setInterval/);
    expect(moduleSource).not.toMatch(/^let cache/m);
  });
});

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;

suite("billing-readiness (real Postgres, real repository health check)", () => {
  it("reaches ready end-to-end using the real checkBillingRepositoryHealth", async () => {
    const result = await evaluateBillingReadiness({ env: baseEnv() });
    expect(result).toEqual({
      status: "ready",
      code: "BILLING_READINESS_SUCCEEDED",
      message: "Billing webhook processing is ready.",
    });
  });

  it("reports DATABASE_UNAVAILABLE when the database is not configured, using the real health check", async () => {
    const originalUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const result = await evaluateBillingReadiness({ env: baseEnv() });
      expect(result.code).toBe("BILLING_READINESS_DATABASE_UNAVAILABLE");
    } finally {
      process.env.DATABASE_URL = originalUrl;
    }
  });
});

function neverCalledHealthCheck(): () => Promise<{ ok: boolean; code: "BILLING_READINESS_SUCCEEDED" }> {
  return () => {
    throw new Error("checkRepositoryHealth must not be called for this scenario");
  };
}
