import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import type { ClientPhotoCreateRequest } from "@/lib/contracts";
import { createClientPhoto, getSession, sanitize } from "@/lib/milestone1-store";

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

  const body = (await request.json()) as Partial<ClientPhotoCreateRequest>;
  const imageUrl = sanitize(body.imageUrl);
  if (!imageUrl) {
    return NextResponse.json({ error: "imageUrl is required." }, { status: 400 });
  }

  const photo = createClientPhoto({
    clientId: client.id,
    imageUrl,
    caption: sanitize(body.caption)
  });

  return NextResponse.json({ photo }, { status: 201 });
}
