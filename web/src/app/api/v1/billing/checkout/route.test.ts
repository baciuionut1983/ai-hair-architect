import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  authenticateSessionRequest: vi.fn(),
}));
vi.mock("@/lib/session-request-auth", () => authMock);

const hardeningMock = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  ensureRequestId: vi.fn(),
}));
vi.mock("@/lib/hardening", () => hardeningMock);

const configMock = vi.hoisted(() => ({
  resolveBillingCheckoutConfig: vi.fn(),
}));
vi.mock("@/lib/billing-checkout-config", () => configMock);

const adapterMock = vi.hoisted(() => ({
  createCustomer: vi.fn(),
  createCheckoutSession: vi.fn(),
}));
const createBillingCheckoutAdapterMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing-checkout-adapter", () => ({
  createBillingCheckoutAdapter: createBillingCheckoutAdapterMock,
}));

const repositoryMock = vi.hoisted(() => ({
  getBillingCustomerByOwner: vi.fn(),
  findOrCreateBillingCustomer: vi.fn(),
}));
vi.mock("@/lib/billing-repository", () => repositoryMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional" as const, locale: "en" as const };

function buildRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authMock.authenticateSessionRequest.mockReset().mockResolvedValue(OWNER);
  hardeningMock.checkRateLimit.mockReset().mockReturnValue({ allowed: true, retryAfter: 0 });
  hardeningMock.ensureRequestId.mockReset().mockReturnValue("req-fixed");
  configMock.resolveBillingCheckoutConfig.mockReset().mockReturnValue({
    status: "enabled",
    secretKey: "sk_test_x",
    priceIds: { pro: "price_pro", salon: "price_salon", business: "price_business" },
    appBaseUrl: "https://app.example.com",
  });
  createBillingCheckoutAdapterMock.mockReset().mockReturnValue(adapterMock);
  adapterMock.createCustomer.mockReset().mockResolvedValue({ id: "cus_created" });
  adapterMock.createCheckoutSession.mockReset().mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" });
  repositoryMock.getBillingCustomerByOwner.mockReset().mockResolvedValue(null);
  repositoryMock.findOrCreateBillingCustomer.mockReset().mockResolvedValue({ id: "cust-1", providerCustomerId: "cus_created" });
});

describe("POST /api/v1/billing/checkout", () => {
  it("rejects unauthenticated requests (no aha_session cookie resolved) with zero Stripe or repository calls", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(buildRequest({ plan: "pro" }));

    expect(response.status).toBe(401);
    expect(adapterMock.createCustomer).not.toHaveBeenCalled();
    expect(adapterMock.createCheckoutSession).not.toHaveBeenCalled();
    expect(repositoryMock.getBillingCustomerByOwner).not.toHaveBeenCalled();
    expect(repositoryMock.findOrCreateBillingCustomer).not.toHaveBeenCalled();
  });

  it("authenticates via the cookie-session resolver, never a request header", async () => {
    await POST(buildRequest({ plan: "pro" }));

    expect(authMock.authenticateSessionRequest).toHaveBeenCalledWith();
  });

  it("returns 429 and touches nothing else when the rate limit is exceeded", async () => {
    hardeningMock.checkRateLimit.mockReturnValue({ allowed: false, retryAfter: 5 });

    const response = await POST(buildRequest({ plan: "pro" }));

    expect(response.status).toBe(429);
    expect(adapterMock.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects an invalid plan value", async () => {
    const response = await POST(buildRequest({ plan: "enterprise" }));
    expect(response.status).toBe(400);
  });

  it.each(["pro", "salon", "business"] as const)(
    "processes the paid happy path for plan=%s, creating a new Stripe customer and a real checkout session",
    async (plan) => {
      const response = await POST(buildRequest({ plan }));

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).toEqual({
        requestId: "req-fixed",
        checkout: { provider: "stripe", url: "https://checkout.stripe.com/cs_1" },
      });
      expect(adapterMock.createCustomer).toHaveBeenCalledWith({ ownerUserId: "owner-1", email: "owner@example.com" });
      expect(repositoryMock.findOrCreateBillingCustomer).toHaveBeenCalledWith({
        ownerUserId: "owner-1",
        provider: "stripe",
        providerCustomerId: "cus_created",
      });
      expect(adapterMock.createCheckoutSession).toHaveBeenCalledWith({
        customerId: "cus_created",
        priceId: { pro: "price_pro", salon: "price_salon", business: "price_business" }[plan],
        plan,
        ownerUserId: "owner-1",
        successUrl: "https://app.example.com/account?checkout=success",
        cancelUrl: "https://app.example.com/account?checkout=cancel",
      });
    },
  );

  it("Pro selects exactly STRIPE_PRICE_PRO's configured value, never Salon's or Business's", async () => {
    await POST(buildRequest({ plan: "pro" }));

    expect(adapterMock.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: "price_pro" }),
    );
  });

  it("Salon selects exactly STRIPE_PRICE_SALON's configured value, never Pro's or Business's", async () => {
    await POST(buildRequest({ plan: "salon" }));

    expect(adapterMock.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: "price_salon" }),
    );
  });

  it("Business missing from priceIds does not block Pro from checking out", async () => {
    configMock.resolveBillingCheckoutConfig.mockReturnValue({
      status: "enabled",
      secretKey: "sk_test_x",
      priceIds: { pro: "price_pro", salon: "price_salon" }, // no business
      appBaseUrl: "https://app.example.com",
    });

    const response = await POST(buildRequest({ plan: "pro" }));

    expect(response.status).toBe(201);
    expect(adapterMock.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: "price_pro" }),
    );
  });

  it("Business missing from priceIds does not block Salon from checking out", async () => {
    configMock.resolveBillingCheckoutConfig.mockReturnValue({
      status: "enabled",
      secretKey: "sk_test_x",
      priceIds: { pro: "price_pro", salon: "price_salon" }, // no business
      appBaseUrl: "https://app.example.com",
    });

    const response = await POST(buildRequest({ plan: "salon" }));

    expect(response.status).toBe(201);
    expect(adapterMock.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: "price_salon" }),
    );
  });

  it("Business checkout fails closed with 503 when STRIPE_PRICE_BUSINESS is not configured, without ever calling Stripe", async () => {
    configMock.resolveBillingCheckoutConfig.mockReturnValue({
      status: "enabled",
      secretKey: "sk_test_x",
      priceIds: { pro: "price_pro", salon: "price_salon" }, // no business
      appBaseUrl: "https://app.example.com",
    });

    const response = await POST(buildRequest({ plan: "business" }));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("BILLING_CHECKOUT_PLAN_UNAVAILABLE");
    expect(adapterMock.createCustomer).not.toHaveBeenCalled();
    expect(adapterMock.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("never calls Stripe for the free plan and returns the canonical free subscription", async () => {
    const response = await POST(buildRequest({ plan: "free" }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.checkout).toEqual({ provider: "none" });
    expect(body.subscription).toMatchObject({
      ownerUserId: "owner-1",
      plan: "free",
      status: "inactive",
      entitlementActive: false,
    });
    expect(configMock.resolveBillingCheckoutConfig).not.toHaveBeenCalled();
    expect(adapterMock.createCustomer).not.toHaveBeenCalled();
    expect(adapterMock.createCheckoutSession).not.toHaveBeenCalled();
    expect(repositoryMock.getBillingCustomerByOwner).not.toHaveBeenCalled();
  });

  it("returns 503 when checkout configuration is disabled", async () => {
    configMock.resolveBillingCheckoutConfig.mockReturnValue({ status: "disabled" });

    const response = await POST(buildRequest({ plan: "pro" }));

    expect(response.status).toBe(503);
    expect(adapterMock.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns 503 when checkout configuration is invalid", async () => {
    configMock.resolveBillingCheckoutConfig.mockReturnValue({ status: "invalid", issues: [] });

    const response = await POST(buildRequest({ plan: "pro" }));

    expect(response.status).toBe(503);
    expect(adapterMock.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("reuses an existing BillingCustomer instead of creating a new Stripe customer", async () => {
    repositoryMock.getBillingCustomerByOwner.mockResolvedValue({ id: "cust-1", providerCustomerId: "cus_existing" });

    const response = await POST(buildRequest({ plan: "pro" }));

    expect(response.status).toBe(201);
    expect(adapterMock.createCustomer).not.toHaveBeenCalled();
    expect(repositoryMock.findOrCreateBillingCustomer).not.toHaveBeenCalled();
    expect(adapterMock.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_existing" }),
    );
  });

  it("returns a controlled error when Stripe customer creation fails", async () => {
    adapterMock.createCustomer.mockRejectedValue(new Error("stripe down"));

    const response = await POST(buildRequest({ plan: "pro" }));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe("BILLING_CHECKOUT_CUSTOMER_FAILED");
    expect(adapterMock.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns a controlled error when Stripe checkout session creation fails", async () => {
    adapterMock.createCheckoutSession.mockRejectedValue(new Error("stripe down"));

    const response = await POST(buildRequest({ plan: "pro" }));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe("BILLING_CHECKOUT_SESSION_FAILED");
  });

  it("ignores every client-supplied identity, provider, price id, and redirect field -- an arbitrary Stripe price id from the browser can never be used", async () => {
    const response = await POST(
      buildRequest({
        plan: "pro",
        ownerUserId: "attacker-owner",
        stripeCustomerId: "cus_attacker",
        stripeSessionId: "cs_attacker",
        priceId: "price_attacker",
        successUrl: "https://evil.example.com/success",
        cancelUrl: "https://evil.example.com/cancel",
        status: "active",
      }),
    );

    expect(response.status).toBe(201);
    expect(adapterMock.createCustomer).toHaveBeenCalledWith({ ownerUserId: "owner-1", email: "owner@example.com" });
    expect(adapterMock.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        priceId: "price_pro",
        successUrl: "https://app.example.com/account?checkout=success",
        cancelUrl: "https://app.example.com/account?checkout=cancel",
      }),
    );
  });
});
