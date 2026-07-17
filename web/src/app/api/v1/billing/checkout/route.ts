import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { BillingCheckoutRequest } from "@/lib/contracts";
import { checkRateLimit, ensureRequestId, maskSensitive } from "@/lib/hardening";
import { createAuditEvent, getSession, updateSubscriptionForUser } from "@/lib/milestone1-store";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`billing-checkout:${sessionUser.id}`, 20, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const requestId = ensureRequestId(request.headers.get("x-request-id"));
  const body = (await request.json()) as Partial<BillingCheckoutRequest>;
  const plan =
    body.plan === "pro" || body.plan === "salon" || body.plan === "business" || body.plan === "free"
      ? body.plan
      : null;

  if (!plan) {
    return NextResponse.json({ error: "plan is required." }, { status: 400 });
  }

  const status = plan === "free" ? "inactive" : "trialing";
  const subscription = updateSubscriptionForUser({
    userId: sessionUser.id,
    plan,
    status
  });

  createAuditEvent({
    ownerUserId: sessionUser.id,
    requestId,
    module: "billing",
    action: "checkout_started",
    metadata: {
      plan,
      user: maskSensitive(sessionUser.email)
    }
  });

  return NextResponse.json(
    {
      requestId,
      checkout: {
        provider: "simulated",
        redirectUrl: `/billing/success?plan=${plan}`
      },
      subscription
    },
    { status: 201 }
  );
}
