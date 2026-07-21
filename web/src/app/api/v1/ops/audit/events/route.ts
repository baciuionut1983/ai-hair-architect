import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { listOpsAuditEventsForUser, resolveOpsSessionUser } from "@/lib/ops-persistence";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = await resolveOpsSessionUser(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await listOpsAuditEventsForUser(sessionUser.id);
  return NextResponse.json({ events }, { status: 200 });
}
