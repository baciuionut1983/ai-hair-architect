import { NextResponse } from "next/server";

import type { ConsultationChatRequest, ConsultationChatResponse, ConsultationMessageRecord } from "@/lib/contracts";
import { isConversationLanguageCode, type LanguageCode } from "@/lib/language-registry";
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
    // End-to-end voice turn correlation (2026-08-19): when this message
    // originated from a voice-initiated turn, the client sends the SAME id
    // already used for STT (use-voice-recording.ts's own attemptId) --
    // never a new, independently-generated id. Absent for a typed
    // message.
    voiceTurnId?: string;
  };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const analysisId = typeof body.analysisId === "string" && body.analysisId.trim() ? body.analysisId.trim() : undefined;
  // Same defensive posture as voice-transcript/route.ts's own attemptId
  // handling -- a malformed/missing value simply means "no voice turn"
  // (a typed message), never trusted blindly as a raw string beyond a
  // safe charset/length cap, and never invented when absent.
  const voiceTurnId =
    typeof body.voiceTurnId === "string" && /^[A-Za-z0-9-]{1,100}$/.test(body.voiceTurnId) ? body.voiceTurnId : undefined;

  if (!message) {
    return NextResponse.json({ error: "message is required." }, { status: 400 });
  }

  const forcedReplyLanguage = toConversationLanguageOrUndefined(body.languagePreference);
  // Ambiguous-message fallback only, never a forced override (see
  // ConsultationChatLanguageHint): the conversation's own established
  // language first, then the stylist's account locale as a last resort --
  // this must NEVER be promoted to `forced`, or a Romanian UI/account
  // setting would force Romanian replies onto a conversation held in a
  // different language, which is explicitly disallowed. The account
  // locale itself is validated too -- it's the full LanguageCode registry
  // (any of the world languages a stylist could pick for their account),
  // but only a conversation-capable one is usable as an AI-reply fallback.
  const fallbackReplyLanguage =
    toConversationLanguageOrUndefined(body.conversationLanguage) ?? toConversationLanguageOrUndefined(sessionUser.locale);

  const result = await sendConsultationMessage(
    sessionUser.id,
    client,
    message,
    analysisId,
    {},
    {
      forced: forcedReplyLanguage,
      fallback: fallbackReplyLanguage,
    },
    voiceTurnId,
  );

  if (result.outcome === "failed") {
    return NextResponse.json(
      {
        error: result.code,
        // Production observability follow-up (2026-08-19): providerAttemptCount
        // lets a voice-initiated caller report a real terminal diagnostic
        // (see voice-latency-logic.ts) even on failure -- omitted entirely
        // (not a fabricated 1) when the failure never reached the provider
        // call stage at all (e.g. a config/persistence failure).
        ...(result.providerAttemptCount ? { providerAttemptCount: result.providerAttemptCount } : {}),
        // Consult AI 404/PROVIDER_UNAVAILABLE root-cause diagnosis
        // (2026-08-21): mirrors voice-transcript/route.ts's own
        // providerHttpStatus/providerErrorStatus/providerErrorMessage
        // exactly -- see ChatProviderError's own doc comment.
        ...(result.providerHttpStatus !== undefined ? { providerHttpStatus: result.providerHttpStatus } : {}),
        ...(result.providerErrorStatus !== undefined ? { providerErrorStatus: result.providerErrorStatus } : {}),
        ...(result.providerErrorMessage !== undefined ? { providerErrorMessage: result.providerErrorMessage } : {}),
      },
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
    needsClarification: result.needsClarification,
    providerLatencyMs: result.providerLatencyMs,
    providerAttemptCount: result.providerAttemptCount,
    preProviderReadsMs: result.preProviderReadsMs,
    replyWriteMs: result.replyWriteMs,
    failedFirstAttemptMs: result.failedFirstAttemptMs,
    serverTotalMs: result.serverTotalMs,
    unattributedMs: result.unattributedMs
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

function toConversationLanguageOrUndefined(value: string | undefined): LanguageCode | undefined {
  return value && isConversationLanguageCode(value) ? value : undefined;
}
