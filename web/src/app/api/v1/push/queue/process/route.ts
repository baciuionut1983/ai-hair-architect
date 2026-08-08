import { NextResponse } from "next/server";

import { processPersistentPushQueueForUser } from "@/lib/ops-persistence";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function POST() {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processPersistentPushQueueForUser(sessionUser.id);
  return NextResponse.json(result, { status: 200 });
}
