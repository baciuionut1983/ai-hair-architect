import { NextResponse } from "next/server";

import { listOpsAuditEventsForUser } from "@/lib/ops-persistence";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function GET() {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await listOpsAuditEventsForUser(sessionUser.id);
  return NextResponse.json({ events }, { status: 200 });
}
