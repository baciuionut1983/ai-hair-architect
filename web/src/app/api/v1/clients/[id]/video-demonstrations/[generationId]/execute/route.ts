import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { findVideoDemonstrationGenerationForOwner } from "@/lib/video-generation-repository";
import { executeVideoDemonstrationGeneration } from "@/lib/video-generation-execution-service";
import { toVideoDemonstrationStatusView } from "@/lib/video-demonstration-status-view";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Real AI Video Demonstration -- the explicit, USER-facing "advance"
// boundary, mirroring Photo Preview's own `[generationId]/execute` route
// precedent exactly. The client is NEVER the job's only mechanism (Stage 3,
// task §3): a real backend worker (video-worker-runtime.ts, triggered via
// the separate, machine-to-machine-authenticated
// POST /api/v1/ops/video-demonstrations/recovery-run) advances every due
// generation independently of any browser ever calling this route -- a
// user who creates a Video, closes the tab, loses connectivity, and
// returns later still finds their job progressing or complete. This route
// exists so an OPEN tab can request an immediate check/advance rather than
// waiting for the worker's own next sweep tick, and so the create route's
// own synchronous first-submit attempt has a natural "check again" partner.
//
// executeVideoDemonstrationGeneration's own internal branching decides --
// transparently to this route -- whether advancing means a fresh submit (a
// stale/unsubmitted claim) or a poll of an already-submitted provider
// operation. Never resubmits an operation that already has a
// providerOperationId on file (video-generation-execution-repository.ts's
// own load-bearing invariant).
//
// Deliberately NOT an unauthenticated "execute arbitrary generation id"
// endpoint, and deliberately NOT the same door the worker uses: session
// authentication and owner-scoped resolution are identical to every other
// user-facing route in this domain. The worker's own separate route
// (task §16) has no session-based access path at all -- a normal
// authenticated user cannot reach "process every job" through this or any
// other endpoint.
//
// Stage 3 (task §8): responds through toVideoDemonstrationStatusView, the
// one stable, minimal, frontend-safe contract -- never a raw internal
// execution-outcome object (no provider-facing codes, no
// providerOperationId).
export async function POST(_request: Request, context: { params: Promise<{ id: string; generationId: string }> }) {
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

  const existing = await findVideoDemonstrationGenerationForOwner(sessionUser.id, generationId);
  if (!existing || existing.clientId !== id) {
    return NextResponse.json({ error: "Video Demonstration generation not found." }, { status: 404 });
  }

  await executeVideoDemonstrationGeneration(generationId, sessionUser.id);
  const latest = await findVideoDemonstrationGenerationForOwner(sessionUser.id, generationId);

  return NextResponse.json({ generation: toVideoDemonstrationStatusView(latest ?? existing) }, { status: 200 });
}
