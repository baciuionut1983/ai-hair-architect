import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { isRecord } from "@/lib/proposal-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { ProfessionalBrainAccessError, ProfessionalBrainStateError, createDraftCurrentState } from "@/lib/professional-brain-orchestrator";
import { HairStateSnapshotDependencyError, HairStateSnapshotPersistenceError, HairStateSnapshotValidationError } from "@/lib/hair-state-snapshot-repository";

// AI Hair Architect, B2 -- PROFESSIONAL BRAIN CUT+COLOR FLOW, Part 1a.
// Creates a DRAFT CURRENT HairStateSnapshot for one owned client. Makes
// ZERO AI calls and ZERO provider calls -- structural validation only
// (isHairStateSnapshotPayload, already enforced inside
// createDraftCurrentState -- never re-validated here, matching this
// package's own "route validates shape-of-JSON only, service layer
// validates domain shape" split, see render-dry-run/route.ts's own
// precedent). `payload` is forwarded as `unknown`; an invalid payload maps
// to PROFESSIONAL_BRAIN_NEEDS_CURRENT_STATE (409) via mapError below,
// never a silently-accepted malformed snapshot.

function mapError(error: unknown): Response {
  if (error instanceof ProfessionalBrainAccessError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof ProfessionalBrainStateError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof HairStateSnapshotValidationError || error instanceof HairStateSnapshotDependencyError || error instanceof HairStateSnapshotPersistenceError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  throw error;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isRecord(body) || !("payload" in body)) {
    return NextResponse.json({ error: "A `payload` (HairStateSnapshotPayload) is required." }, { status: 400 });
  }

  try {
    const snapshot = await createDraftCurrentState(sessionUser.id, id, { payload: body.payload });
    return NextResponse.json({ snapshot }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
