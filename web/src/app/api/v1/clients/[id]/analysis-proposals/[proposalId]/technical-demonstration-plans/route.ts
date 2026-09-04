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
  createTechnicalDemonstrationPlanFromProposal,
  listTechnicalDemonstrationPlansForProposal,
  resolveEffectiveCuttingStepsForRecord,
} from "@/lib/technical-demonstration-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Technical Demonstration, Stage 2 -- the owner-scoped HTTP surface over the
// already-complete Stage 1 domain layer. Mirrors
// technical-visual-maps/route.ts exactly: this file only authenticates,
// resolves ownership, calls the domain layer, and maps its typed outcomes to
// HTTP -- lifecycle, derivation, and idempotency all live in
// technical-demonstration-repository.ts / -derivation.ts and are only called
// from here, never re-implemented.

function mapDomainError(error: unknown): Response {
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

// GET -- version history for this exact owned (client, proposal) scope,
// newest planVersion first. Requires the proposal to genuinely belong to
// this client, same generic "Proposal not found." 404 every sibling route in
// this domain already uses -- a proposal id can never be used as a
// cross-client / cross-owner discovery oracle.
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

    const plans = await listTechnicalDemonstrationPlansForProposal(sessionUser.id, id, proposalId, proposal.vertical);
    return NextResponse.json({ plans }, { status: 200 });
  } catch (error) {
    return mapDomainError(error);
  }
}

// POST -- derive (or idempotently reopen) a Technical Demonstration Plan
// from the exact owned CONFIRMED proposal identified by the URL alone.
// Deliberately reads NO request body -- exactly like
// technical-visual-maps/route.ts's own POST, there is structurally nothing
// for a caller to inject: every field is derived server-side
// (technical-demonstration-derivation.ts) or allocated by the repository
// (planVersion, requestFingerprint). Never derives from a non-CONFIRMED
// proposal -- createTechnicalDemonstrationPlanFromProposal itself enforces
// this and is never bypassed here.
export async function POST(_request: Request, context: { params: Promise<{ id: string; proposalId: string }> }) {
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
    const outcome = await createTechnicalDemonstrationPlanFromProposal(sessionUser.id, id, proposalId);
    // A freshly-derived (or idempotently-reopened) plan may already carry
    // real professionalOverrides on the reopen path -- resolve effective
    // here too, rather than assuming "just derived" always means "no
    // overrides yet".
    const effectiveSteps = resolveEffectiveCuttingStepsForRecord(outcome.plan, outcome.steps);
    return NextResponse.json(
      { plan: outcome.plan, steps: outcome.steps, effectiveSteps, created: outcome.created },
      { status: outcome.created ? 201 : 200 },
    );
  } catch (error) {
    return mapDomainError(error);
  }
}
