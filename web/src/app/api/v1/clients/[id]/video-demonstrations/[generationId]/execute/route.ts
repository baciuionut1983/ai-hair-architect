import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { findVideoDemonstrationGenerationForOwner } from "@/lib/video-generation-repository";
import { executeVideoDemonstrationGeneration } from "@/lib/video-generation-execution-service";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Real AI Video Demonstration, Stage 1 -- the explicit "advance" boundary,
// mirroring Photo Preview's own `[generationId]/execute` route precedent
// exactly. Unlike Photo Preview (where this route is rarely needed, since
// its own POST create already executes synchronously to completion), THIS
// route is the PRIMARY way a caller ever reaches COMPLETED: Video's own
// create route only performs one SUBMIT attempt (task's own async
// architecture -- generation itself takes 11s-6min per the provider's own
// documented range, never awaited inline). A caller (client UI, or a
// future real worker/cron) calls this endpoint repeatedly while the
// generation is PROCESSING; executeVideoDemonstrationGeneration's own
// internal branching decides -- transparently to this route -- whether
// that means a fresh submit (a stale/unsubmitted claim) or a poll of an
// already-submitted provider operation. Never resubmits an operation that
// already has a providerOperationId on file (video-generation-execution-repository.ts's
// own load-bearing invariant).
//
// Deliberately NOT an unauthenticated "execute arbitrary generation id"
// endpoint: authentication and owner-scoped resolution are identical to
// every other route in this domain -- there is no separate "internal
// worker" bypass credential. If a real external trigger is introduced
// later, it authenticates as a real owner/service account through this
// exact same session mechanism, never a special unauthenticated path.
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

  const executed = await executeVideoDemonstrationGeneration(generationId, sessionUser.id);
  const latest = await findVideoDemonstrationGenerationForOwner(sessionUser.id, generationId);

  return NextResponse.json({ generation: latest ?? existing, executionOutcome: executed }, { status: 200 });
}
