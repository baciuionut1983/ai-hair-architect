import { NextResponse } from "next/server";

import { ensureRequestId } from "@/lib/hardening";
import { evaluateReadiness } from "@/lib/production-guards";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const requestId = ensureRequestId(request.headers.get("x-request-id"));
  const evaluation = evaluateReadiness({ requestId });

  return NextResponse.json(evaluation.payload, {
    status: evaluation.httpStatus,
    headers: NO_STORE_HEADERS
  });
}
