import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { guardBusinessPersistence } from "@/lib/business-persistence-guards";
import { resolveOwnedClient } from "@/lib/client-repository";
import type { ConsultationCreateRequest } from "@/lib/contracts";
import { findPersistedAnalysisById } from "@/lib/analysis-persistence";
import { getAnalysisOwnedByUser, getSession, store } from "@/lib/milestone1-store";

export async function POST(request: Request) {
  const blockedResponse = guardBusinessPersistence("consultations", request);
  if (blockedResponse) {
    return blockedResponse;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<ConsultationCreateRequest>;

  if (!body.clientId || !body.analysisId || !body.summary) {
    return NextResponse.json({ error: "Invalid consultation payload." }, { status: 400 });
  }

  const ownedClient = await resolveOwnedClient(sessionUser.id, body.clientId);
  if (ownedClient instanceof Response) return ownedClient;
  if (!ownedClient) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const analysis =
    getAnalysisOwnedByUser(body.analysisId, sessionUser.id) ??
    (await findPersistedAnalysisById(body.analysisId, sessionUser.id));
  if (!analysis || analysis.clientId !== ownedClient.id) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }

  if (analysis.phase !== "ready") {
    return NextResponse.json(
      { error: "Analysis is not ready. Complete clarifying questions first." },
      { status: 409 }
    );
  }

  const record = {
    id: crypto.randomUUID(),
    clientId: ownedClient.id,
    analysisId: analysis.id,
    summary: body.summary,
    nextSteps: Array.isArray(body.nextSteps) ? body.nextSteps : [],
    createdAt: new Date().toISOString()
  };

  store.consultations.push(record);
  return NextResponse.json({ consultation: record }, { status: 201 });
}
