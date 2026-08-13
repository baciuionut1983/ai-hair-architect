import Stripe from "stripe";

export interface CreateBillingPortalSessionInput {
  customerId: string;
  returnUrl: string;
}

export interface StripeBillingPortalSessionResult {
  url: string | null;
}

/**
 * Minimal Stripe seam the portal flow depends on, instead of the full SDK
 * surface -- mirrors the StripeCheckoutClient precedent in
 * billing-checkout-adapter.ts, keeping callers testable with a plain mock
 * and guaranteeing zero live Stripe calls in tests.
 */
export interface StripeBillingPortalClient {
  billingPortal: {
    sessions: {
      create(params: { customer: string; return_url: string }): Promise<StripeBillingPortalSessionResult>;
    };
  };
}

export interface BillingPortalSessionResult {
  url: string;
}

export interface BillingPortalAdapter {
  createPortalSession(input: CreateBillingPortalSessionInput): Promise<BillingPortalSessionResult>;
}

export class BillingPortalAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingPortalAdapterError";
  }
}

export function createBillingPortalAdapter(
  secretKey: string,
  client: StripeBillingPortalClient = new Stripe(secretKey),
): BillingPortalAdapter {
  return {
    async createPortalSession(input) {
      const session = await client.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });

      if (!session.url) {
        throw new BillingPortalAdapterError("Stripe did not return a Billing Portal Session URL.");
      }
      return { url: session.url };
    },
  };
}
