import { NextResponse } from "next/server";

import {
  ClientPhotoDependencyError,
  clientPhotoPersistenceUnavailableResponse,
  createClientPhotoForOwner,
  isClientPhotoPersistenceError,
} from "@/lib/client-photo-repository";
import { resolveOwnedClient } from "@/lib/client-repository";
import type { ClientPhotoCreateRequest } from "@/lib/contracts";
import { sanitize } from "@/lib/milestone1-store";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// M28 GO-3: POST only, by design -- no GET exists for this route. Photos
// are read only through /clients/:id/timeline, unchanged from before.
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

  const body = (await request.json()) as Partial<ClientPhotoCreateRequest>;
  const imageUrl = sanitize(body.imageUrl);
  if (!imageUrl) {
    return NextResponse.json({ error: "imageUrl is required." }, { status: 400 });
  }

  let photo;
  try {
    photo = await createClientPhotoForOwner({
      clientId: client.id,
      ownerUserId: sessionUser.id,
      imageUrl,
      caption: sanitize(body.caption)
    });
  } catch (error) {
    if (error instanceof ClientPhotoDependencyError) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }
    if (isClientPhotoPersistenceError(error)) {
      return clientPhotoPersistenceUnavailableResponse();
    }
    throw error;
  }

  return NextResponse.json({ photo }, { status: 201 });
}
