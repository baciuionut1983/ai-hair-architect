import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  findProposalForOwner,
  ProposalConcurrencyError,
  ProposalDependencyError,
  ProposalPersistenceError,
  ProposalStateError,
  ProposalValidationError,
  rejectProposal,
} from "@/lib/proposal-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// AI Proposed Look (Phase 2), Stage 4 -- reject a DRAFT proposal. No request
// body is expected or parsed. The DRAFT -> REJECTED transition and every other
// state-machine rule are enforced by rejectProposal; a non-DRAFT target surfaces
// as ProposalStateError (409) here.

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; proposalId: string }> }
) {
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

  const proposal = await findProposalForOwner(sessionUser.id, proposalId);
  if (!proposal || proposal.clientId !== id) {
    return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  }

  try {
    const rejected = await rejectProposal(sessionUser.id, proposalId);
    if (!rejected) {
      return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    }
    return NextResponse.json({ proposal: rejected }, { status: 200 });
  } catch (error) {
    if (error instanceof ProposalDependencyError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProposalStateError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProposalValidationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProposalConcurrencyError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProposalPersistenceError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.httpStatus, headers: { "Cache-Control": "no-store" } }
      );
    }
    throw error;
  }
}
