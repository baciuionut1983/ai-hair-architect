import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  editDraftProposal,
  findProposalForOwner,
  ProposalConcurrencyError,
  ProposalDependencyError,
  ProposalPersistenceError,
  ProposalStateError,
  ProposalValidationError,
} from "@/lib/proposal-repository";
import { isRecord, type ProposalEditEntry } from "@/lib/proposal-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// AI Proposed Look (Phase 2), Stage 4 -- read one proposal (GET) and append
// provenance to a DRAFT (PATCH). Both first resolve the proposal AND verify it
// belongs to THIS exact client, using one generic "Proposal not found." (404)
// for every not-found cause (nonexistent id, foreign owner, foreign client) so
// a proposal id can never be used as a cross-client / cross-owner discovery
// oracle.

export async function GET(
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

  return NextResponse.json({ proposal }, { status: 200 });
}

export async function PATCH(
  request: Request,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Route-level shape check only -- each edit entry is validated by
  // editDraftProposal itself (isProposalEditEntry). Do not hand-validate the
  // entries here.
  if (!isRecord(body) || !Array.isArray(body.edits) || body.edits.length === 0) {
    return NextResponse.json({ error: "edits must be a non-empty array." }, { status: 400 });
  }
  const edits = body.edits as ProposalEditEntry[];

  try {
    const updated = await editDraftProposal(sessionUser.id, proposalId, edits);
    if (!updated) {
      return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    }
    return NextResponse.json({ proposal: updated }, { status: 200 });
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
