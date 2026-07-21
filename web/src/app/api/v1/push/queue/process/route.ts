import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { processPersistentPushQueueForUser, resolveOpsSessionUser } from "@/lib/ops-persistence";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = await resolveOpsSessionUser(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processPersistentPushQueueForUser(sessionUser.id);
  return NextResponse.json(result, { status: 200 });
}
