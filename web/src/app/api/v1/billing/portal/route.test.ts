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
  createPortalSession: vi.fn(),
}));
const createBillingPortalAdapterMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing-portal-adapter", () => ({
  createBillingPortalAdapter: createBillingPortalAdapterMock,
}));

const repositoryMock = vi.hoisted(() => ({
  getBillingCustomerByOwner: vi.fn(),
}));
vi.mock("@/lib/billing-repository", () => repositoryMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional" as const, locale: "en" as const };

function buildRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/billing/portal", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  authMock.authenticateSessionRequest.mockReset().mockResolvedValue(OWNER);
  hardeningMock.checkRateLimit.mockReset().mockReturnValue({ allowed: true, remaining: 19 });
  hardeningMock.ensureRequestId.mockReset().mockReturnValue("req-fixed");
  configMock.resolveBillingCheckoutConfig.mockReset().mockReturnValue({
    status: "enabled",
    secretKey: "sk_test_x",
    priceIds: { pro: "price_pro", salon: "price_salon", business: "price_business" },
    appBaseUrl: "https://app.example.com",
  });
  createBillingPortalAdapterMock.mockReset().mockReturnValue(adapterMock);
  adapterMock.createPortalSession.mockReset().mockResolvedValue({ url: "https://billing.stripe.com/session/fake" });
  repositoryMock.getBillingCustomerByOwner.mockReset().mockResolvedValue({
    id: "cust-1",
    ownerUserId: "owner-1",
    provider: "stripe",
    providerCustomerId: "cus_existing",
  });
});

describe("POST /api/v1/billing/portal", () => {
  it("rejects unauthenticated requests with zero Stripe or repository calls", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(buildRequest());

    expect(response.status).toBe(401);
    expect(repositoryMock.getBillingCustomerByOwner).not.toHaveBeenCalled();
    expect(adapterMock.createPortalSession).not.toHaveBeenCalled();
  });

  it("authenticates via the cookie-session resolver, never a request header", async () => {
    await POST(buildRequest());

    expect(authMock.authenticateSessionRequest).toHaveBeenCalledWith();
  });

  it("returns 429 and touches nothing else when the rate limit is exceeded", async () => {
    hardeningMock.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await POST(buildRequest());

    expect(response.status).toBe(429);
    expect(repositoryMock.getBillingCustomerByOwner).not.toHaveBeenCalled();
    expect(adapterMock.createPortalSession).not.toHaveBeenCalled();
  });

  it("returns 503 BILLING_PORTAL_DISABLED when billing configuration is disabled, without touching the repository or Stripe", async () => {
    configMock.resolveBillingCheckoutConfig.mockReturnValue({ status: "disabled" });

    const response = await POST(buildRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "BILLING_PORTAL_DISABLED" });
    expect(repositoryMock.getBillingCustomerByOwner).not.toHaveBeenCalled();
    expect(adapterMock.createPortalSession).not.toHaveBeenCalled();
  });

  it("returns 503 BILLING_PORTAL_MISCONFIGURED when billing configuration is invalid", async () => {
    configMock.resolveBillingCheckoutConfig.mockReturnValue({ status: "invalid", issues: [] });

    const response = await POST(buildRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "BILLING_PORTAL_MISCONFIGURED" });
    expect(adapterMock.createPortalSession).not.toHaveBeenCalled();
  });

  it("returns 404 BILLING_CUSTOMER_NOT_FOUND when the owner has no BillingCustomer row, without ever calling Stripe", async () => {
    repositoryMock.getBillingCustomerByOwner.mockResolvedValue(null);

    const response = await POST(buildRequest());

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: "BILLING_CUSTOMER_NOT_FOUND" });
    expect(createBillingPortalAdapterMock).not.toHaveBeenCalled();
    expect(adapterMock.createPortalSession).not.toHaveBeenCalled();
  });

  it("resolves the Stripe customer id exclusively from the persisted BillingCustomer row for the authenticated owner", async () => {
    await POST(buildRequest());

    expect(repositoryMock.getBillingCustomerByOwner).toHaveBeenCalledWith("owner-1", "stripe");
    expect(adapterMock.createPortalSession).toHaveBeenCalledWith({
      customerId: "cus_existing",
      returnUrl: "https://app.example.com/account",
    });
  });

  it("builds return_url from the configured APP_BASE_URL, pointing back to /account", async () => {
    configMock.resolveBillingCheckoutConfig.mockReturnValue({
      status: "enabled",
      secretKey: "sk_test_x",
      priceIds: {},
      appBaseUrl: "https://different.example.com",
    });

    await POST(buildRequest());

    expect(adapterMock.createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ returnUrl: "https://different.example.com/account" }),
    );
  });

  it("on success, returns 201 with the requestId and the real Stripe portal URL", async () => {
    adapterMock.createPortalSession.mockResolvedValue({ url: "https://billing.stripe.com/session/real_abc" });

    const response = await POST(buildRequest());

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      requestId: "req-fixed",
      portal: { url: "https://billing.stripe.com/session/real_abc" },
    });
  });

  it("returns a controlled 502 error when Stripe portal session creation fails", async () => {
    adapterMock.createPortalSession.mockRejectedValue(new Error("stripe down"));

    const response = await POST(buildRequest());

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: "BILLING_PORTAL_SESSION_FAILED" });
  });

  it("returns a controlled 500 error when an unexpected internal error occurs", async () => {
    repositoryMock.getBillingCustomerByOwner.mockRejectedValue(new Error("db down"));

    const response = await POST(buildRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "BILLING_PORTAL_INTERNAL_ERROR" });
  });

  it("never trusts a client-supplied customer id -- there is no request body read at all", async () => {
    const request = new Request("http://localhost/api/v1/billing/portal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerId: "cus_attacker", ownerUserId: "attacker-owner" }),
    });

    await POST(request);

    expect(adapterMock.createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_existing" }),
    );
  });
});
