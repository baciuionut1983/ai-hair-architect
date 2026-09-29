import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import {
  ProfessionalBrainAccessError,
  ProfessionalBrainStateError,
  loadProfessionalBrainState,
  resolveEvaluationDomainIntent,
  selectCandidateSkillsForDomains,
} from "@/lib/professional-brain-orchestrator";
import { includesUnimplementedDomain } from "@/lib/professional-brain-domain-intent-contracts";
import { PROFESSIONAL_BRAIN_STYLING_GAP } from "@/lib/professional-brain-styling-gap";

// AI Hair Architect, B2 -- PROFESSIONAL BRAIN CUT+COLOR FLOW, Part 1d.
// Read-only. Reports the CURRENT/TARGET snapshots (whatever exists: none,
// DRAFT, or CONFIRMED) plus, ONLY once BOTH are CONFIRMED, the delta and
// candidate skills for exactly the domain(s) the professional selected
// (see resolveEvaluationDomainIntent's own header) via
// selectCandidateSkillsForDomains -- the exact same real Stage 4 modules
// the engine already uses, composed only for the requested domain(s),
// never re-derived here. `evaluation` is null until both snapshots are
// confirmed; this route NEVER calls Stage 5 reasoning, NEVER touches an
// execution/scene plan, and makes ZERO AI/provider calls -- the response
// intentionally stops at "delta + candidate skills" so the UI can render
// exactly where this flow ends.
//
// "CORECȚIE B2.2 ÎNAINTE DE RELEASE", requirement 2 -- STYLING has no
// engine. When the resolved domain intent includes it, this route NEVER
// calls selectCandidateSkillsForDomains at all (which would itself throw,
// defensively -- see that function's own header) -- it returns
// `stylingGap` (a real, static inventory of exactly what is missing, see
// professional-brain-styling-gap.ts) and leaves `evaluation` null, so the
// UI can render an honest "not yet possible" state instead of a
// fabricated or silently-partial result.

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
    const domainIntent = state.currentSnapshot ? resolveEvaluationDomainIntent(state.currentSnapshot) : null;
    const stylingBlocked = bothConfirmed && domainIntent !== null && includesUnimplementedDomain(domainIntent);
    const evaluation = bothConfirmed && !stylingBlocked ? await selectCandidateSkillsForDomains(sessionUser.id, id) : null;
    return NextResponse.json(
      {
        currentSnapshot: state.currentSnapshot,
        targetSnapshot: state.targetSnapshot,
        evaluation,
        stylingGap: stylingBlocked ? PROFESSIONAL_BRAIN_STYLING_GAP : null,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapError(error);
  }
}
