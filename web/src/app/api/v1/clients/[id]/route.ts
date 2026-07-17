import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { ClientUpdateRequest } from "@/lib/contracts";
import { getSession, sanitize, store } from "@/lib/milestone1-store";

async function requireSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  return getSession(token);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await requireSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const client = store.clients.find((entry) => entry.id === id && entry.ownerUserId === user.id);

  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const body = (await request.json()) as Partial<ClientUpdateRequest>;
  const nextName = sanitize(body.fullName);
  const nextEmail = sanitize(body.email);
  const nextPhone = sanitize(body.phone);
  const nextNotes = sanitize(body.notes);

  if (body.fullName !== undefined && !nextName) {
    return NextResponse.json({ error: "fullName cannot be empty." }, { status: 400 });
  }

  if (body.fullName !== undefined) {
    client.fullName = nextName;
  }
  if (body.email !== undefined) {
    client.email = nextEmail;
  }
  if (body.phone !== undefined) {
    client.phone = nextPhone;
  }
  if (body.notes !== undefined) {
    client.notes = nextNotes;
  }
  client.updatedAt = new Date().toISOString();

  return NextResponse.json({ client }, { status: 200 });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await requireSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const index = store.clients.findIndex((entry) => entry.id === id && entry.ownerUserId === user.id);

  if (index === -1) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  store.clients.splice(index, 1);
  return NextResponse.json({ success: true }, { status: 200 });
}
