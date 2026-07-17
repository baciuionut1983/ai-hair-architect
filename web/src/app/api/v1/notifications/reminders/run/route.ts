import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { executeReminderJobsForUser, getSession } from "@/lib/milestone1-store";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = executeReminderJobsForUser(sessionUser.id);
  return NextResponse.json(result, { status: 200 });
}
