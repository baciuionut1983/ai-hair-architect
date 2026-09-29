import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { isRecord } from "@/lib/proposal-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { ProfessionalBrainAccessError, ProfessionalBrainStateError, confirmSnapshot } from "@/lib/professional-brain-orchestrator";
import {
  HairStateSnapshotConcurrencyError,
  HairStateSnapshotDependencyError,
  HairStateSnapshotPersistenceError,
  HairStateSnapshotStateError,
  HairStateSnapshotValidationError,
} from "@/lib/hair-state-snapshot-repository";

// AI Hair Architect, B2 -- PROFESSIONAL BRAIN CUT+COLOR FLOW, Part 1c.
// Confirms one DRAFT HairStateSnapshot (CURRENT or TARGET, role-agnostic
// -- confirmSnapshot itself resolves the role from the row) for one owned
// client. This IS the professional's real approval boundary for a
// snapshot -- mirrors analysis-proposals/[proposalId]/confirm/route.ts's
// own exact `expectedCurrentConfirmed<X>Id` stale-data-protection pattern:
// the caller MUST explicitly state which CONFIRMED snapshot (if any) it
// expects to replace; an omitted key is a 400, a mismatch at confirm time
// is a 409 (HairStateSnapshotConcurrencyError), never silently resolved
// either way.

function isExpectedConfirmedIdValue(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function mapError(error: unknown): Response {
  if (error instanceof ProfessionalBrainAccessError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof ProfessionalBrainStateError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof HairStateSnapshotConcurrencyError) {
    return NextResponse.json(
      { error: error.code, message: "This snapshot's confirmed state changed since you loaded it. Reload and try again." },
      { status: error.httpStatus },
    );
  }
  if (
    error instanceof HairStateSnapshotStateError ||
    error instanceof HairStateSnapshotValidationError ||
    error instanceof HairStateSnapshotDependencyError ||
    error instanceof HairStateSnapshotPersistenceError
  ) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  throw error;
}

export async function POST(request: Request, context: { params: Promise<{ id: string; snapshotId: string }> }) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, snapshotId } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isRecord(body) || !("expectedCurrentConfirmedSnapshotId" in body) || !isExpectedConfirmedIdValue(body.expectedCurrentConfirmedSnapshotId)) {
    return NextResponse.json({ error: "expectedCurrentConfirmedSnapshotId (string or null) is required." }, { status: 400 });
  }
  const expectedCurrentConfirmedSnapshotId = body.expectedCurrentConfirmedSnapshotId;

  try {
    const snapshot = await confirmSnapshot(sessionUser.id, id, snapshotId, expectedCurrentConfirmedSnapshotId);
    if (!snapshot) return NextResponse.json({ error: "Snapshot not found." }, { status: 404 });
    return NextResponse.json({ snapshot }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
