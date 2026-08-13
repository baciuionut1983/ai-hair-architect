import { describe, expect, it, vi } from "vitest";

import {
  BillingPortalAdapterError,
  createBillingPortalAdapter,
  type StripeBillingPortalClient,
} from "./billing-portal-adapter";

function fakeClient(
  createSession?: StripeBillingPortalClient["billingPortal"]["sessions"]["create"],
): StripeBillingPortalClient {
  return {
    billingPortal: {
      sessions: {
        create: createSession ?? vi.fn(async () => ({ url: "https://billing.stripe.com/session/fake" })),
      },
    },
  };
}

describe("createBillingPortalAdapter", () => {
  it("never constructs a live Stripe client when one is injected", () => {
    const client = fakeClient();
    expect(() => createBillingPortalAdapter("sk_test_unused", client)).not.toThrow();
  });

  it("createPortalSession sends exactly the customer id and return_url, returning only the url", async () => {
    const create = vi.fn(async () => ({ url: "https://billing.stripe.com/session/cs_test_123" }));
    const adapter = createBillingPortalAdapter("sk_test_unused", fakeClient(create));

    const result = await adapter.createPortalSession({
      customerId: "cus_123",
      returnUrl: "https://app.example.com/account",
    });

    expect(create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://app.example.com/account",
    });
    expect(result).toEqual({ url: "https://billing.stripe.com/session/cs_test_123" });
  });

  it("throws a controlled error when Stripe returns no session URL, never a raw null/undefined", async () => {
    const create = vi.fn(async () => ({ url: null }));
    const adapter = createBillingPortalAdapter("sk_test_unused", fakeClient(create));

    await expect(
      adapter.createPortalSession({ customerId: "cus_123", returnUrl: "https://app.example.com/account" }),
    ).rejects.toBeInstanceOf(BillingPortalAdapterError);
  });
});
