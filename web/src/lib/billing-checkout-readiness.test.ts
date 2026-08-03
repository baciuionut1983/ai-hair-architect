import { describe, expect, it } from "vitest";

import { evaluateCheckoutReadiness } from "./billing-checkout-readiness";

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BILLING_PROCESSING_MODE: "enabled",
    STRIPE_SECRET_KEY: "sk_test_secret",
    STRIPE_PRICE_PRO: "price_pro_123",
    STRIPE_PRICE_SALON: "price_salon_123",
    STRIPE_PRICE_BUSINESS: "price_business_123",
    APP_BASE_URL: "https://app.example.com",
    ...overrides,
  };
}

describe("evaluateCheckoutReadiness", () => {
  it("is disabled when BILLING_PROCESSING_MODE is unset", () => {
    const env = baseEnv({ BILLING_PROCESSING_MODE: undefined });
    expect(evaluateCheckoutReadiness(env)).toEqual({
      status: "disabled",
      message: 'Stripe Checkout is not enabled (BILLING_PROCESSING_MODE is not "enabled").',
    });
  });

  it("is disabled when BILLING_PROCESSING_MODE is webhook_only", () => {
    const env = baseEnv({ BILLING_PROCESSING_MODE: "webhook_only" });
    expect(evaluateCheckoutReadiness(env).status).toBe("disabled");
  });

  it("is invalid when STRIPE_SECRET_KEY is missing, surfacing the variable name only", () => {
    const env = baseEnv({ STRIPE_SECRET_KEY: undefined });
    const result = evaluateCheckoutReadiness(env);
    expect(result.status).toBe("invalid");
    expect(result.issues).toEqual([
      { code: "STRIPE_SECRET_KEY_REQUIRED", variable: "STRIPE_SECRET_KEY", message: "STRIPE_SECRET_KEY is required when BILLING_PROCESSING_MODE is enabled." },
    ]);
  });

  it("is invalid when a price id is missing", () => {
    const env = baseEnv({ STRIPE_PRICE_SALON: undefined });
    const result = evaluateCheckoutReadiness(env);
    expect(result.status).toBe("invalid");
    expect(result.issues?.[0]).toMatchObject({ variable: "STRIPE_PRICE_SALON" });
  });

  it("is invalid when APP_BASE_URL is missing", () => {
    const env = baseEnv({ APP_BASE_URL: undefined });
    const result = evaluateCheckoutReadiness(env);
    expect(result.status).toBe("invalid");
    expect(result.issues).toEqual([
      { code: "APP_BASE_URL_REQUIRED", variable: "APP_BASE_URL", message: "APP_BASE_URL is required when BILLING_PROCESSING_MODE is enabled." },
    ]);
  });

  it("never leaks the actual secret key value in an invalid result", () => {
    const env = baseEnv({ STRIPE_SECRET_KEY: undefined, STRIPE_PRICE_PRO: "super-secret-should-not-leak" });
    const result = evaluateCheckoutReadiness(env);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("super-secret-should-not-leak");
  });

  it("is ready when every required value is present", () => {
    const env = baseEnv();
    expect(evaluateCheckoutReadiness(env)).toEqual({
      status: "ready",
      message: "Stripe Checkout is ready.",
    });
  });
});
