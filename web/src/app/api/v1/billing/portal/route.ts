import { NextResponse } from "next/server";

import { createBillingPortalAdapter } from "@/lib/billing-portal-adapter";
import { resolveBillingCheckoutConfig } from "@/lib/billing-checkout-config";
import { getBillingCustomerByOwner } from "@/lib/billing-repository";
import { checkRateLimit, ensureRequestId } from "@/lib/hardening";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function POST(request: Request) {
  try {
    const owner = await authenticateSessionRequest();
    if (!owner) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limiter = checkRateLimit(`billing-portal:${owner.id}`, 20, 60_000);
    if (!limiter.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
    }

    const requestId = ensureRequestId(request.headers.get("x-request-id"));

    // Reuses the same fail-closed billing config as checkout (mode must be
    // "enabled", STRIPE_SECRET_KEY and APP_BASE_URL both present) -- the
    // Portal needs exactly the same two values and must never diverge from
    // checkout's own readiness gate.
    const config = resolveBillingCheckoutConfig();
    if (config.status === "disabled") {
      return NextResponse.json({ error: "BILLING_PORTAL_DISABLED" }, { status: 503 });
    }
    if (config.status === "invalid") {
      return NextResponse.json({ error: "BILLING_PORTAL_MISCONFIGURED" }, { status: 503 });
    }

    // The Stripe Customer is resolved exclusively from persisted billing
    // state for the authenticated owner -- no client-supplied customerId is
    // ever read or trusted, matching the checkout route's precedent.
    const customer = await getBillingCustomerByOwner(owner.id, "stripe");
    if (!customer) {
      return NextResponse.json({ error: "BILLING_CUSTOMER_NOT_FOUND" }, { status: 404 });
    }

    const adapter = createBillingPortalAdapter(config.secretKey);

    let session: { url: string };
    try {
      session = await adapter.createPortalSession({
        customerId: customer.providerCustomerId,
        returnUrl: `${config.appBaseUrl}/account`,
      });
    } catch {
      return NextResponse.json({ error: "BILLING_PORTAL_SESSION_FAILED" }, { status: 502 });
    }

    return NextResponse.json({ requestId, portal: { url: session.url } }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "BILLING_PORTAL_INTERNAL_ERROR" }, { status: 500 });
  }
}
