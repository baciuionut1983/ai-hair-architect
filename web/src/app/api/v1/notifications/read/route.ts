import { NextResponse } from "next/server";

import { guardBusinessPersistence } from "@/lib/business-persistence-guards";
import type { NotificationsReadRequest } from "@/lib/contracts";
import {
  isNotificationPersistenceError,
  markNotificationsReadForOwner,
  notificationPersistenceUnavailableResponse,
} from "@/lib/notification-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function POST(request: Request) {
  const guardResponse = guardBusinessPersistence("notifications", request);
  if (guardResponse) return guardResponse;

  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as NotificationsReadRequest;
  try {
    const updated = await markNotificationsReadForOwner(sessionUser.id, body.notificationIds);
    return NextResponse.json({ updated }, { status: 200 });
  } catch (error) {
    if (isNotificationPersistenceError(error)) return notificationPersistenceUnavailableResponse();
    throw error;
  }
}
