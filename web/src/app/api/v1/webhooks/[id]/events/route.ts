import { NextRequest, NextResponse } from "next/server";

import { validateAnalyticsAccess, createAuthErrorResponse, AnalyticsAuthError } from "@/middleware/analytics-auth";
import { prisma } from "@/lib/prisma";
import { listWebhookDeliveryHistoryCursor } from "@/lib/webhook-delivery-history";

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

    const url = new URL(req.url);
    const limitValue = url.searchParams.get("limit");
    const cursor = url.searchParams.get("cursor");
    const limit = limitValue !== null ? Number.parseInt(limitValue, 10) : null;

    if (limit !== null && (Number.isNaN(limit) || limit < 1 || limit > 100)) {
      return NextResponse.json(
        { error: "INVALID_LIMIT", status: 400, message: "limit must be between 1 and 100" },
        { status: 400 },
      );
    }

    const page = await listWebhookDeliveryHistoryCursor({
      ownerUserId: user.id,
      webhookEndpointId: webhook.id,
      cursor: cursor || null,
      limit: limit ?? undefined,
    });

    return NextResponse.json(
      {
        data: page.data,
        pageInfo: page.pageInfo,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof AnalyticsAuthError) {
      return createAuthErrorResponse(error);
    }

    console.error("GET /webhooks/{id}/events error:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR", status: 500, message: "An error occurred" }, { status: 500 });
  }
}