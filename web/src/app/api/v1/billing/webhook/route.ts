import { NextResponse } from "next/server";

import {
  BILLING_WEBHOOK_RESULT_MESSAGES,
  processBillingWebhookRequest,
} from "@/lib/billing-webhook-processor";
import { checkRateLimit, ensureRequestId, getRequestClientIp } from "@/lib/hardening";
import { getBillingWebhookProductionError } from "@/lib/production-guards";

export async function POST(request: Request) {
  const productionGuardError = getBillingWebhookProductionError();
  if (productionGuardError) {
    return NextResponse.json(
      {
        error: productionGuardError.code,
        message: productionGuardError.message
      },
      { status: productionGuardError.httpStatus }
    );
  }

  const requestId = ensureRequestId(request.headers.get("x-request-id"));

  const limiter = checkRateLimit(`billing-webhook:${getRequestClientIp(request)}`, 60, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("stripe-signature");

  const result = await processBillingWebhookRequest({ rawBody, signatureHeader });

  const body = result.httpStatus === 200
    ? { ok: true, code: result.code, requestId }
    : { error: result.code, message: BILLING_WEBHOOK_RESULT_MESSAGES[result.code], requestId };

  return NextResponse.json(body, { status: result.httpStatus, headers: { "Cache-Control": "no-store" } });
}
