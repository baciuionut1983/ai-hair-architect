import { NextResponse } from "next/server";

import type { BillingWebhookEvent } from "@/lib/contracts";
import { checkRateLimit, ensureRequestId } from "@/lib/hardening";
import { createAuditEvent, createPaymentRecord, updateSubscriptionForUser } from "@/lib/milestone1-store";

export async function POST(request: Request) {
  const requestId = ensureRequestId(request.headers.get("x-request-id"));
  const limiter = checkRateLimit(`billing-webhook`, 60, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const body = (await request.json()) as Partial<BillingWebhookEvent>;

  const userId = String(body.userId ?? "").trim();
  const eventId = String(body.eventId ?? "").trim();
  const plan = body.plan;
  const status = body.status;

  if (!userId || !eventId || !plan || !status) {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const subscription = updateSubscriptionForUser({ userId, plan, status });

  if ((body.amountCents ?? 0) > 0) {
    createPaymentRecord({
      ownerUserId: userId,
      providerEventId: eventId,
      amountCents: body.amountCents ?? 0,
      currency: body.currency || "USD",
      status: status === "active" ? "succeeded" : "failed"
    });
  }

  createAuditEvent({
    ownerUserId: userId,
    requestId,
    module: "billing",
    action: "webhook_processed",
    metadata: {
      eventId,
      plan,
      status
    }
  });

  return NextResponse.json({ ok: true, subscription }, { status: 200 });
}
