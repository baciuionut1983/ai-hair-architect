import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  imageAssetPersistenceUnavailableResponse,
  isImageAssetPersistenceError,
  listEligibleSpatialSourceImagesForClient,
} from "@/lib/image-asset-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Technical Visual Map, Stage 5C -- owner-scoped list of this client's
// images that are eligible to become a spatial binding's source (i.e. their
// normalized width/height are known). A thin read: the actual eligibility
// check is re-verified again, authoritatively, server-side by Stage 5B's
// own createDraftSpatialBinding regardless of what this list shows -- this
// endpoint only helps the professional pick a sensible one.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
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
    const images = await listEligibleSpatialSourceImagesForClient(sessionUser.id, id);
    return NextResponse.json({ images }, { status: 200 });
  } catch (error) {
    if (isImageAssetPersistenceError(error)) return imageAssetPersistenceUnavailableResponse();
    throw error;
  }
}
