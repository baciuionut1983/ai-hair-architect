import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  clientPersistenceUnavailableResponse,
  countActiveClients,
  isClientPersistenceError,
} from "@/lib/client-repository";
import {
  consultationPersistenceUnavailableResponse,
  countAllConsultations,
  isConsultationPersistenceError,
} from "@/lib/consultation-repository";
import { getOpsHealthSnapshot, getSession } from "@/lib/milestone1-store";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [clientsCount, consultationsCount] = await Promise.all([countActiveClients(), countAllConsultations()]);
    const health = getOpsHealthSnapshot(clientsCount, consultationsCount);
    return NextResponse.json({ health }, { status: 200 });
  } catch (error) {
    if (isClientPersistenceError(error)) return clientPersistenceUnavailableResponse();
    if (isConsultationPersistenceError(error)) return consultationPersistenceUnavailableResponse();
    throw error;
  }
}
