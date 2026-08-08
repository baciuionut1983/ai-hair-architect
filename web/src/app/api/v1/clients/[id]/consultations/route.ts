import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  consultationPersistenceUnavailableResponse,
  isConsultationPersistenceError,
  listConsultationsForClient,
} from "@/lib/consultation-repository";
import type { ClientConsultationsResponse } from "@/lib/contracts";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    const client = await resolveOwnedClient(sessionUser.id, id);
    if (client instanceof Response) return client;
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    const response: ClientConsultationsResponse = {
      consultations: await listConsultationsForClient(sessionUser.id, id),
    };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (isConsultationPersistenceError(error)) return consultationPersistenceUnavailableResponse();
    throw error;
  }
}
