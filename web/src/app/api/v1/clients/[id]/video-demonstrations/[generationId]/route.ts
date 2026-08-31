import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { findVideoDemonstrationGenerationForOwner } from "@/lib/video-generation-repository";
import { toVideoDemonstrationStatusView } from "@/lib/video-demonstration-status-view";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Real AI Video Demonstration -- GET status/detail for one exact,
// owner-scoped generation. This is the poll target the future UI uses to
// observe REQUESTED / PROCESSING / COMPLETED / FAILED -- a pure read, no
// side effects, no provider call. Advancing a PROCESSING generation is the
// separate `[generationId]/execute` route's job; a real backend worker
// also advances it independently of any browser ever calling this route
// (Stage 3, task §3/§4 -- see video-worker-runtime.ts).
//
// A foreign-owner or nonexistent generation id both resolve to the exact
// same generic 404 -- never revealing that another owner's generation
// exists (same discipline every sibling "not found" response in this
// domain already follows).
//
// Stage 3 (task §8): the response is built through
// toVideoDemonstrationStatusView -- the ONE stable, minimal, frontend-safe
// contract. Never the raw internal record: no providerOperationId, no
// sealedRequest, no raw errorMetadata/errorCode, no internal claim
// timestamps, no signed/temporary provider URL. A completed video's bytes
// are served through the existing, already-secure
// /api/v1/image-assets/[id]/content-style authenticated content route
// pattern (out of this stage's scope to wire up -- no Video UI yet), never
// a new signed-URL surface here.
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

  return NextResponse.json({ generation: toVideoDemonstrationStatusView(generation) }, { status: 200 });
}
