import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { guardBusinessPersistence } from "@/lib/business-persistence-guards";
import type { NotificationsReadRequest } from "@/lib/contracts";
import { getSession } from "@/lib/milestone1-store";
import {
  isNotificationPersistenceError,
  markNotificationsReadForOwner,
  notificationPersistenceUnavailableResponse,
} from "@/lib/notification-repository";

export async function POST(request: Request) {
  const guardResponse = guardBusinessPersistence("notifications", request);
  if (guardResponse) return guardResponse;

  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

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
