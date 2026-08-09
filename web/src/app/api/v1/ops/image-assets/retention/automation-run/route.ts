import { NextResponse } from "next/server";

import { randomUUID } from "crypto";

import { runImageAssetRetentionAutomationSweepForRuntime } from "@/lib/image-asset-retention-runtime";
import { authenticateRetentionAutomationRequest } from "@/lib/retention-automation-auth";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

// M37: the scheduler-facing trigger. Deliberately NOT session-authenticated
// -- a scheduled job has no human session to present. Secured instead by
// authenticateRetentionAutomationRequest's shared-secret check, which
// fails closed (401/503) if the secret is missing or wrong, never
// silently proceeding as an unauthenticated no-op.
export async function POST(request: Request) {
  const auth = authenticateRetentionAutomationRequest(request);

  if (auth === "not_configured") {
    return NextResponse.json(
      { error: "RETENTION_AUTOMATION_NOT_CONFIGURED", message: "Retention automation is not configured in this environment." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  if (auth === "unauthorized") {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  let body: { dryRun?: boolean } = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) {
      body = JSON.parse(text) as { dryRun?: boolean };
    }
  } catch {
    return NextResponse.json(
      { error: "REQUEST_INVALID_JSON", message: "Request body, if present, must be valid JSON." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Same safety-first default as the interactive route: a misconfigured
  // or bare `curl -X POST` (no body) call must never accidentally
  // execute a real deletion sweep -- dryRun must be explicitly false.
  const dryRun = body.dryRun !== false;
  const correlationRequestId = randomUUID();

  try {
    const result = await runImageAssetRetentionAutomationSweepForRuntime(correlationRequestId, dryRun);
    return NextResponse.json({ result, dryRun }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Image asset retention automation sweep failed." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
