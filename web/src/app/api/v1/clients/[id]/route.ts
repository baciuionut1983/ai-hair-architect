import { NextResponse } from "next/server";

import { guardBusinessPersistence } from "@/lib/business-persistence-guards";
import {
  clientPersistenceUnavailableResponse,
  isClientPersistenceError,
  resolveOwnedClient,
  softDeleteClientForOwner,
  updateClientForOwner,
} from "@/lib/client-repository";
import type { ClientUpdateRequest } from "@/lib/contracts";
import { sanitize } from "@/lib/milestone1-store";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

async function requireSession() {
  return authenticateSessionRequest();
}

// M30 GO-2: single-client fetch, needed by the client detail page (M30
// GO-4). Reuses the same resolveOwnedClient helper every other
// client-scoped route already relies on -- no new repository logic.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const blockedResponse = guardBusinessPersistence("clients", request);
  if (blockedResponse) return blockedResponse;

  const user = await requireSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const client = await resolveOwnedClient(user.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  return NextResponse.json({ client }, { status: 200 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const blockedResponse = guardBusinessPersistence("clients", request);
  if (blockedResponse) return blockedResponse;

  const user = await requireSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as Partial<ClientUpdateRequest>;
  const nextName = sanitize(body.fullName);
  const nextEmail = sanitize(body.email);
  const nextPhone = sanitize(body.phone);
  const nextNotes = sanitize(body.notes);

  if (body.fullName !== undefined && !nextName) {
    return NextResponse.json({ error: "fullName cannot be empty." }, { status: 400 });
  }

  if (nextName.length > 200 || nextEmail.length > 320 || nextPhone.length > 40 || nextNotes.length > 4000) {
    return NextResponse.json({ error: "Client data exceeds the allowed length." }, { status: 400 });
  }

  try {
    const client = await updateClientForOwner(user.id, id, {
      ...(body.fullName !== undefined ? { fullName: nextName } : {}),
      ...(body.email !== undefined ? { email: nextEmail || null } : {}),
      ...(body.phone !== undefined ? { phone: nextPhone || null } : {}),
      ...(body.notes !== undefined ? { notes: nextNotes || null } : {}),
    });
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    return NextResponse.json({ client }, { status: 200 });
  } catch (error) {
    if (isClientPersistenceError(error)) return clientPersistenceUnavailableResponse();
    throw error;
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const blockedResponse = guardBusinessPersistence("clients", request);
  if (blockedResponse) return blockedResponse;

  const user = await requireSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    if (!(await softDeleteClientForOwner(user.id, id))) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (isClientPersistenceError(error)) return clientPersistenceUnavailableResponse();
    throw error;
  }
}
