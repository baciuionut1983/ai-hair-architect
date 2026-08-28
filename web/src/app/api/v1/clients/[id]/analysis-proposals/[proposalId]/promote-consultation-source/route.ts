import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  findConsultationMessageForOwner,
  isConsultationMessagePersistenceError,
} from "@/lib/consultation-message-repository";
import {
  findProposalForOwner,
  promoteConsultationSourceToDraft,
  ProposalConcurrencyError,
  ProposalDependencyError,
  ProposalPersistenceError,
  ProposalStateError,
  ProposalValidationError,
} from "@/lib/proposal-repository";
import { isRecord } from "@/lib/proposal-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// AI Proposed Look (Phase 2), Stage 5 -- "Use in Proposed Look". Attaches one
// explicitly-promoted Consult AI source (a structured proposedMemory
// candidate, never raw chat prose, never a proposedCorrection -- see the
// doc comment on isEligibleProposedMemory below) to a DRAFT's provenance.
// This route never mutates Analysis, never touches ProfessionalMemory, and
// promotion itself is never a confirmation -- it only calls
// promoteConsultationSourceToDraft, the same DRAFT-only, idempotent
// repository function every other mutation on this tree already uses this
// shape of guard for.

// Only a message whose `proposedMemory` is a real, structurally valid
// { action, content, reason } candidate is eligible. `action` is NOT
// validated against MEMORY_PROPOSAL_ACTIONS here -- that vocabulary belongs
// to the separate memory-confirmation path, not this one; only `content`
// presence matters for a promotable snapshot. A message carrying only a
// proposedCorrection (an Analysis EVIDENCE correction -- see
// ConsultationChatProposedCorrection's own field enum, doubly constrained to
// CORRECTABLE_ANALYSIS_FIELDS by Gemini's schema and a second server-side
// check) is never eligible: evidence corrections stay exclusively on the
// existing Apply/AnalysisCorrection path.
function isEligibleProposedMemory(value: unknown): value is { action: string; content: string; reason?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).content === "string" &&
    ((value as Record<string, unknown>).content as string).trim().length > 0
  );
}

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

  if (!isRecord(body) || typeof body.consultationMessageId !== "string" || body.consultationMessageId.length === 0) {
    return NextResponse.json({ error: "consultationMessageId (string) is required." }, { status: 400 });
  }
  const consultationMessageId = body.consultationMessageId;

  let message;
  try {
    message = await findConsultationMessageForOwner(sessionUser.id, id, consultationMessageId);
  } catch (error) {
    if (isConsultationMessagePersistenceError(error)) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.httpStatus, headers: { "Cache-Control": "no-store" } }
      );
    }
    throw error;
  }

  // One identical 404 for a nonexistent id, a foreign owner, or a foreign
  // client -- the message id can never be used as a cross-client discovery
  // oracle.
  if (!message) {
    return NextResponse.json({ error: "Consultation message not found." }, { status: 404 });
  }

  if (!isEligibleProposedMemory(message.proposedMemory)) {
    return NextResponse.json(
      {
        error: "CONSULTATION_MESSAGE_NOT_ELIGIBLE",
        message: "This message has no structured content that can be used in a Proposed Look.",
      },
      { status: 422 }
    );
  }

  const reason = message.proposedMemory.reason?.trim();
  const snapshotContent = reason
    ? `${message.proposedMemory.content} — ${reason}`
    : message.proposedMemory.content;
  const promotedAt = new Date().toISOString();

  try {
    const updated = await promoteConsultationSourceToDraft(sessionUser.id, proposalId, {
      consultationMessageId: message.id,
      snapshotContent,
      promotedAt,
    });
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
