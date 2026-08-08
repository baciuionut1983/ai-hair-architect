import { NextResponse } from "next/server";

import { guardBusinessPersistence } from "@/lib/business-persistence-guards";
import {
  isNotificationPersistenceError,
  listNotificationsForOwner,
  notificationPersistenceUnavailableResponse,
} from "@/lib/notification-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function GET(request: Request) {
  const guardResponse = guardBusinessPersistence("notifications", request);
  if (guardResponse) return guardResponse;

  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const notifications = await listNotificationsForOwner(sessionUser.id);
    return NextResponse.json({ notifications }, { status: 200 });
  } catch (error) {
    if (isNotificationPersistenceError(error)) return notificationPersistenceUnavailableResponse();
    throw error;
  }
}
