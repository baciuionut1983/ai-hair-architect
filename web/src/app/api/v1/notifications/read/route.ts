import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { NotificationsReadRequest } from "@/lib/contracts";
import { getSession, markNotificationsReadForUser } from "@/lib/milestone1-store";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as NotificationsReadRequest;
  const updated = markNotificationsReadForUser(sessionUser.id, body.notificationIds);
  return NextResponse.json({ updated }, { status: 200 });
}
