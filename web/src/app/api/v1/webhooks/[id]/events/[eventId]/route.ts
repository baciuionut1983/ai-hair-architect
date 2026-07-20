import { NextRequest, NextResponse } from "next/server";

import { validateAnalyticsAccess, createAuthErrorResponse, AnalyticsAuthError } from "@/middleware/analytics-auth";
import { prisma } from "@/lib/prisma";
import { getWebhookDeliveryDetails } from "@/lib/webhook-delivery-history";

async function getWebhookOrNotFound(id: string, userId: string) {
  const webhook = await prisma.webhookEndpoint.findUnique({
    where: { id },
  });

  if (!webhook || webhook.ownerUserId !== userId) {
    return null;
  }

  return webhook;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  try {
    const user = await validateAnalyticsAccess(req);
    const { id, eventId } = await params;

    const webhook = await getWebhookOrNotFound(id, user.id);

    if (!webhook) {
      return NextResponse.json(
        { error: "NOT_FOUND", status: 404, message: "Webhook not found" },
        { status: 404 },
      );
    }

    const delivery = await getWebhookDeliveryDetails({
      ownerUserId: user.id,
      webhookEndpointId: webhook.id,
      deliveryId: eventId,
    });

    return NextResponse.json(delivery, { status: 200 });
  } catch (error) {
    if (error instanceof AnalyticsAuthError) {
      return createAuthErrorResponse(error);
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not found")) {
      return NextResponse.json(
        { error: "NOT_FOUND", status: 404, message: "Webhook delivery not found" },
        { status: 404 },
      );
    }

    console.error("GET /webhooks/{id}/events/{eventId} error:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR", status: 500, message: "An error occurred" }, { status: 500 });
  }
}