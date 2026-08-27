import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  confirmProposal,
  findProposalForOwner,
  ProposalConcurrencyError,
  ProposalDependencyError,
  ProposalPersistenceError,
  ProposalStateError,
  ProposalValidationError,
} from "@/lib/proposal-repository";
import { isRecord } from "@/lib/proposal-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// The stated expected-version: exactly `null` or a non-empty string. An empty
// string, a number, an object, a boolean, or `undefined` are all rejected.
function isExpectedConfirmedIdValue(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

// AI Proposed Look (Phase 2), Stage 4 -- confirm a DRAFT proposal. The caller
// MUST explicitly state, via `expectedCurrentConfirmedProposalId` (string or
// null), what it last observed to be the authoritative CONFIRMED proposal for
// this triple; the route never defaults it. All optimistic-concurrency
// comparison happens inside confirmProposal -- this route only forwards the
// stated expectation and maps a ProposalConcurrencyError to a single, safe 409
// that leaks nothing about which proposal or owner won the race.

export async function POST(
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

  // The `expectedCurrentConfirmedProposalId` KEY must be present explicitly
  // (checked with `in`, so an omitted key is caught) and its value must be
  // exactly `null` or a non-empty string. Anything else -- key missing, number,
  // object, empty string, undefined -- is a 400. Never silently default to null.
  if (
    !isRecord(body) ||
    !("expectedCurrentConfirmedProposalId" in body) ||
    !isExpectedConfirmedIdValue(body.expectedCurrentConfirmedProposalId)
  ) {
    return NextResponse.json(
      { error: "expectedCurrentConfirmedProposalId (string or null) is required." },
      { status: 400 }
    );
  }
  const expectedCurrentConfirmedProposalId = body.expectedCurrentConfirmedProposalId;

  try {
    // confirmedByUserId is the same authenticated session user -- there is no
    // "confirm on behalf of someone else" concept in this domain.
    const confirmed = await confirmProposal(
      sessionUser.id,
      proposalId,
      sessionUser.id,
      expectedCurrentConfirmedProposalId
    );
    if (!confirmed) {
      return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    }
    return NextResponse.json({ proposal: confirmed }, { status: 200 });
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
      // SPECIAL CASE -- a deliberately different machine-readable code and a
      // fixed safe message, NOT the repository's own code/message. The text
      // below is complete and final; nothing about the winning proposal or
      // owner is ever appended.
      return NextResponse.json(
        {
          error: "ANALYSIS_PROPOSAL_CONFIRMATION_CONFLICT",
          message:
            "Another proposal was confirmed while this draft was open. Review the current confirmed proposal before replacing it.",
        },
        { status: 409 }
      );
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
