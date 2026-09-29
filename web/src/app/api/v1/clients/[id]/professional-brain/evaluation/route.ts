import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import {
  ProfessionalBrainAccessError,
  ProfessionalBrainStateError,
  loadProfessionalBrainState,
  selectMultiDomainCandidateSkills,
} from "@/lib/professional-brain-orchestrator";

// AI Hair Architect, B2 -- PROFESSIONAL BRAIN CUT+COLOR FLOW, Part 1d.
// Read-only. Reports the CURRENT/TARGET snapshots (whatever exists: none,
// DRAFT, or CONFIRMED) plus, ONLY once BOTH are CONFIRMED, the merged
// CUT+COLOR delta and candidate skills via selectMultiDomainCandidateSkills
// (B1) -- the exact same real Stage 4 modules the engine already uses,
// composed, never re-derived here. `evaluation` is null until both
// snapshots are confirmed; this route NEVER calls Stage 5 reasoning, NEVER
// touches an execution/scene plan, and makes ZERO AI/provider calls --
// the response intentionally stops at "delta + candidate skills" so the
// UI can render exactly where this flow ends.

function mapError(error: unknown): Response {
  if (error instanceof ProfessionalBrainAccessError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof ProfessionalBrainStateError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  throw error;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  try {
    const state = await loadProfessionalBrainState(sessionUser.id, id);
    const bothConfirmed = state.currentSnapshot?.status === "CONFIRMED" && state.targetSnapshot?.status === "CONFIRMED";
    const evaluation = bothConfirmed ? await selectMultiDomainCandidateSkills(sessionUser.id, id) : null;
    return NextResponse.json(
      { currentSnapshot: state.currentSnapshot, targetSnapshot: state.targetSnapshot, evaluation },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapError(error);
  }
}
