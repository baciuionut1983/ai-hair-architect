import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  clientPersistenceUnavailableResponse,
  countActiveClients,
  isClientPersistenceError,
} from "@/lib/client-repository";
import { getOpsHealthSnapshot, getSession } from "@/lib/milestone1-store";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const health = getOpsHealthSnapshot(await countActiveClients());
    return NextResponse.json({ health }, { status: 200 });
  } catch (error) {
    if (isClientPersistenceError(error)) return clientPersistenceUnavailableResponse();
    throw error;
  }
}
