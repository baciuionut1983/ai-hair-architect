import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { findPhotoPreviewGenerationForOwner } from "@/lib/photo-preview-generation-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Real AI Photo Preview, Stage 2 -- GET status/detail for one exact,
// owner-scoped generation. This is the poll target a future UI (Stage 3)
// uses to observe REQUESTED / PROCESSING / COMPLETED / FAILED (task §25) --
// no WebSocket/streaming needed for V1.
//
// A foreign-owner or nonexistent generation id both resolve to the exact
// same generic 404 -- never revealing that another owner's generation
// exists (same discipline every sibling "not found" response in this
// domain already follows).
//
// The response never includes storage credentials or any object-storage
// internals -- generatedImageAssetId is the only pointer to output bytes;
// an authenticated owner fetches the actual bytes through the EXISTING,
// already-secure /api/v1/image-assets/[id]/content route (task §26: reuse
// secure content-serving conventions, never a new signed-URL surface).
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; proposalId: string; mapId: string; bindingId: string; generationId: string }> },
) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, bindingId, generationId } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const generation = await findPhotoPreviewGenerationForOwner(sessionUser.id, generationId);
  if (!generation || generation.clientId !== id || generation.spatialBindingId !== bindingId) {
    return NextResponse.json({ error: "Photo Preview generation not found." }, { status: 404 });
  }

  return NextResponse.json({ generation }, { status: 200 });
}
