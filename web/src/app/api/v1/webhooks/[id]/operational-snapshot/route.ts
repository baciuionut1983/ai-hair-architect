import { NextRequest, NextResponse } from "next/server";

import { validateAnalyticsAccess, createAuthErrorResponse, AnalyticsAuthError } from "@/middleware/analytics-auth";
import { prisma } from "@/lib/prisma";
import { getWebhookOperationalSnapshot } from "@/lib/webhook-operational-snapshot";

async function getWebhookOrNotFound(id: string, userId: string) {
  const webhook = await prisma.webhookEndpoint.findUnique({
    where: { id },
  });

  if (!webhook || webhook.ownerUserId !== userId) {
    return null;
  }

  return webhook;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await validateAnalyticsAccess(req);
    const { id } = await params;

    const webhook = await getWebhookOrNotFound(id, user.id);

    if (!webhook) {
      return NextResponse.json(
        { error: "NOT_FOUND", status: 404, message: "Webhook not found" },
        { status: 404 },
      );
    }

    const snapshot = await getWebhookOperationalSnapshot({
      ownerUserId: user.id,
      webhookEndpointId: webhook.id,
    });

    return NextResponse.json(snapshot, { status: 200 });
  } catch (error) {
    if (error instanceof AnalyticsAuthError) {
      return createAuthErrorResponse(error);
    }

    console.error("GET /webhooks/{id}/operational-snapshot error:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR", status: 500, message: "An error occurred" }, { status: 500 });
  }
}