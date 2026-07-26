import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { guardBusinessPersistence } from "@/lib/business-persistence-guards";
import { getSession } from "@/lib/milestone1-store";
import {
  isNotificationPersistenceError,
  listNotificationsForOwner,
  notificationPersistenceUnavailableResponse,
} from "@/lib/notification-repository";

export async function GET(request: Request) {
  const guardResponse = guardBusinessPersistence("notifications", request);
  if (guardResponse) return guardResponse;

  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

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
