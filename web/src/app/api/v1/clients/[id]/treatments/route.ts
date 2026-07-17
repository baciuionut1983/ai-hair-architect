import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { TreatmentCreateRequest } from "@/lib/contracts";
import {
  createTreatmentRecord,
  getClientOwnedByUser,
  getSession,
  getTreatmentsForClientByUser,
  sanitize
} from "@/lib/milestone1-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const client = getClientOwnedByUser(id, sessionUser.id);
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  return NextResponse.json({ treatments: getTreatmentsForClientByUser(id, sessionUser.id) }, { status: 200 });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const client = getClientOwnedByUser(id, sessionUser.id);
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const body = (await request.json()) as Partial<TreatmentCreateRequest>;
  const treatmentName = sanitize(body.treatmentName);
  const treatmentDetails = sanitize(body.treatmentDetails);
  if (!treatmentName || !treatmentDetails) {
    return NextResponse.json(
      { error: "treatmentName and treatmentDetails are required." },
      { status: 400 }
    );
  }

  const treatment = createTreatmentRecord({ clientId: client.id, treatmentName, treatmentDetails });
  return NextResponse.json({ treatment }, { status: 201 });
}
