import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  clientPersistenceUnavailableResponse,
  isClientPersistenceError,
  listActiveClientIdsForOwner,
} from "@/lib/client-repository";
import { getAnalyticsSnapshotForUser, getSession } from "@/lib/milestone1-store";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const ownedClientIds = await listActiveClientIdsForOwner(sessionUser.id);
    const snapshot = getAnalyticsSnapshotForUser(sessionUser.id, ownedClientIds);
    return NextResponse.json({ snapshot }, { status: 200 });
  } catch (error) {
    if (isClientPersistenceError(error)) return clientPersistenceUnavailableResponse();
    throw error;
  }
}
