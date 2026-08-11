import { NextResponse } from "next/server";

import { createBillingCheckoutAdapter } from "@/lib/billing-checkout-adapter";
import { resolveBillingCheckoutConfig } from "@/lib/billing-checkout-config";
import {
  acquireCheckoutLock,
  attachCheckoutLockSession,
  findOrCreateBillingCustomer,
  getBillingCustomerByOwner,
  hasEntitledSubscription,
  releaseCheckoutLock,
} from "@/lib/billing-repository";
import type { BillingCheckoutRequest, SubscriptionRecord } from "@/lib/contracts";
import { checkRateLimit, ensureRequestId } from "@/lib/hardening";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// M38: how long a single checkout attempt reserves the owner's "one
// in-flight checkout" slot. Matches Stripe Checkout's own minimum
// configurable expires_at (30 minutes) -- an abandoned/declined checkout
// therefore never blocks a retry for longer than Stripe's own session
// would have stayed payable anyway. CHECKOUT_LOCK_SAFETY_BUFFER_MS keeps
// the lock alive slightly longer than the Stripe session itself, so the
// lock can never be reclaimed while that session might still be paid.
const CHECKOUT_SESSION_TTL_MS = 30 * 60 * 1000;
const CHECKOUT_LOCK_SAFETY_BUFFER_MS = 60 * 1000;

export async function POST(request: Request) {
  try {
    const owner = await authenticateSessionRequest();
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

    // Per-plan, checked independently of the other plans -- Business having
    // no Stripe price configured yet must never block Pro or Salon, and
    // must never fall through to Stripe with an undefined price id.
    const priceId = config.priceIds[plan];
    if (!priceId) {
      return NextResponse.json({ error: "BILLING_CHECKOUT_PLAN_UNAVAILABLE" }, { status: 503 });
    }

    // Server-side guard against a second concurrent Stripe subscription: the
    // UI already hides the Subscribe button once entitled, but that is
    // purely cosmetic -- nothing previously stopped a direct request from
    // reaching Stripe. Checked against ANY of the owner's rows in an
    // entitled status (not just the most-recently-updated one), so this
    // stays correct even if the owner already ended up with more than one
    // BillingSubscription row. Deliberately placed before the adapter is
    // even constructed, so a blocked request never calls Stripe at all.
    if (await hasEntitledSubscription(owner.id, "stripe")) {
      return NextResponse.json({ error: "BILLING_CHECKOUT_ALREADY_ACTIVE" }, { status: 409 });
    }

    // M38: closes the remaining TOCTOU gap -- two requests racing past the
    // entitlement check above (neither has a subscription yet) must still
    // never both reach Stripe. Enforced by BillingCheckoutLock's composite
    // primary key in Postgres, so this holds across concurrent requests on
    // any number of app instances, not just within this one process.
    const now = new Date();
    const lockExpiresAt = new Date(now.getTime() + CHECKOUT_SESSION_TTL_MS + CHECKOUT_LOCK_SAFETY_BUFFER_MS);
    const lock = await acquireCheckoutLock({ ownerUserId: owner.id, provider: "stripe", plan, now, expiresAt: lockExpiresAt });
    if (!lock.acquired) {
      return NextResponse.json({ error: "BILLING_CHECKOUT_IN_PROGRESS" }, { status: 409 });
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
        // Release immediately -- a failed attempt must never block a retry
        // for the full lock TTL.
        await releaseCheckoutLock(owner.id, "stripe");
        return NextResponse.json({ error: "BILLING_CHECKOUT_CUSTOMER_FAILED" }, { status: 502 });
      }
      providerCustomerId = created.id;
      await findOrCreateBillingCustomer({ ownerUserId: owner.id, provider: "stripe", providerCustomerId });
    }

    let session: { id: string; url: string };
    try {
      session = await adapter.createCheckoutSession({
        customerId: providerCustomerId,
        priceId,
        plan,
        ownerUserId: owner.id,
        // Routes back into the real /account screen (not a dedicated
        // success/cancel page, which does not exist) -- the checkout=...
        // query param only ever drives a transient, honest "confirming
        // your payment" banner there. Entitlement itself is never read
        // from this URL; it always comes from a fresh GET
        // /api/v1/billing/subscription call against persisted billing state.
        successUrl: `${config.appBaseUrl}/account?checkout=success`,
        cancelUrl: `${config.appBaseUrl}/account?checkout=cancel`,
        expiresAt: new Date(now.getTime() + CHECKOUT_SESSION_TTL_MS),
      });
    } catch {
      await releaseCheckoutLock(owner.id, "stripe");
      return NextResponse.json({ error: "BILLING_CHECKOUT_SESSION_FAILED" }, { status: 502 });
    }

    // Deliberately NOT wrapped in a release-on-failure block: by this point
    // Stripe has already created a real, payable Checkout Session. If this
    // write itself fails, the safe default is to keep the lock held (fail
    // closed) rather than risk a second session being created while this
    // one might still exist -- it just self-heals via the TTL either way.
    await attachCheckoutLockSession(owner.id, "stripe", session.id);

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
