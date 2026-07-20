import { NextRequest, NextResponse } from "next/server";

import { validateAnalyticsAccess, createAuthErrorResponse, AnalyticsAuthError } from "@/middleware/analytics-auth";
import { rotateWebhookSecret } from "@/lib/webhook-secret-rotation";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await validateAnalyticsAccess(req);
    const { id } = await params;

    const result = await rotateWebhookSecret({
      ownerUserId: user.id,
      webhookEndpointId: id,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AnalyticsAuthError) {
      return createAuthErrorResponse(error);
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not found")) {
      return NextResponse.json(
        { error: "NOT_FOUND", status: 404, message: "Webhook not found" },
        { status: 404 },
      );
    }

    console.error("POST /webhooks/{id}/regenerate-secret error:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR", status: 500, message: "An error occurred" }, { status: 500 });
  }
}