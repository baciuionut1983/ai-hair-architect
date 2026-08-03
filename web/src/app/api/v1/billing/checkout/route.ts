import { NextResponse } from "next/server";

import { createBillingCheckoutAdapter } from "@/lib/billing-checkout-adapter";
import { resolveBillingCheckoutConfig } from "@/lib/billing-checkout-config";
import { findOrCreateBillingCustomer, getBillingCustomerByOwner } from "@/lib/billing-repository";
import { authenticateBillingSessionOwner } from "@/lib/billing-session-auth";
import type { BillingCheckoutRequest, SubscriptionRecord } from "@/lib/contracts";
import { checkRateLimit, ensureRequestId } from "@/lib/hardening";

export async function POST(request: Request) {
  try {
    const owner = await authenticateBillingSessionOwner(request);
    if (!owner) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limiter = checkRateLimit(`billing-checkout:${owner.id}`, 20, 60_000);
    if (!limiter.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
    }

    const requestId = ensureRequestId(request.headers.get("x-request-id"));

    let body: Partial<BillingCheckoutRequest>;
    try {
      body = (await request.json()) as Partial<BillingCheckoutRequest>;
    } catch {
      body = {};
    }

    // Only `plan` is ever read from the client body. Any other field
    // (ownerUserId, a Stripe customer/session id, a raw price id, redirect
    // URLs, a claimed status) is never inspected, so it can neither be
    // trusted nor override server-derived identity or configuration.
    const plan =
      body.plan === "pro" || body.plan === "salon" || body.plan === "business" || body.plan === "free"
        ? body.plan
        : null;

    if (!plan) {
      return NextResponse.json({ error: "plan is required." }, { status: 400 });
    }

    if (plan === "free") {
      return NextResponse.json(
        { requestId, checkout: { provider: "none" }, subscription: freeSubscriptionRecord(owner.id) },
        { status: 201 },
      );
    }

    const config = resolveBillingCheckoutConfig();
    if (config.status === "disabled") {
      return NextResponse.json({ error: "BILLING_CHECKOUT_DISABLED" }, { status: 503 });
    }
    if (config.status === "invalid") {
      return NextResponse.json({ error: "BILLING_CHECKOUT_MISCONFIGURED" }, { status: 503 });
    }

    const adapter = createBillingCheckoutAdapter(config.secretKey);

    const existingCustomer = await getBillingCustomerByOwner(owner.id, "stripe");
    let providerCustomerId: string;
    if (existingCustomer) {
      providerCustomerId = existingCustomer.providerCustomerId;
    } else {
      let created: { id: string };
      try {
        created = await adapter.createCustomer({ ownerUserId: owner.id, email: owner.email });
      } catch {
        return NextResponse.json({ error: "BILLING_CHECKOUT_CUSTOMER_FAILED" }, { status: 502 });
      }
      providerCustomerId = created.id;
      await findOrCreateBillingCustomer({ ownerUserId: owner.id, provider: "stripe", providerCustomerId });
    }

    let session: { id: string; url: string };
    try {
      session = await adapter.createCheckoutSession({
        customerId: providerCustomerId,
        priceId: config.priceIds[plan],
        plan,
        ownerUserId: owner.id,
        successUrl: `${config.appBaseUrl}/billing/success?plan=${plan}`,
        cancelUrl: `${config.appBaseUrl}/billing/cancel`,
      });
    } catch {
      return NextResponse.json({ error: "BILLING_CHECKOUT_SESSION_FAILED" }, { status: 502 });
    }

    return NextResponse.json(
      { requestId, checkout: { provider: "stripe", url: session.url } },
      { status: 201 },
    );
  } catch {
    return NextResponse.json({ error: "BILLING_CHECKOUT_INTERNAL_ERROR" }, { status: 500 });
  }
}

function freeSubscriptionRecord(ownerUserId: string): SubscriptionRecord & { entitlementActive: boolean } {
  const now = new Date().toISOString();
  return {
    id: `free-${ownerUserId}`,
    ownerUserId,
    plan: "free",
    status: "inactive",
    entitlementActive: false,
    currentPeriodEnd: now,
    updatedAt: now,
  };
}
