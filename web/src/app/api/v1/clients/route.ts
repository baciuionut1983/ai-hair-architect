import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { guardBusinessPersistence } from "@/lib/business-persistence-guards";
import type { ClientCreateRequest } from "@/lib/contracts";
import { createClient, getSession, sanitize, store } from "@/lib/milestone1-store";

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

  const clients = store.clients
    .filter((entry) => entry.ownerUserId === user.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return NextResponse.json({ clients }, { status: 200 });
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

  const client = createClient({
    ownerUserId: user.id,
    fullName,
    email: sanitize(body.email),
    phone: sanitize(body.phone),
    notes: sanitize(body.notes)
  });

  return NextResponse.json({ client }, { status: 201 });
}
