import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { findVideoDemonstrationGenerationForOwner } from "@/lib/video-generation-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Real AI Video Demonstration, Stage 1 -- GET status/detail for one exact,
// owner-scoped generation. This is the poll target the future UI (a later
// stage, out of scope here) uses to observe
// REQUESTED / PROCESSING / COMPLETED / FAILED -- a pure read, no side
// effects, no provider call. Advancing a PROCESSING generation is the
// separate `[generationId]/execute` route's job.
//
// A foreign-owner or nonexistent generation id both resolve to the exact
// same generic 404 -- never revealing that another owner's generation
// exists (same discipline every sibling "not found" response in this
// domain already follows).
//
// The response never includes storage credentials or any object-storage
// internals -- generatedVideoAssetId is the only pointer to output bytes;
// serving the actual video bytes through an authenticated route is out of
// this stage's scope (no Video UI yet).
export async function GET(_request: Request, context: { params: Promise<{ id: string; generationId: string }> }) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, generationId } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const generation = await findVideoDemonstrationGenerationForOwner(sessionUser.id, generationId);
  if (!generation || generation.clientId !== id) {
    return NextResponse.json({ error: "Video Demonstration generation not found." }, { status: 404 });
  }

  return NextResponse.json({ generation }, { status: 200 });
}
