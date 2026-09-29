import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { isRecord } from "@/lib/proposal-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { ProfessionalBrainAccessError, ProfessionalBrainStateError, createDraftTargetState } from "@/lib/professional-brain-orchestrator";
import { HairStateSnapshotDependencyError, HairStateSnapshotPersistenceError, HairStateSnapshotValidationError } from "@/lib/hair-state-snapshot-repository";

// AI Hair Architect, B2 -- PROFESSIONAL BRAIN CUT+COLOR FLOW, Part 1b.
// Creates a DRAFT TARGET HairStateSnapshot for one owned client. Same
// zero-AI, zero-provider, shape-only-here discipline as current-state/
// route.ts -- see that file's own header.

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
    const snapshot = await createDraftTargetState(sessionUser.id, id, body.payload);
    return NextResponse.json({ snapshot }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
