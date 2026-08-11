import Stripe from "stripe";

import type { PaidSubscriptionPlan } from "./billing-checkout-config";

export interface CreateStripeCustomerInput {
  ownerUserId: string;
  email: string;
}

export interface StripeCustomerResult {
  id: string;
}

export interface CreateStripeCheckoutSessionInput {
  customerId: string;
  priceId: string;
  plan: PaidSubscriptionPlan;
  ownerUserId: string;
  successUrl: string;
  cancelUrl: string;
  // M38: bounds how long this session stays payable. When provided, the
  // caller is expected to keep this in lockstep with its own
  // BillingCheckoutLock TTL, so the lock can never be reclaimed while this
  // session might still be paid. Omitted, Stripe defaults to 24 hours.
  expiresAt?: Date;
}

export interface StripeCheckoutSessionResult {
  id: string;
  url: string;
}

/**
 * Minimal Stripe seam the checkout flow depends on, instead of the full SDK
 * surface -- keeps callers testable with a plain mock and guarantees zero
 * live Stripe calls in tests, mirroring the GeminiGenerateContentClient
 * precedent from M18 GO-2.
 */
export interface StripeCheckoutClient {
  customers: {
    create(params: { email?: string; metadata?: Record<string, string> }): Promise<{ id: string }>;
  };
  checkout: {
    sessions: {
      create(params: {
        customer: string;
        client_reference_id: string;
        mode: "subscription";
        line_items: Array<{ price: string; quantity: number }>;
        metadata: Record<string, string>;
        subscription_data: { metadata: Record<string, string> };
        success_url: string;
        cancel_url: string;
        expires_at?: number;
      }): Promise<{ id: string; url: string | null }>;
    };
  };
}

export interface BillingCheckoutAdapter {
  createCustomer(input: CreateStripeCustomerInput): Promise<StripeCustomerResult>;
  createCheckoutSession(input: CreateStripeCheckoutSessionInput): Promise<StripeCheckoutSessionResult>;
}

export class BillingCheckoutAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingCheckoutAdapterError";
  }
}

export function createBillingCheckoutAdapter(
  secretKey: string,
  client: StripeCheckoutClient = new Stripe(secretKey),
): BillingCheckoutAdapter {
  return {
    async createCustomer(input) {
      const customer = await client.customers.create({
        email: input.email,
        metadata: { ownerUserId: input.ownerUserId },
      });
      return { id: customer.id };
    },

    async createCheckoutSession(input) {
      const session = await client.checkout.sessions.create({
        customer: input.customerId,
        client_reference_id: input.ownerUserId,
        mode: "subscription",
        line_items: [{ price: input.priceId, quantity: 1 }],
        metadata: { ownerUserId: input.ownerUserId, plan: input.plan },
        subscription_data: { metadata: { ownerUserId: input.ownerUserId, plan: input.plan } },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: input.expiresAt ? Math.floor(input.expiresAt.getTime() / 1000) : undefined,
      });

      if (!session.url) {
        throw new BillingCheckoutAdapterError("Stripe did not return a Checkout Session URL.");
      }
      return { id: session.id, url: session.url };
    },
  };
}
