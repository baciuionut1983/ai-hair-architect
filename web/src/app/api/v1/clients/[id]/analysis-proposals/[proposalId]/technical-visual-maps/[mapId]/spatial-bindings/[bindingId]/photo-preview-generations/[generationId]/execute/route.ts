import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { findPhotoPreviewGenerationForOwner } from "@/lib/photo-preview-generation-repository";
import { executePhotoPreviewGeneration } from "@/lib/photo-preview-execution-service";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Real AI Photo Preview, Stage 2 -- the explicit "claim/execute" boundary
// (task §24's own 4th, optional capability). The ordinary POST create route
// already executes synchronously (task §23), so this endpoint is not on
// that ordinary path -- it exists for the two cases that DO need it:
// (a) an authenticated owner explicitly retrying a REQUESTED generation
//     (e.g. one that was requeued after a retryable provider failure, or
//     is stuck stale-PROCESSING past the recovery threshold), and
// (b) documenting the exact, already-secured, already-tested boundary a
//     FUTURE genuine Railway cron/worker would call, without requiring any
//     route changes when that decoupling is actually implemented (see this
//     stage's own final report for the exact deployment requirement).
//
// Deliberately NOT an unauthenticated "execute arbitrary generation id"
// endpoint (task §24's own explicit prohibition): authentication and
// owner-scoped resolution are identical to every other route in this
// domain -- there is no separate "internal worker" bypass credential. If a
// real external trigger is introduced later, it authenticates as a real
// owner/service account through this exact same session mechanism, never
// a special unauthenticated path.
export async function POST(
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

  const existing = await findPhotoPreviewGenerationForOwner(sessionUser.id, generationId);
  if (!existing || existing.clientId !== id || existing.spatialBindingId !== bindingId) {
    return NextResponse.json({ error: "Photo Preview generation not found." }, { status: 404 });
  }

  const executed = await executePhotoPreviewGeneration(generationId, sessionUser.id);
  const latest = await findPhotoPreviewGenerationForOwner(sessionUser.id, generationId);

  return NextResponse.json({ generation: latest ?? existing, executionOutcome: executed }, { status: 200 });
}
