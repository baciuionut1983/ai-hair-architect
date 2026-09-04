import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { findProposalForOwner } from "@/lib/proposal-repository";
import {
  TechnicalDemonstrationConcurrencyError,
  TechnicalDemonstrationDependencyError,
  TechnicalDemonstrationInvariantError,
  TechnicalDemonstrationPersistenceError,
  TechnicalDemonstrationStateError,
  TechnicalDemonstrationValidationError,
  findCurrentConfirmedTechnicalDemonstrationPlan,
  listTechnicalDemonstrationStepsForPlan,
} from "@/lib/technical-demonstration-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Technical Demonstration, Stage 2 -- the current authoritative CONFIRMED
// plan for one owned (client, proposal) scope. Mirrors
// technical-visual-maps/current/route.ts exactly: `plan` may legitimately be
// null (the scope is valid, there simply is no confirmed plan yet) -- that
// is a 200, never a 404. Authority comes entirely from
// findCurrentConfirmedTechnicalDemonstrationPlan; this route never selects
// "latest" ad hoc. A TechnicalDemonstrationInvariantError (the "more than
// one CONFIRMED" impossible state, guarded by the Stage 1 partial unique
// index -- see schema comment) is never swallowed here.

export async function GET(_request: Request, context: { params: Promise<{ id: string; proposalId: string }> }) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, proposalId } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  try {
    const proposal = await findProposalForOwner(sessionUser.id, proposalId);
    if (!proposal || proposal.clientId !== id) {
      return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    }

    const plan = await findCurrentConfirmedTechnicalDemonstrationPlan(sessionUser.id, id, proposalId, proposal.vertical);
    const steps = plan ? await listTechnicalDemonstrationStepsForPlan(sessionUser.id, id, plan.id) : [];
    return NextResponse.json({ plan, steps }, { status: 200 });
  } catch (error) {
    if (error instanceof TechnicalDemonstrationDependencyError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof TechnicalDemonstrationStateError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof TechnicalDemonstrationValidationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof TechnicalDemonstrationConcurrencyError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof TechnicalDemonstrationInvariantError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof TechnicalDemonstrationPersistenceError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.httpStatus, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
