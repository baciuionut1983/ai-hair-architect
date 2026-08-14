import type { AnalysisState } from "@/lib/milestone2-types";
import { findAnalysisForOwner, findLatestAnalysisForClient } from "@/lib/analysis-repository";
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
  | { outcome: "succeeded"; reply: ConsultationMessageRow; needsClarification: boolean }
  | { outcome: "failed"; code: ConsultationChatResultCode };

export interface SendConsultationMessageDependencies {
  env?: Readonly<Record<string, string | undefined>>;
  createProvider?: (config: { apiKey: string; model: string }) => ConsultationChatProvider;
  now?: () => Date;
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
): Promise<SendConsultationMessageResult> {
  const startedAt = (dependencies.now ?? (() => new Date()))().getTime();

  try {
    const env = dependencies.env ?? process.env;
    const config = resolveImageAnalysisProviderConfig(env);
    if (config.status === "disabled") {
      return failure("PROCESSING_DISABLED");
    }
    if (config.status === "invalid") {
      return failure("PROVIDER_CONFIGURATION_INVALID");
    }

    let analysis: AnalysisState | null = null;
    try {
      if (analysisId) {
        analysis = await findAnalysisForOwner(ownerUserId, analysisId);
        if (!analysis || analysis.clientId !== client.id) {
          return failure("ANALYSIS_NOT_FOUND");
        }
      } else {
        // No explicit analysisId (Consult AI opened from the client page,
        // not a specific analysis page) -- auto-resolve the client's own
        // most recent analysis so the AI has real baseline context without
        // the stylist having to re-describe a hair profile the platform
        // already has on file. null here is a legitimate, honest "this
        // client has no analysis yet", not an error.
        analysis = await findLatestAnalysisForClient(ownerUserId, client.id);
      }
    } catch {
      logConsultationChatFailure({
        stage: "analysis_lookup",
        resultCode: "PERSISTENCE_FAILURE",
        ownerUserId,
        clientId: client.id,
        analysisId,
        durationMs: Date.now() - startedAt,
      });
      return failure("PERSISTENCE_FAILURE");
    }

    let priorMessages;
    try {
      priorMessages = await listRecentConsultationMessages(ownerUserId, client.id, 10);
    } catch {
      logConsultationChatFailure({
        stage: "history_read",
        resultCode: "PERSISTENCE_FAILURE",
        ownerUserId,
        clientId: client.id,
        analysisId,
        durationMs: Date.now() - startedAt,
      });
      return failure("PERSISTENCE_FAILURE");
    }

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
      });
      return failure("PERSISTENCE_FAILURE");
    }

    const createProvider = dependencies.createProvider ?? defaultCreateProvider;
    const provider = createProvider({ apiKey: config.apiKey, model: config.model });

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
      });
      return failure("PERSISTENCE_FAILURE");
    }

    const context = buildChatContext(client, analysis, priorMessages, memories, clientMemory);

    const controller = new AbortController();
    let result;
    try {
      result = await provider.respond(message, context, controller.signal);
    } catch (error) {
      const resultCode = classifyProviderFailure(error);
      const providerError = error as Partial<ChatProviderError> | undefined;
      logConsultationChatFailure({
        stage: "provider_call",
        resultCode,
        ownerUserId,
        clientId: client.id,
        analysisId,
        durationMs: Date.now() - startedAt,
        providerName: provider.name,
        providerModelVersion: provider.modelVersion,
        providerErrorCode: providerError?.code,
        providerErrorStatus: providerError?.status,
      });
      return failure(resultCode);
    }

    let replyRow;
    try {
      replyRow = await recordConsultationMessage({
        ownerUserId,
        clientId: client.id,
        analysisId: analysisId ?? null,
        role: "assistant",
        content: result.reply,
        proposedCorrection: result.proposedCorrection ?? undefined,
      });
    } catch {
      logConsultationChatFailure({
        stage: "reply_write",
        resultCode: "PERSISTENCE_FAILURE",
        ownerUserId,
        clientId: client.id,
        analysisId,
        durationMs: Date.now() - startedAt,
      });
      return failure("PERSISTENCE_FAILURE");
    }

    void stored; // the stylist's own message is already durably persisted above

    return { outcome: "succeeded", reply: replyRow, needsClarification: result.needsClarification };
  } catch (error) {
    logConsultationChatFailure({
      stage: "unexpected",
      resultCode: "INTERNAL_PROCESSING_FAILURE",
      ownerUserId,
      clientId: client.id,
      analysisId,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "unknown",
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
): ConsultationChatContext {
  return {
    clientFullName: client.fullName,
    recentMessages: priorMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    professionalMemory: memories.map(({ scope, kind, content, source, confidence }) => ({ scope, kind, content, source, confidence })),
    clientProfessionalMemory: clientMemory,
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

function failure(code: ConsultationChatResultCode): SendConsultationMessageResult {
  return { outcome: "failed", code };
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
  errorName?: string;
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
      errorName: input.errorName ?? null,
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
