import { describe, expect, it } from "vitest";

import {
  isPaidSubscriptionPlan,
  resolveBillingCheckoutConfig,
} from "./billing-checkout-config";

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

describe("resolveBillingCheckoutConfig", () => {
  it("is disabled when BILLING_PROCESSING_MODE is unset, even with all Stripe values present", () => {
    const env = baseEnv({ BILLING_PROCESSING_MODE: undefined });
    expect(resolveBillingCheckoutConfig(env)).toEqual({ status: "disabled" });
  });

  it("is disabled when BILLING_PROCESSING_MODE is explicitly disabled", () => {
    const env = baseEnv({ BILLING_PROCESSING_MODE: "disabled" });
    expect(resolveBillingCheckoutConfig(env)).toEqual({ status: "disabled" });
  });

  it("is disabled when BILLING_PROCESSING_MODE is webhook_only, even with all Stripe values present -- checkout requires the stronger enabled mode", () => {
    const env = baseEnv({ BILLING_PROCESSING_MODE: "webhook_only" });
    expect(resolveBillingCheckoutConfig(env)).toEqual({ status: "disabled" });
  });

  it("is invalid when enabled but STRIPE_SECRET_KEY is missing", () => {
    const env = baseEnv({ STRIPE_SECRET_KEY: undefined });
    const result = resolveBillingCheckoutConfig(env);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues).toEqual([
        { code: "STRIPE_SECRET_KEY_REQUIRED", variable: "STRIPE_SECRET_KEY", message: "STRIPE_SECRET_KEY is required when BILLING_PROCESSING_MODE is enabled." },
      ]);
    }
  });

  it("treats whitespace-only values as missing, not as configured", () => {
    const env = baseEnv({ STRIPE_SECRET_KEY: "   " });
    expect(resolveBillingCheckoutConfig(env).status).toBe("invalid");
  });

  it("resolves to enabled with trimmed values when fully configured (all three plans)", () => {
    const env = baseEnv({
      STRIPE_SECRET_KEY: "  sk_test_secret  ",
      STRIPE_PRICE_PRO: "  price_pro_123  ",
      APP_BASE_URL: "  https://app.example.com  ",
    });
    expect(resolveBillingCheckoutConfig(env)).toEqual({
      status: "enabled",
      secretKey: "sk_test_secret",
      priceIds: { pro: "price_pro_123", salon: "price_salon_123", business: "price_business_123" },
      appBaseUrl: "https://app.example.com",
    });
  });

  it("is invalid when enabled but APP_BASE_URL is missing", () => {
    const env = baseEnv({ APP_BASE_URL: undefined });
    const result = resolveBillingCheckoutConfig(env);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues).toEqual([
        { code: "APP_BASE_URL_REQUIRED", variable: "APP_BASE_URL", message: "APP_BASE_URL is required when BILLING_PROCESSING_MODE is enabled." },
      ]);
    }
  });

  it("treats a whitespace-only APP_BASE_URL as missing", () => {
    const env = baseEnv({ APP_BASE_URL: "   " });
    expect(resolveBillingCheckoutConfig(env).status).toBe("invalid");
  });

  it("collects the APP_BASE_URL issue alongside other missing values", () => {
    const env = baseEnv({ STRIPE_SECRET_KEY: undefined, APP_BASE_URL: undefined });
    const result = resolveBillingCheckoutConfig(env);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues.map((i) => i.variable)).toEqual(["STRIPE_SECRET_KEY", "APP_BASE_URL"]);
    }
  });

  describe("per-plan price id availability (Business has no Stripe product yet)", () => {
    it("stays enabled with only Pro and Salon in priceIds when STRIPE_PRICE_BUSINESS is missing -- Business absence never blocks the others", () => {
      const env = baseEnv({ STRIPE_PRICE_BUSINESS: undefined });

      const result = resolveBillingCheckoutConfig(env);

      expect(result).toEqual({
        status: "enabled",
        secretKey: "sk_test_secret",
        priceIds: { pro: "price_pro_123", salon: "price_salon_123" },
        appBaseUrl: "https://app.example.com",
      });
    });

    it("stays enabled with only Pro in priceIds when both Salon and Business are missing", () => {
      const env = baseEnv({ STRIPE_PRICE_SALON: undefined, STRIPE_PRICE_BUSINESS: undefined });

      const result = resolveBillingCheckoutConfig(env);

      expect(result).toEqual({
        status: "enabled",
        secretKey: "sk_test_secret",
        priceIds: { pro: "price_pro_123" },
        appBaseUrl: "https://app.example.com",
      });
    });

    it("treats a whitespace-only price id as absent from priceIds, not as configured", () => {
      const env = baseEnv({ STRIPE_PRICE_BUSINESS: "   " });

      const result = resolveBillingCheckoutConfig(env);

      expect(result.status).toBe("enabled");
      if (result.status === "enabled") {
        expect(result.priceIds.business).toBeUndefined();
        expect(result.priceIds.pro).toBe("price_pro_123");
        expect(result.priceIds.salon).toBe("price_salon_123");
      }
    });

    it("stays enabled with an empty priceIds map when no plan price is configured at all -- STRIPE_SECRET_KEY/APP_BASE_URL are the only hard requirements", () => {
      const env = baseEnv({ STRIPE_PRICE_PRO: undefined, STRIPE_PRICE_SALON: undefined, STRIPE_PRICE_BUSINESS: undefined });

      const result = resolveBillingCheckoutConfig(env);

      expect(result).toEqual({
        status: "enabled",
        secretKey: "sk_test_secret",
        priceIds: {},
        appBaseUrl: "https://app.example.com",
      });
    });
  });
});

describe("isPaidSubscriptionPlan", () => {
  it("accepts exactly pro, salon, and business", () => {
    expect(isPaidSubscriptionPlan("pro")).toBe(true);
    expect(isPaidSubscriptionPlan("salon")).toBe(true);
    expect(isPaidSubscriptionPlan("business")).toBe(true);
  });

  it("rejects free and any unrecognized value", () => {
    expect(isPaidSubscriptionPlan("free")).toBe(false);
    expect(isPaidSubscriptionPlan("enterprise")).toBe(false);
    expect(isPaidSubscriptionPlan("")).toBe(false);
  });
});
