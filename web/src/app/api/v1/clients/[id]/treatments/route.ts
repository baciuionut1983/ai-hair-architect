import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  ClientTreatmentDependencyError,
  clientTreatmentPersistenceUnavailableResponse,
  createClientTreatmentForOwner,
  isClientTreatmentPersistenceError,
  listClientTreatmentsForOwner,
} from "@/lib/client-treatment-repository";
import type { TreatmentCreateRequest } from "@/lib/contracts";
import { sanitize } from "@/lib/milestone1-store";
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
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  try {
    const treatments = await listClientTreatmentsForOwner(sessionUser.id, id);
    return NextResponse.json({ treatments }, { status: 200 });
  } catch (error) {
    if (isClientTreatmentPersistenceError(error)) {
      return clientTreatmentPersistenceUnavailableResponse();
    }
    throw error;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
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

  let treatment;
  try {
    // M28 GO-3: sourceAnalysisId is deliberately never read from the
    // request body here -- it is not part of the public
    // TreatmentCreateRequest contract, and wiring it up is explicitly out
    // of scope for this package.
    treatment = await createClientTreatmentForOwner({
      clientId: client.id,
      ownerUserId: sessionUser.id,
      treatmentName,
      treatmentDetails,
    });
  } catch (error) {
    if (error instanceof ClientTreatmentDependencyError) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }
    if (isClientTreatmentPersistenceError(error)) {
      return clientTreatmentPersistenceUnavailableResponse();
    }
    throw error;
  }

  return NextResponse.json({ treatment }, { status: 201 });
}
