import { describe, expect, it, vi } from "vitest";

import {
  BillingCheckoutAdapterError,
  createBillingCheckoutAdapter,
  type StripeCheckoutClient,
} from "./billing-checkout-adapter";

function fakeClient(overrides: Partial<{
  createCustomer: StripeCheckoutClient["customers"]["create"];
  createSession: StripeCheckoutClient["checkout"]["sessions"]["create"];
}> = {}): StripeCheckoutClient {
  return {
    customers: {
      create: overrides.createCustomer ?? vi.fn(async () => ({ id: "cus_fake" })),
    },
    checkout: {
      sessions: {
        create: overrides.createSession ?? vi.fn(async () => ({ id: "cs_fake", url: "https://checkout.stripe.com/fake" })),
      },
    },
  };
}

describe("createBillingCheckoutAdapter", () => {
  it("never constructs a live Stripe client when one is injected", () => {
    const client = fakeClient();
    expect(() => createBillingCheckoutAdapter("sk_test_unused", client)).not.toThrow();
  });

  it("createCustomer delegates to the injected client with email and ownerUserId metadata, returning only the id", async () => {
    const create = vi.fn(async () => ({ id: "cus_123", email: "user@example.com", extraField: "ignored" as never }));
    const adapter = createBillingCheckoutAdapter("sk_test_unused", fakeClient({ createCustomer: create }));

    const result = await adapter.createCustomer({ ownerUserId: "owner-1", email: "user@example.com" });

    expect(create).toHaveBeenCalledWith({ email: "user@example.com", metadata: { ownerUserId: "owner-1" } });
    expect(result).toEqual({ id: "cus_123" });
  });

  it("createCheckoutSession sends subscription mode, exact price/quantity, and matching metadata on both the session and the subscription", async () => {
    const create = vi.fn(async () => ({ id: "cs_123", url: "https://checkout.stripe.com/session/cs_123" }));
    const adapter = createBillingCheckoutAdapter("sk_test_unused", fakeClient({ createSession: create }));

    const result = await adapter.createCheckoutSession({
      customerId: "cus_123",
      priceId: "price_pro_123",
      plan: "pro",
      ownerUserId: "owner-1",
      successUrl: "https://app.example.com/billing/success",
      cancelUrl: "https://app.example.com/billing/cancel",
    });

    expect(create).toHaveBeenCalledWith({
      customer: "cus_123",
      client_reference_id: "owner-1",
      mode: "subscription",
      line_items: [{ price: "price_pro_123", quantity: 1 }],
      metadata: { ownerUserId: "owner-1", plan: "pro" },
      subscription_data: { metadata: { ownerUserId: "owner-1", plan: "pro" } },
      success_url: "https://app.example.com/billing/success",
      cancel_url: "https://app.example.com/billing/cancel",
    });
    expect(result).toEqual({ id: "cs_123", url: "https://checkout.stripe.com/session/cs_123" });
  });

  it("throws a controlled error when Stripe returns no session URL, never a raw undefined", async () => {
    const create = vi.fn(async () => ({ id: "cs_123", url: null }));
    const adapter = createBillingCheckoutAdapter("sk_test_unused", fakeClient({ createSession: create }));

    await expect(
      adapter.createCheckoutSession({
        customerId: "cus_123",
        priceId: "price_pro_123",
        plan: "pro",
        ownerUserId: "owner-1",
        successUrl: "https://app.example.com/billing/success",
        cancelUrl: "https://app.example.com/billing/cancel",
      }),
    ).rejects.toBeInstanceOf(BillingCheckoutAdapterError);
  });
});
