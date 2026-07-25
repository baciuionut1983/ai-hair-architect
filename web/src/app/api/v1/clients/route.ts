import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { guardBusinessPersistence } from "@/lib/business-persistence-guards";
import {
  clientPersistenceUnavailableResponse,
  createClientForOwner,
  isClientPersistenceError,
  listClientsForOwner,
} from "@/lib/client-repository";
import type { ClientCreateRequest } from "@/lib/contracts";
import { getSession, sanitize } from "@/lib/milestone1-store";

async function requireSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  return getSession(token);
}

export async function GET(request: Request) {
  const blockedResponse = guardBusinessPersistence("clients", request);
  if (blockedResponse) {
    return blockedResponse;
  }

  const user = await requireSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json({ clients: await listClientsForOwner(user.id) }, { status: 200 });
  } catch (error) {
    if (isClientPersistenceError(error)) return clientPersistenceUnavailableResponse();
    throw error;
  }
}

export async function POST(request: Request) {
  const blockedResponse = guardBusinessPersistence("clients", request);
  if (blockedResponse) {
    return blockedResponse;
  }

  const user = await requireSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<ClientCreateRequest>;
  const fullName = sanitize(body.fullName);

  if (!fullName) {
    return NextResponse.json({ error: "fullName is required." }, { status: 400 });
  }

  if (fullName.length > 200) {
    return NextResponse.json({ error: "fullName must not exceed 200 characters." }, { status: 400 });
  }

  const email = sanitize(body.email);
  const phone = sanitize(body.phone);
  const notes = sanitize(body.notes);
  if (email.length > 320 || phone.length > 40 || notes.length > 4000) {
    return NextResponse.json({ error: "Client contact data exceeds the allowed length." }, { status: 400 });
  }

  try {
    const client = await createClientForOwner(user.id, {
      fullName,
      email: email || null,
      phone: phone || null,
      notes: notes || null,
    });
    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    if (isClientPersistenceError(error)) return clientPersistenceUnavailableResponse();
    throw error;
  }
}
