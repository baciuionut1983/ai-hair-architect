import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  authenticateBillingSessionOwner: vi.fn(),
}));
vi.mock("@/lib/billing-session-auth", () => authMock);

const repositoryMock = vi.hoisted(() => ({
  getSubscriptionByOwner: vi.fn(),
}));
vi.mock("@/lib/billing-repository", () => repositoryMock);

import { GET } from "./route";

function buildRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/billing/subscription", { headers });
}

function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-row-1",
    ownerUserId: "owner-1",
    billingCustomerId: "cust-1",
    provider: "stripe",
    providerSubscriptionId: "sub_1",
    planKey: "pro",
    status: "active",
    currentPeriodStart: null,
    currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    lastAppliedEventCreatedAt: null,
    lastAppliedEventId: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function authenticateAs(id: string) {
  authMock.authenticateBillingSessionOwner.mockResolvedValue({ id, email: `${id}@example.com`, role: "professional", locale: "en" });
}

beforeEach(() => {
  authMock.authenticateBillingSessionOwner.mockReset();
  repositoryMock.getSubscriptionByOwner.mockReset();
});

describe("GET /api/v1/billing/subscription", () => {
  it("rejects unauthenticated requests without touching the repository", async () => {
    authMock.authenticateBillingSessionOwner.mockResolvedValue(null);

    const response = await GET(buildRequest());

    expect(response.status).toBe(401);
    expect(repositoryMock.getSubscriptionByOwner).not.toHaveBeenCalled();
  });

  it("active status grants entitlementActive: true", async () => {
    authenticateAs("owner-1");
    repositoryMock.getSubscriptionByOwner.mockResolvedValue(subscriptionRow({ status: "active", planKey: "pro" }));

    const response = await GET(buildRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subscription).toMatchObject({
      id: "sub-row-1",
      ownerUserId: "owner-1",
      plan: "pro",
      status: "active",
      entitlementActive: true,
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    });
  });

  it("trialing status grants entitlementActive: true per existing product policy", async () => {
    authenticateAs("owner-1");
    repositoryMock.getSubscriptionByOwner.mockResolvedValue(subscriptionRow({ status: "trialing", planKey: "salon" }));

    const response = await GET(buildRequest());

    const body = await response.json();
    expect(body.subscription).toMatchObject({ plan: "salon", status: "trialing", entitlementActive: true });
  });

  it("past_due keeps the real plan/status visible but entitlementActive is false", async () => {
    authenticateAs("owner-1");
    repositoryMock.getSubscriptionByOwner.mockResolvedValue(subscriptionRow({ status: "past_due", planKey: "pro" }));

    const response = await GET(buildRequest());

    const body = await response.json();
    expect(body.subscription).toMatchObject({ plan: "pro", status: "past_due", entitlementActive: false });
  });

  it("canceled keeps the real plan/status visible but entitlementActive is false", async () => {
    authenticateAs("owner-1");
    repositoryMock.getSubscriptionByOwner.mockResolvedValue(subscriptionRow({ status: "canceled", planKey: "business" }));

    const response = await GET(buildRequest());

    const body = await response.json();
    expect(body.subscription).toMatchObject({ plan: "business", status: "canceled", entitlementActive: false });
  });

  it("incomplete never grants entitlement", async () => {
    authenticateAs("owner-1");
    repositoryMock.getSubscriptionByOwner.mockResolvedValue(subscriptionRow({ status: "incomplete", planKey: "business" }));

    const response = await GET(buildRequest());

    const body = await response.json();
    expect(body.subscription.entitlementActive).toBe(false);
  });

  it.each(["incomplete_expired", "unpaid", "paused"] as const)(
    "%s never grants entitlement",
    async (status) => {
      authenticateAs("owner-1");
      repositoryMock.getSubscriptionByOwner.mockResolvedValue(subscriptionRow({ status, planKey: "pro" }));

      const response = await GET(buildRequest());

      const body = await response.json();
      expect(body.subscription.entitlementActive).toBe(false);
      expect(body.subscription.status).toBe(status);
    },
  );

  it("an unrecognized future status falls closed to entitlementActive: false (allowlist, not a denylist)", async () => {
    authenticateAs("owner-1");
    repositoryMock.getSubscriptionByOwner.mockResolvedValue(subscriptionRow({ status: "some_future_status", planKey: "pro" }));

    const response = await GET(buildRequest());

    const body = await response.json();
    expect(body.subscription.entitlementActive).toBe(false);
  });

  it("responds with the canonical free plan and entitlementActive: false when no subscription row exists", async () => {
    authenticateAs("owner-2");
    repositoryMock.getSubscriptionByOwner.mockResolvedValue(null);

    const response = await GET(buildRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subscription).toMatchObject({
      ownerUserId: "owner-2",
      plan: "free",
      status: "inactive",
      entitlementActive: false,
    });
  });

  it("falls back to free when the stored planKey is not a recognized paid plan", async () => {
    authenticateAs("owner-5");
    repositoryMock.getSubscriptionByOwner.mockResolvedValue(subscriptionRow({ status: "active", planKey: "unknown" }));

    const response = await GET(buildRequest());

    const body = await response.json();
    expect(body.subscription).toMatchObject({ plan: "free", status: "inactive", entitlementActive: false });
  });

  it("isolates owners: each authenticated caller only ever sees their own subscription lookup", async () => {
    authenticateAs("owner-a");
    repositoryMock.getSubscriptionByOwner.mockResolvedValueOnce(subscriptionRow({ ownerUserId: "owner-a", planKey: "pro", status: "active" }));
    const responseA = await GET(buildRequest());
    const bodyA = await responseA.json();

    authenticateAs("owner-b");
    repositoryMock.getSubscriptionByOwner.mockResolvedValueOnce(null);
    const responseB = await GET(buildRequest());
    const bodyB = await responseB.json();

    expect(bodyA.subscription.ownerUserId).toBe("owner-a");
    expect(bodyA.subscription.entitlementActive).toBe(true);
    expect(bodyB.subscription.ownerUserId).toBe("owner-b");
    expect(bodyB.subscription.entitlementActive).toBe(false);
    expect(repositoryMock.getSubscriptionByOwner).toHaveBeenNthCalledWith(1, "owner-a", "stripe");
    expect(repositoryMock.getSubscriptionByOwner).toHaveBeenNthCalledWith(2, "owner-b", "stripe");
  });

  it("returns a controlled 500 when the repository lookup fails unexpectedly", async () => {
    authenticateAs("owner-6");
    repositoryMock.getSubscriptionByOwner.mockRejectedValue(new Error("db down"));

    const response = await GET(buildRequest());

    expect(response.status).toBe(500);
  });
});
