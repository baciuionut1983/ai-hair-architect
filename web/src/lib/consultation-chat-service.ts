import { randomUUID } from "crypto";

import type { AnalysisState } from "@/lib/milestone2-types";
import { findAnalysisForOwner, findLatestAnalysisForClient } from "@/lib/analysis-repository";
import { recordAiUsageEvent } from "@/lib/ai-usage-repository";
import type { AiUsageQuantities } from "@/lib/ai-usage-contracts";
import type { ClientRecord } from "@/lib/contracts";
import {
  listRecentConsultationMessages,
  recordConsultationMessage,
  type ConsultationMessageRow,
} from "@/lib/consultation-message-repository";
import { GeminiConsultationChatProvider } from "@/lib/consultation-chat-provider-gemini";
import type { ChatProviderError, ConsultationChatContext, ConsultationChatProvider } from "@/lib/consultation-chat-provider";
import { resolveImageAnalysisProviderConfig } from "@/lib/image-analysis-provider-config";
import { retrieveRelevantMemories } from "@/lib/professional-memory-repository";
import { buildClientProfessionalMemory } from "@/lib/consultation-client-context";
import { detectMessageLanguage } from "@/lib/message-language-detector";
import type { LanguageCode } from "@/lib/language-registry";

export type ConsultationChatResultCode =
  | "PROCESSING_DISABLED"
  | "PROVIDER_CONFIGURATION_INVALID"
  | "ANALYSIS_NOT_FOUND"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_AUTHENTICATION_FAILURE"
  | "MALFORMED_PROVIDER_RESPONSE"
  | "PERSISTENCE_FAILURE"
  | "INTERNAL_PROCESSING_FAILURE";

export const CONSULTATION_CHAT_RESULT_HTTP_STATUS: Record<ConsultationChatResultCode, number> = {
  PROCESSING_DISABLED: 503,
  PROVIDER_CONFIGURATION_INVALID: 503,
  ANALYSIS_NOT_FOUND: 404,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_AUTHENTICATION_FAILURE: 502,
  MALFORMED_PROVIDER_RESPONSE: 502,
  PERSISTENCE_FAILURE: 500,
  INTERNAL_PROCESSING_FAILURE: 500,
};

export type SendConsultationMessageResult =
  | {
      outcome: "succeeded";
      reply: ConsultationMessageRow;
      needsClarification: boolean;
      // The ONE canonical language decision for this exact reply -- forced
      // selection, else Gemini's own self-reported replyLanguageCode (see
      // consultation-chat-provider.ts's ConsultationChatResult -- the
      // model's own multilingual understanding, far more reliable than a
      // hand-rolled detector for arbitrary registry languages), else the
      // local detectMessageLanguage fallback (also what the frontend's TTS
      // locale mapping wraps, see consultation-chat-tts-logic.ts), else the
      // soft account fallback. Computed here, once, so the AI's reply
      // language and the voice that reads it aloud can never independently
      // disagree. null only when truly nothing was available.
      replyLanguage: LanguageCode | null;
      // Voice latency audit (2026-08-18): the real, measured duration of
      // just the provider.respond() call below -- the SAME number AI Usage
      // Metering's own latencyMs already computes, reused rather than a
      // second measurement. Reflects whichever attempt (1 or 2) actually
      // succeeded -- never the first, superseded attempt's timing, if a
      // retry happened.
      providerLatencyMs: number;
      // Consultation reliability hardening (2026-08-19): 1 when the first
      // attempt succeeded outright, 2 when a transient failure was
      // recovered by the single automatic retry -- surfaced so callers
      // (voice latency telemetry) can report real provider-attempt counts
      // rather than assuming every turn is exactly one call.
      providerAttemptCount: 1 | 2;
    }
  | {
      outcome: "failed";
      code: ConsultationChatResultCode;
      // Only populated when the failure happened at the provider_call
      // stage (undefined for config/persistence failures, where an
      // "attempt count" isn't a meaningful concept) -- same reasoning as
      // providerAttemptCount above.
      providerAttemptCount?: 1 | 2;
    };

export interface SendConsultationMessageDependencies {
  env?: Readonly<Record<string, string | undefined>>;
  createProvider?: (config: { apiKey: string; model: string }) => ConsultationChatProvider;
  now?: () => Date;
  // AI Usage & Cost Metering Phase 1: injectable like createProvider, so
  // tests never need a real database connection just because this
  // function now also records usage -- defaults to the real,
  // never-throwing recorder.
  recordAiUsageEvent?: typeof recordAiUsageEvent;
}

// Mirrors ConsultationChatContext's forcedReplyLanguage/fallbackReplyLanguage
// split one level up, at the service boundary -- forced is the stylist's own
// explicit, non-"auto" language selection (always wins); fallback is used
// only when the message itself is too ambiguous to tell, and is never a hard
// override (so a Romanian UI/account locale can never force a reply
// language on its own -- see the route for where this is populated).
export interface ConsultationChatLanguageHint {
  forced?: LanguageCode;
  fallback?: LanguageCode;
}

/**
 * Orchestrates one turn of the Conversational Professional AI: persists the
 * stylist's message first (so it is never lost even if the provider call
 * fails), gathers the real structured context (current Analysis, if any --
 * never fabricated), calls the real provider, then persists the assistant's
 * reply. The provider's proposedCorrection (if any) is persisted alongside
 * the reply as a SUGGESTION only -- applying it always requires a separate,
 * explicit call to POST /api/v1/analysis/{id}/correct. This function never
 * calls applyAnalysisCorrection itself.
 */
export async function sendConsultationMessage(
  ownerUserId: string,
  client: ClientRecord,
  message: string,
  analysisId: string | undefined,
  dependencies: SendConsultationMessageDependencies = {},
  languageHint: ConsultationChatLanguageHint = {},
  // End-to-end voice turn correlation (2026-08-19): when this call
  // originated from a voice-initiated turn, the caller (chat/route.ts)
  // passes the SAME id already used for STT (use-voice-recording.ts's
  // attemptId) -- never a new, independently-generated id, so a single
  // stylist-reported incident can be found across STT, Consult AI, and
  // TTS's own logs by this one value. undefined for a typed message (no
  // voice turn exists) -- included in structured logs only, never in the
  // AI Usage Metering correlationId (see usageCorrelationId below, which
  // stays a fresh id per real provider call -- reusing voiceTurnId there
  // would collide across modalities and silently drop usage rows under
  // AiUsageEvent's own idempotencyKey uniqueness).
  voiceTurnId?: string,
): Promise<SendConsultationMessageResult> {
  const startedAt = (dependencies.now ?? (() => new Date()))().getTime();

  try {
    const env = dependencies.env ?? process.env;
    const config = resolveImageAnalysisProviderConfig(env);
    if (config.status === "disabled") {
      // Distinct from "invalid" -- disabled means AI_ANALYSIS_PROVIDER is
      // simply unset, a deliberate/expected state (e.g. a preview
      // environment), not a misconfiguration. No issue codes to log.
      logConsultationChatFailure({
        stage: "config_check",
        resultCode: "PROCESSING_DISABLED",
        ownerUserId,
        clientId: client.id,
        analysisId,
        durationMs: Date.now() - startedAt,
        voiceTurnId,
      });
      return failure("PROCESSING_DISABLED");
    }
    if (config.status === "invalid") {
      logConsultationChatFailure({
        stage: "config_check",
        resultCode: "PROVIDER_CONFIGURATION_INVALID",
        ownerUserId,
        clientId: client.id,
        analysisId,
        durationMs: Date.now() - startedAt,
        voiceTurnId,
        // Safe: only the env variable NAME and a fixed issue code (e.g.
        // "AI_ANALYSIS_API_KEY_REQUIRED") -- never the variable's value.
        configIssueCodes: config.issues.map((issue) => issue.code).join(","),
      });
      return failure("PROVIDER_CONFIGURATION_INVALID");
    }

    // Consultation instrumentation fix (2026-08-19): a real production
    // report showed CONSULTATION_CHAT taking 15-30s total while all three
    // provider legs (STT/Consultation/TTS) reported succeeding on the
    // first attempt -- proving the SLOWNESS wasn't a retry, but the
    // returned providerLatencyMs field itself was measured incorrectly:
    // it was computed at the function's own return statement, AFTER the
    // assistant reply's DB write had already run, silently folding that
    // write's time into a field whose name promises pure provider
    // latency. These marks fix that (readsStartedAt below, plus
    // providerOnlyMs/replyWriteStartedAt further down) and additionally
    // expose the reads-before-provider and reply-write windows as their
    // own named durations, purely as instrumentation -- no retry,
    // metering, model, ordering, or persistence behavior changes here.
    const readsStartedAt = Date.now();

    // Voice latency audit (2026-08-18): the analysis lookup and the prior-
    // messages read are independent of each other (neither's inputs depend
    // on the other's result) -- started here, together, so their real I/O
    // overlaps instead of running fully serially, then awaited below in
    // the SAME order/try-catch structure as before, preserving each
    // operation's own failure-stage log attribution exactly. The stylist
    // message write intentionally still waits for analysis validation to
    // pass first (see below) -- it must never be persisted for a request
    // that gets rejected as ANALYSIS_NOT_FOUND, unlike these two reads,
    // whose result is simply discarded on an early return.
    const analysisPromise = analysisId
      ? findAnalysisForOwner(ownerUserId, analysisId)
      : // No explicit analysisId (Consult AI opened from the client page,
        // not a specific analysis page) -- auto-resolve the client's own
        // most recent analysis so the AI has real baseline context without
        // the stylist having to re-describe a hair profile the platform
        // already has on file. null here is a legitimate, honest "this
        // client has no analysis yet", not an error.
        findLatestAnalysisForClient(ownerUserId, client.id);
    const priorMessagesPromise = listRecentConsultationMessages(ownerUserId, client.id, 10);
    // Node treats a promise rejection with no attached handler as an
    // unhandled rejection the moment it rejects -- even if the SAME
    // promise is later properly awaited in a try/catch below. Without
    // this, an analysis-lookup failure that causes an early return before
    // priorMessagesPromise is ever awaited (or vice versa) would log a
    // spurious unhandled-rejection warning for the one that was never
    // reached. This no-op handler only marks the rejection "observed";
    // the real error handling still happens at each await below.
    analysisPromise.catch(() => {});
    priorMessagesPromise.catch(() => {});

    let analysis: AnalysisState | null = null;
    try {
      analysis = await analysisPromise;
    } catch {
      logConsultationChatFailure({
        stage: "analysis_lookup",
        resultCode: "PERSISTENCE_FAILURE",
        ownerUserId,
        clientId: client.id,
        analysisId,
        durationMs: Date.now() - startedAt,
        voiceTurnId,
      });
      return failure("PERSISTENCE_FAILURE");
    }
    if (analysisId && (!analysis || analysis.clientId !== client.id)) {
      return failure("ANALYSIS_NOT_FOUND");
    }

    let priorMessages;
    try {
      priorMessages = await priorMessagesPromise;
    } catch {
      logConsultationChatFailure({
        stage: "history_read",
        resultCode: "PERSISTENCE_FAILURE",
        ownerUserId,
        clientId: client.id,
        analysisId,
        durationMs: Date.now() - startedAt,
        voiceTurnId,
      });
      return failure("PERSISTENCE_FAILURE");
    }
    const firstReadsCompletedAt = Date.now();

    let stored;
    try {
      stored = await recordConsultationMessage({
        ownerUserId,
        clientId: client.id,
        analysisId: analysisId ?? null,
        role: "stylist",
        content: message,
      });
    } catch {
      logConsultationChatFailure({
        stage: "stylist_message_write",
        resultCode: "PERSISTENCE_FAILURE",
        ownerUserId,
        clientId: client.id,
        analysisId,
        durationMs: Date.now() - startedAt,
        voiceTurnId,
      });
      return failure("PERSISTENCE_FAILURE");
    }

    const createProvider = dependencies.createProvider ?? defaultCreateProvider;
    const provider = createProvider({ apiKey: config.apiKey, model: config.model });
    // Consultation reliability hardening (2026-08-19): mirrors STT_FALLBACK_MODEL
    // exactly (see voice-transcript/route.ts's own comment) -- unset by
    // default, never invented; only ever used for the single automatic
    // retry below, never the first attempt. An operator can point retries
    // at a different, hopefully-healthier model without a code change; if
    // unset (the default), the retry simply reuses the same provider/model
    // as the first attempt, exactly like STT's own retry does when
    // STT_FALLBACK_MODEL is unset.
    const fallbackModel = env.CONSULTATION_CHAT_FALLBACK_MODEL;
    const retryProvider =
      fallbackModel && fallbackModel.trim().length > 0 && fallbackModel !== config.model
        ? createProvider({ apiKey: config.apiKey, model: fallbackModel })
        : provider;
    const recordUsage = dependencies.recordAiUsageEvent ?? recordAiUsageEvent;

    const memoryReadStartedAt = Date.now();
    let memories: Awaited<ReturnType<typeof retrieveRelevantMemories>>;
    let clientMemory: Awaited<ReturnType<typeof buildClientProfessionalMemory>>;
    try {
      [memories, clientMemory] = await Promise.all([
        retrieveRelevantMemories(ownerUserId, client.id, message),
        buildClientProfessionalMemory(ownerUserId, client.id, analysis?.id ?? null),
      ]);
    } catch {
      logConsultationChatFailure({
        stage: "professional_memory_read",
        resultCode: "PERSISTENCE_FAILURE",
        ownerUserId,
        clientId: client.id,
        analysisId,
        durationMs: Date.now() - startedAt,
        voiceTurnId,
      });
      return failure("PERSISTENCE_FAILURE");
    }
    const memoryReadCompletedAt = Date.now();
    // Pure reads needed to build the provider's context -- the analysis
    // lookup + prior-messages read (overlapped, see above) plus the
    // professional-memory read (also overlapped internally), EXCLUDING
    // the stylist message write sitting between them in real execution
    // order (that write is a real, separate cost, folded into
    // unattributedMs below rather than a 6th named field -- see this
    // round's own scope).
    const preProviderReadsMs = (firstReadsCompletedAt - readsStartedAt) + (memoryReadCompletedAt - memoryReadStartedAt);

    const context = buildChatContext(client, analysis, priorMessages, memories, clientMemory, languageHint);

    const controller = new AbortController();
    // AI Usage & Cost Metering Phase 1: one correlationId per logical send
    // attempt, shared by every attempt's success/failure recording call
    // below (each real provider call still gets its own, correctly
    // distinct row via attemptNumber -- see recordAttempt below, mirroring
    // voice-transcript/route.ts's own attemptId+attemptNumber scheme
    // exactly). Deliberately NOT voiceTurnId -- see this function's own
    // parameter doc comment for why reusing that here would collide
    // across STT/Consultation/TTS's separate metering namespaces.
    const usageCorrelationId = randomUUID();

    // Consultation reliability hardening (2026-08-19): a real production
    // intermittent "The AI consultation assistant is not available right
    // now" was traced to this call never being retried at all -- any
    // transient Gemini 5xx/429/timeout unconditionally failed the whole
    // turn on the first hiccup, unlike STT's own single retry
    // (teach-ai-panel-logic.ts). This mirrors that exact policy: at most
    // ONE retry, and ONLY when the thrown ChatProviderError's own
    // `retryable` flag (GeminiConsultationChatProvider.classifyError) is
    // true. A permanent failure (bad auth, invalid format, a non-5xx
    // PROVIDER_ERROR) is never retried -- a second identical call could
    // never change the outcome. Idempotency is structural, not a
    // best-effort promise: the stylist's message was already persisted
    // exactly once, above, before this loop; the assistant's reply is
    // only ever persisted once, after this loop resolves to its single
    // final result -- neither write is inside this retry.
    const recordAttempt = async (
      activeProvider: ConsultationChatProvider,
      attemptNumber: 1 | 2,
      outcome: "SUCCEEDED" | "FAILED",
      latencyMs: number,
      details: { providerRequestId?: string; usage?: AiUsageQuantities; errorCategory?: string } = {},
    ): Promise<void> => {
      // Defense-in-depth, on top of recordAiUsageEvent's own never-throws
      // contract: a metering problem must never turn an already-decided
      // outcome into a DIFFERENT, worse (or falsely better) one for the
      // caller.
      try {
        await recordUsage({
          ownerUserId,
          clientId: client.id,
          analysisId,
          feature: "consultation_chat",
          modality: "TEXT_GENERATION",
          correlationId: usageCorrelationId,
          attemptNumber,
          provider: activeProvider.name,
          model: activeProvider.modelVersion,
          outcome,
          latencyMs,
          ...details,
        });
      } catch {
        // Intentionally swallowed -- see comment above.
      }
    };

    let activeProvider = provider;
    let attemptNumber: 1 | 2 = 1;
    let providerCallStartedAt = Date.now();
    let result: Awaited<ReturnType<ConsultationChatProvider["respond"]>>;
    try {
      result = await activeProvider.respond(message, context, controller.signal);
    } catch (firstError) {
      const firstResultCode = classifyProviderFailure(firstError);
      const firstProviderError = firstError as Partial<ChatProviderError> | undefined;
      logConsultationChatFailure({
        stage: "provider_call",
        resultCode: firstResultCode,
        ownerUserId,
        clientId: client.id,
        analysisId,
        durationMs: Date.now() - startedAt,
        providerName: activeProvider.name,
        providerModelVersion: activeProvider.modelVersion,
        providerErrorCode: firstProviderError?.code,
        providerErrorStatus: firstProviderError?.status,
        voiceTurnId,
        providerAttemptNumber: attemptNumber,
      });
      await recordAttempt(activeProvider, attemptNumber, "FAILED", Date.now() - providerCallStartedAt, {
        errorCategory: firstProviderError?.code ?? firstResultCode,
      });

      if (firstProviderError?.retryable !== true) {
        return failure(firstResultCode, attemptNumber);
      }

      attemptNumber = 2;
      activeProvider = retryProvider;
      providerCallStartedAt = Date.now();
      try {
        result = await activeProvider.respond(message, context, controller.signal);
      } catch (secondError) {
        const secondResultCode = classifyProviderFailure(secondError);
        const secondProviderError = secondError as Partial<ChatProviderError> | undefined;
        logConsultationChatFailure({
          stage: "provider_call",
          resultCode: secondResultCode,
          ownerUserId,
          clientId: client.id,
          analysisId,
          durationMs: Date.now() - startedAt,
          providerName: activeProvider.name,
          providerModelVersion: activeProvider.modelVersion,
          providerErrorCode: secondProviderError?.code,
          providerErrorStatus: secondProviderError?.status,
          voiceTurnId,
          providerAttemptNumber: attemptNumber,
        });
        await recordAttempt(activeProvider, attemptNumber, "FAILED", Date.now() - providerCallStartedAt, {
          errorCategory: secondProviderError?.code ?? secondResultCode,
        });
        return failure(secondResultCode, attemptNumber);
      }
    }

    // Consultation instrumentation fix (2026-08-19): captured ONCE, right
    // here -- the exact instant the provider call resolved, before
    // anything else runs -- and reused below for both AI Usage Metering's
    // latencyMs (unchanged behavior, just no longer recomputed a second,
    // staler way) and the returned providerLatencyMs field (THE fix: that
    // field used to be recomputed at the function's own return statement,
    // after the reply DB write below had already run, silently including
    // that write's time in a field whose name promises pure provider
    // latency).
    const providerOnlyMs = Date.now() - providerCallStartedAt;
    await recordAttempt(activeProvider, attemptNumber, "SUCCEEDED", providerOnlyMs, {
      providerRequestId: result.providerRequestId,
      usage: result.usage,
    });

    const replyWriteStartedAt = Date.now();
    let replyRow;
    try {
      replyRow = await recordConsultationMessage({
        ownerUserId,
        clientId: client.id,
        analysisId: analysisId ?? null,
        role: "assistant",
        content: result.reply,
        proposedCorrection: result.proposedCorrection ?? undefined,
        proposedMemory: result.proposedMemory ?? undefined,
      });
    } catch {
      logConsultationChatFailure({
        stage: "reply_write",
        resultCode: "PERSISTENCE_FAILURE",
        ownerUserId,
        clientId: client.id,
        analysisId,
        durationMs: Date.now() - startedAt,
        voiceTurnId,
        providerAttemptNumber: attemptNumber,
      });
      return failure("PERSISTENCE_FAILURE", attemptNumber);
    }
    const replyWriteMs = Date.now() - replyWriteStartedAt;

    void stored; // the stylist's own message is already durably persisted above

    // The ONE canonical language decision for this reply: forced override
    // wins outright; otherwise prefer Gemini's own self-reported
    // replyLanguageCode (see SYSTEM_INSTRUCTION rule 11 -- the model's own
    // multilingual understanding, reliable for arbitrary registry
    // languages, not just the ones a hand-rolled detector was built for);
    // otherwise fall back to the local text detector (defensive, for the
    // rare case the model didn't populate it); otherwise the soft
    // ambiguous-message hint. Computed once here, not re-guessed a second
    // time on the frontend.
    const replyLanguage =
      languageHint.forced ?? result.replyLanguageCode ?? detectMessageLanguage(result.reply) ?? languageHint.fallback ?? null;

    // Safe-fields success log -- never the message/reply content, only
    // whether the provider actually included a proposal in this exact
    // response. Without this, "the reply talks about noting something but
    // the UI shows no card" is undiagnosable from Railway logs alone: it
    // could be a real wiring bug, or -- as this specific stage distinguishes
    // -- the provider genuinely not having populated the field, which is a
    // prompt-reliability question, not a code one.
    // Consultation instrumentation fix (2026-08-19): consultationTotalMs
    // is computed once, here, and reused for both the log's own exact
    // total and its pre-existing bucket -- the SAME instant, never two
    // slightly different Date.now() reads for what claims to be one
    // number. unattributedMs is the honest remainder: total minus the
    // three named windows above -- still includes the stylist message
    // write and the config/language-detection/logging overhead this
    // round deliberately did not break out further (see preProviderReadsMs's
    // own comment) -- never hidden, never silently absorbed into one of
    // the other three numbers.
    const consultationTotalMs = Date.now() - startedAt;
    const unattributedMs = Math.max(0, consultationTotalMs - preProviderReadsMs - providerOnlyMs - replyWriteMs);
    logConsultationChatSuccess({
      ownerUserId,
      clientId: client.id,
      analysisId,
      durationMs: consultationTotalMs,
      hadProposedCorrection: result.proposedCorrection != null,
      hadProposedMemory: result.proposedMemory != null,
      needsClarification: result.needsClarification,
      voiceTurnId,
      providerAttemptCount: attemptNumber,
      preProviderReadsMs,
      providerLatencyMs: providerOnlyMs,
      replyWriteMs,
      consultationTotalMs,
      unattributedMs,
    });

    return {
      outcome: "succeeded",
      reply: replyRow,
      needsClarification: result.needsClarification,
      replyLanguage,
      providerLatencyMs: providerOnlyMs,
      providerAttemptCount: attemptNumber,
    };
  } catch (error) {
    logConsultationChatFailure({
      stage: "unexpected",
      resultCode: "INTERNAL_PROCESSING_FAILURE",
      ownerUserId,
      clientId: client.id,
      analysisId,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "unknown",
      voiceTurnId,
    });
    return failure("INTERNAL_PROCESSING_FAILURE");
  }
}

function buildChatContext(
  client: ClientRecord,
  analysis: AnalysisState | null,
  priorMessages: ConsultationMessageRow[],
  memories: Awaited<ReturnType<typeof retrieveRelevantMemories>>,
  clientMemory: Awaited<ReturnType<typeof buildClientProfessionalMemory>>,
  languageHint: ConsultationChatLanguageHint,
): ConsultationChatContext {
  return {
    clientFullName: client.fullName,
    recentMessages: priorMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    professionalMemory: memories.map(({ scope, kind, content, source, confidence }) => ({ scope, kind, content, source, confidence })),
    clientProfessionalMemory: clientMemory,
    ...(languageHint.forced ? { forcedReplyLanguage: languageHint.forced } : {}),
    ...(!languageHint.forced && languageHint.fallback ? { fallbackReplyLanguage: languageHint.fallback } : {}),
    ...(analysis
      ? {
          currentAnalysis: {
            goal: analysis.goal,
            hairType: analysis.hairType,
            density: analysis.density,
            porosity: analysis.porosity,
            faceShape: analysis.faceShape,
            headShape: analysis.headShape,
            hairLength: analysis.hairLength,
            hairTexture: analysis.hairTexture,
            hairCondition: analysis.hairCondition,
            growthPattern: analysis.growthPattern,
            targetShape: analysis.targetShape,
            confidenceScore: analysis.confidenceScore,
            missingData: collectPlanField(analysis, "missingData"),
            assumptions: collectPlanField(analysis, "assumptions"),
            contraindications: collectPlanField(analysis, "contraindications"),
            safetyNotes: analysis.safetyNotes,
            clarificationAnswers: analysis.clarificationAnswers,
            cuttingTechnique: analysis.technicalCutPlan?.cuttingTechnique,
            colorFormulaDirection: analysis.colorPlan?.formulaDirection,
            treatmentCategory: analysis.treatmentPlan?.treatmentCategory,
            planSummary: analysis.recommendations.length > 0 ? analysis.recommendations.join(" ") : undefined,
          },
        }
      : {}),
  };
}

// Merges one string[] field (missingData/assumptions/contraindications)
// from whichever plan(s) actually exist -- never re-derived independently,
// so it can never drift from what the real deterministic engines
// (cutting/color/treatment-plan-engine.ts) already computed.
function collectPlanField(analysis: AnalysisState, field: "missingData" | "assumptions" | "contraindications"): string[] {
  const merged = new Set<string>();
  for (const plan of [analysis.technicalCutPlan, analysis.colorPlan, analysis.treatmentPlan]) {
    for (const value of plan?.[field] ?? []) {
      merged.add(value);
    }
  }
  return [...merged];
}

function defaultCreateProvider(config: { apiKey: string; model: string }): ConsultationChatProvider {
  return new GeminiConsultationChatProvider(config);
}

function classifyProviderFailure(error: unknown): ConsultationChatResultCode {
  const providerError = error as Partial<ChatProviderError>;
  switch (providerError?.code) {
    case "TIMEOUT":
      return "PROVIDER_TIMEOUT";
    case "RATE_LIMITED":
      return "PROVIDER_UNAVAILABLE";
    case "NOT_CONFIGURED":
      return "PROVIDER_AUTHENTICATION_FAILURE";
    case "INVALID_FORMAT":
      return "MALFORMED_PROVIDER_RESPONSE";
    case "PROVIDER_ERROR":
      return providerError.retryable === true ? "PROVIDER_UNAVAILABLE" : "PROVIDER_AUTHENTICATION_FAILURE";
    default:
      return "INTERNAL_PROCESSING_FAILURE";
  }
}

function failure(code: ConsultationChatResultCode, providerAttemptCount?: 1 | 2): SendConsultationMessageResult {
  return { outcome: "failed", code, ...(providerAttemptCount ? { providerAttemptCount } : {}) };
}

// Structured, safe-fields-only diagnostic log -- same JSON-record convention
// as image-analysis-processing-service.ts's logProviderFailure (never the
// message content, never the API key, never the provider's raw error text;
// only classification codes, the real HTTP status when known, and coarse
// timing). `stage` pinpoints exactly which step of the pipeline failed
// (config resolution never logs here -- it returns before this point --
// history read / stylist message write / the provider call itself / reply
// write / an unexpected exception), which is precisely what is needed to
// tell a genuine Gemini-side failure apart from a database or
// application-level one from Railway logs alone.
function logConsultationChatFailure(input: {
  stage:
    | "config_check"
    | "analysis_lookup"
    | "history_read"
    | "stylist_message_write"
    | "professional_memory_read"
    | "provider_call"
    | "reply_write"
    | "unexpected";
  resultCode: ConsultationChatResultCode;
  ownerUserId: string;
  clientId: string;
  analysisId?: string;
  durationMs: number;
  providerName?: string;
  providerModelVersion?: string;
  providerErrorCode?: string;
  providerErrorStatus?: number;
  configIssueCodes?: string;
  errorName?: string;
  voiceTurnId?: string;
  providerAttemptNumber?: number;
}): void {
  console.error(
    JSON.stringify({
      gate: "CONSULTATION_CHAT",
      status: "FAILED",
      stage: input.stage,
      resultCode: input.resultCode,
      ownerUserId: input.ownerUserId,
      clientId: input.clientId,
      analysisId: input.analysisId ?? null,
      durationBucket: bucketDurationMs(input.durationMs),
      providerName: input.providerName ?? null,
      providerModelVersion: input.providerModelVersion ?? null,
      providerErrorCode: input.providerErrorCode ?? null,
      providerErrorStatus: input.providerErrorStatus ?? null,
      configIssueCodes: input.configIssueCodes ?? null,
      errorName: input.errorName ?? null,
      voiceTurnId: input.voiceTurnId ?? null,
      providerAttemptNumber: input.providerAttemptNumber ?? null,
    }),
  );
}

// console.log (not .error/.warn), matching storage-readiness-canary.ts's
// convention that a healthy/successful outcome logs at the "log" level.
// Same safe-fields-only rule as the failure log: never the message or
// reply content, only booleans/timing -- but specifically, this answers
// "did the provider actually include a proposal in this response" for any
// later report of "the reply talks about noting something but no card
// appeared", without needing to inspect the database.
function logConsultationChatSuccess(input: {
  ownerUserId: string;
  clientId: string;
  analysisId?: string;
  durationMs: number;
  hadProposedCorrection: boolean;
  hadProposedMemory: boolean;
  needsClarification: boolean;
  voiceTurnId?: string;
  providerAttemptCount?: number;
  // Consultation instrumentation fix (2026-08-19): a real breakdown of
  // where consultationTotalMs actually went, so "why was this turn slow"
  // is answerable from this ONE log line without cross-referencing the
  // client's own voice latency telemetry. preProviderReadsMs = analysis
  // lookup + prior-messages read + professional-memory read (each
  // internally overlapped, per this file's own comments above); this
  // field is their sum, excluding the stylist message write that sits
  // between them. providerLatencyMs here is the SAME, now-corrected
  // number returned to the caller as providerLatencyMs -- pure
  // provider.respond() time only, never including the reply write below
  // it. replyWriteMs is the assistant reply's own DB write. unattributedMs
  // is the honest remainder (never negative) -- see its own computation
  // comment for exactly what it still contains.
  preProviderReadsMs?: number;
  providerLatencyMs?: number;
  replyWriteMs?: number;
  consultationTotalMs?: number;
  unattributedMs?: number;
}): void {
  console.log(
    JSON.stringify({
      gate: "CONSULTATION_CHAT",
      status: "SUCCEEDED",
      ownerUserId: input.ownerUserId,
      clientId: input.clientId,
      analysisId: input.analysisId ?? null,
      durationBucket: bucketDurationMs(input.durationMs),
      hadProposedCorrection: input.hadProposedCorrection,
      hadProposedMemory: input.hadProposedMemory,
      needsClarification: input.needsClarification,
      voiceTurnId: input.voiceTurnId ?? null,
      providerAttemptCount: input.providerAttemptCount ?? null,
      preProviderReadsMs: input.preProviderReadsMs ?? null,
      providerLatencyMs: input.providerLatencyMs ?? null,
      replyWriteMs: input.replyWriteMs ?? null,
      consultationTotalMs: input.consultationTotalMs ?? null,
      unattributedMs: input.unattributedMs ?? null,
    }),
  );
}

function bucketDurationMs(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 5000) return "1-5s";
  if (ms < 15000) return "5-15s";
  if (ms < 30000) return "15-30s";
  if (ms < 60000) return "30-60s";
  return ">=60s";
}
