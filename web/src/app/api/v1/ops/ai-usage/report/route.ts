import { NextResponse } from "next/server";

import { getAiUsageAggregation } from "@/lib/ai-usage-aggregation";
import { authenticateAiUsageReportRequest } from "@/lib/ai-usage-report-auth";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

// AI Usage & Cost Metering Phase 1: the internal reporting surface Step 8
// asked for -- deliberately NOT a dashboard page, NOT customer-facing, and
// NOT gated on a "genuine admin surface" this app doesn't actually have
// live today (see ai-usage-report-auth.ts's own comment). Defaults to the
// current calendar month (UTC) when no date range is given, matching the
// task's own "AI Usage -- Current Month" example directly. `ownerUserId`
// is accepted as an internal support/debugging filter ("why is this one
// account's cost high"), not a customer self-service parameter -- this
// endpoint is never reachable by a normal session, only by the shared
// secret.
export async function GET(request: Request) {
  const auth = authenticateAiUsageReportRequest(request);

  if (auth === "not_configured") {
    return NextResponse.json(
      { error: "AI_USAGE_REPORT_NOT_CONFIGURED", message: "AI usage reporting is not configured in this environment." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const url = new URL(request.url);
  const params = url.searchParams;

  const now = new Date();
  const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const defaultEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const startDate = parseDateParam(params.get("startDate")) ?? defaultStart;
  const endDate = parseDateParam(params.get("endDate")) ?? defaultEnd;

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate >= endDate) {
    return NextResponse.json(
      { error: "INVALID_DATE_RANGE", message: "startDate/endDate must be valid ISO dates with startDate before endDate." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const result = await getAiUsageAggregation({
      startDate,
      endDate,
      ownerUserId: params.get("ownerUserId") ?? undefined,
      provider: params.get("provider") ?? undefined,
      model: params.get("model") ?? undefined,
      feature: params.get("feature") ?? undefined,
    });

    return NextResponse.json(
      { range: { startDate: startDate.toISOString(), endDate: endDate.toISOString() }, ...result },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "AI usage report could not be produced." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

function parseDateParam(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
