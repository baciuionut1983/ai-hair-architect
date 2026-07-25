import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import type { FormulaCreateRequest } from "@/lib/contracts";
import {
  createFormulaRecord,
  getFormulasForClientByUser,
  getSession,
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
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  return NextResponse.json({ formulas: getFormulasForClientByUser(id, sessionUser.id) }, { status: 200 });
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

  const formula = createFormulaRecord({ clientId: client.id, formulaName, formulaDetails });
  return NextResponse.json({ formula }, { status: 201 });
}
