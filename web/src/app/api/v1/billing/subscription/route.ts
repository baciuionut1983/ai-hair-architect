import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSession, getSubscriptionForUser } from "@/lib/milestone1-store";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subscription = getSubscriptionForUser(sessionUser.id);
  return NextResponse.json({ subscription }, { status: 200 });
}
