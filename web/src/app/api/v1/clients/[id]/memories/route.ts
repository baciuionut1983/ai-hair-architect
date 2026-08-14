import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { checkRateLimit } from "@/lib/hardening";
import {
  createConfirmedMemory,
  isMemoryProposalAction,
  isProfessionalMemoryPersistenceError,
  MEMORY_PROPOSAL_ACTIONS,
  professionalMemoryPersistenceUnavailableResponse,
  ProfessionalMemoryValidationError,
  revokeMemory,
} from "@/lib/professional-memory-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import type { ProfessionalMemorySource } from "@prisma/client";

const MAX_MEMORY_CONTENT_LENGTH = 4000;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`professional-memory:${user.id}`, 20, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { id } = await context.params;
  const client = await resolveOwnedClient(user.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const body = (await request.json()) as {
    action?: string;
    content?: string;
    confirmed?: boolean;
    transcriptId?: string;
    sourceMessageId?: string;
  };
  const actionConfig = body.action && isMemoryProposalAction(body.action) ? MEMORY_PROPOSAL_ACTIONS[body.action] : undefined;
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!actionConfig || !content || content.length > MAX_MEMORY_CONTENT_LENGTH) {
    return NextResponse.json({ error: "Invalid memory request." }, { status: 400 });
  }
  // The explicit-confirm gate: nothing in this route ever persists memory
  // without the caller asserting confirmed === true. The stylist has
  // already seen and approved this exact content before this request is
  // ever sent -- see TeachAiPanel's window.confirm before calling save(),
  // and ConsultationChat's Confirm button on a proposed-memory card.
  if (body.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required to save this as memory." }, { status: 409 });
  }

  const transcriptId = typeof body.transcriptId === "string" && body.transcriptId.trim() ? body.transcriptId.trim() : undefined;
  const sourceMessageId = typeof body.sourceMessageId === "string" && body.sourceMessageId.trim() ? body.sourceMessageId.trim() : undefined;
  // outcome_feedback is its own source regardless of channel (a result
  // being logged, not a note being typed/spoken/proposed); otherwise the
  // channel that produced the content -- voice transcript, an AI-proposed
  // chat candidate the stylist confirmed, or plain typing -- is what's
  // recorded as the source.
  const source: ProfessionalMemorySource =
    actionConfig.kind === "outcome" ? "outcome_feedback" : transcriptId ? "voice_transcript" : "typed";

  try {
    const memory = await createConfirmedMemory({
      ownerUserId: user.id,
      ...(actionConfig.scope === "client_specific" ? { clientId: id } : {}),
      scope: actionConfig.scope,
      kind: actionConfig.kind,
      source,
      content,
      provenance: {
        channel: transcriptId ? "voice" : sourceMessageId ? "chat" : "text",
        transcriptId: transcriptId ?? null,
        sourceMessageId: sourceMessageId ?? null,
        explicitAction: body.action,
      },
    });
    return NextResponse.json({ memory }, { status: 201 });
  } catch (error) {
    if (error instanceof ProfessionalMemoryValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (isProfessionalMemoryPersistenceError(error)) {
      return professionalMemoryPersistenceUnavailableResponse();
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memoryId = new URL(request.url).searchParams.get("memoryId");
  if (!memoryId) {
    return NextResponse.json({ error: "memoryId is required." }, { status: 400 });
  }

  try {
    const revoked = await revokeMemory(user.id, memoryId);
    return revoked
      ? NextResponse.json({ revoked: true })
      : NextResponse.json({ error: "Memory not found." }, { status: 404 });
  } catch (error) {
    if (isProfessionalMemoryPersistenceError(error)) {
      return professionalMemoryPersistenceUnavailableResponse();
    }
    throw error;
  }
}
