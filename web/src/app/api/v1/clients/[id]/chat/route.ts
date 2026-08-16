import { NextResponse } from "next/server";

import type { ConsultationChatRequest, ConsultationChatResponse, ConsultationMessageRecord } from "@/lib/contracts";
import { resolveOwnedClient } from "@/lib/client-repository";
import {
  CONSULTATION_CHAT_RESULT_HTTP_STATUS,
  sendConsultationMessage,
} from "@/lib/consultation-chat-service";
import {
  isConsultationMessagePersistenceError,
  listRecentConsultationMessages,
} from "@/lib/consultation-message-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { checkRateLimit, ensureRequestId } from "@/lib/hardening";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  try {
    const messages = await listRecentConsultationMessages(sessionUser.id, id, 30);
    const records: ConsultationMessageRecord[] = messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      ...(isProposedCorrection(m.proposedCorrection) ? { proposedCorrection: m.proposedCorrection } : {}),
      ...(isProposedMemory(m.proposedMemory) ? { proposedMemory: m.proposedMemory } : {}),
      ...(m.proposedMemoryDecision ? { proposedMemoryDecision: m.proposedMemoryDecision } : {})
    }));
    return NextResponse.json({ messages: records }, { status: 200 });
  } catch (error) {
    if (isConsultationMessagePersistenceError(error)) {
      return NextResponse.json(
        { error: "CONSULTATION_MESSAGE_PERSISTENCE_UNAVAILABLE", message: "Conversation data is temporarily unavailable." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    throw error;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`consultation-chat:${sessionUser.id}`, 30, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  ensureRequestId(request.headers.get("x-request-id"));

  const { id } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const body = (await request.json()) as Partial<ConsultationChatRequest> & {
    analysisId?: string;
    // The conversation's own "Language: Auto / English / Romanian"
    // selector state -- a concrete value (not "auto"/absent) means the
    // stylist explicitly fixed the language, which forces the reply.
    languagePreference?: string;
    // The conversation's own currently-established language (set by prior
    // per-message detection on the frontend), sent only when the selector
    // is "auto" -- a soft fallback for a genuinely ambiguous message, never
    // a forced override.
    conversationLanguage?: string;
  };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const analysisId = typeof body.analysisId === "string" && body.analysisId.trim() ? body.analysisId.trim() : undefined;

  if (!message) {
    return NextResponse.json({ error: "message is required." }, { status: 400 });
  }

  const forcedReplyLanguage = toLocaleOrUndefined(body.languagePreference);
  // Ambiguous-message fallback only, never a forced override (see
  // ConsultationChatLanguageHint): the conversation's own established
  // language first, then the stylist's account locale as a last resort --
  // this must NEVER be promoted to `forced`, or a Romanian UI/account
  // setting would force Romanian replies onto a conversation held in a
  // different language, which is explicitly disallowed.
  const fallbackReplyLanguage = toLocaleOrUndefined(body.conversationLanguage) ?? sessionUser.locale;

  const result = await sendConsultationMessage(sessionUser.id, client, message, analysisId, {}, {
    forced: forcedReplyLanguage,
    fallback: fallbackReplyLanguage,
  });

  if (result.outcome === "failed") {
    return NextResponse.json(
      { error: result.code },
      { status: CONSULTATION_CHAT_RESULT_HTTP_STATUS[result.code] }
    );
  }

  const response: ConsultationChatResponse = {
    reply: {
      id: result.reply.id,
      role: "assistant",
      content: result.reply.content,
      createdAt: result.reply.createdAt,
      ...(isProposedCorrection(result.reply.proposedCorrection)
        ? { proposedCorrection: result.reply.proposedCorrection }
        : {}),
      ...(isProposedMemory(result.reply.proposedMemory)
        ? { proposedMemory: result.reply.proposedMemory }
        : {}),
      ...(result.replyLanguage ? { replyLanguage: result.replyLanguage } : {})
    },
    needsClarification: result.needsClarification
  };

  return NextResponse.json(response, { status: 200 });
}

function isProposedCorrection(value: unknown): value is ConsultationChatResponse["reply"]["proposedCorrection"] {
  return (
    typeof value === "object" &&
    value !== null &&
    "field" in value &&
    "value" in value &&
    "reason" in value &&
    "source" in value
  );
}

function isProposedMemory(value: unknown): value is ConsultationChatResponse["reply"]["proposedMemory"] {
  return (
    typeof value === "object" &&
    value !== null &&
    "action" in value &&
    "content" in value &&
    "reason" in value
  );
}

function toLocaleOrUndefined(value: string | undefined): "en" | "ro" | undefined {
  return value === "en" || value === "ro" ? value : undefined;
}
