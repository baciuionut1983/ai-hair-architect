import { NextResponse } from "next/server";

import {
  ClientFormulaDependencyError,
  clientFormulaPersistenceUnavailableResponse,
  createClientFormulaForOwner,
  isClientFormulaPersistenceError,
  listClientFormulasForOwner,
} from "@/lib/client-formula-repository";
import { resolveOwnedClient } from "@/lib/client-repository";
import type { FormulaCreateRequest } from "@/lib/contracts";
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
    const formulas = await listClientFormulasForOwner(sessionUser.id, id);
    return NextResponse.json({ formulas }, { status: 200 });
  } catch (error) {
    if (isClientFormulaPersistenceError(error)) {
      return clientFormulaPersistenceUnavailableResponse();
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

  const body = (await request.json()) as Partial<FormulaCreateRequest>;
  const formulaName = sanitize(body.formulaName);
  const formulaDetails = sanitize(body.formulaDetails);
  if (!formulaName || !formulaDetails) {
    return NextResponse.json(
      { error: "formulaName and formulaDetails are required." },
      { status: 400 }
    );
  }

  let formula;
  try {
    // M28 GO-3: sourceAnalysisId is deliberately never read from the
    // request body here -- it is not part of the public FormulaCreateRequest
    // contract, and wiring it up is explicitly out of scope for this package.
    formula = await createClientFormulaForOwner({
      clientId: client.id,
      ownerUserId: sessionUser.id,
      formulaName,
      formulaDetails,
    });
  } catch (error) {
    if (error instanceof ClientFormulaDependencyError) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }
    if (isClientFormulaPersistenceError(error)) {
      return clientFormulaPersistenceUnavailableResponse();
    }
    throw error;
  }

  return NextResponse.json({ formula }, { status: 201 });
}
