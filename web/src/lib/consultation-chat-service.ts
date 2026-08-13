import type { AnalysisState } from "@/lib/milestone2-types";
import { findAnalysisForOwner } from "@/lib/analysis-repository";
import type { ClientRecord } from "@/lib/contracts";
import {
  listRecentConsultationMessages,
  recordConsultationMessage,
  type ConsultationMessageRow,
} from "@/lib/consultation-message-repository";
import { GeminiConsultationChatProvider } from "@/lib/consultation-chat-provider-gemini";
import type { ChatProviderError, ConsultationChatContext, ConsultationChatProvider } from "@/lib/consultation-chat-provider";
import { resolveImageAnalysisProviderConfig } from "@/lib/image-analysis-provider-config";

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
    if (analysisId) {
      analysis = await findAnalysisForOwner(ownerUserId, analysisId);
      if (!analysis) {
        return failure("ANALYSIS_NOT_FOUND");
      }
    }

    const priorMessages = await listRecentConsultationMessages(ownerUserId, client.id, 10);

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
      return failure("PERSISTENCE_FAILURE");
    }

    const createProvider = dependencies.createProvider ?? defaultCreateProvider;
    const provider = createProvider({ apiKey: config.apiKey, model: config.model });
    const context = buildChatContext(client, analysis, priorMessages);

    const controller = new AbortController();
    let result;
    try {
      result = await provider.respond(message, context, controller.signal);
    } catch (error) {
      return failure(classifyProviderFailure(error));
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
      return failure("PERSISTENCE_FAILURE");
    }

    void stored; // the stylist's own message is already durably persisted above

    return { outcome: "succeeded", reply: replyRow, needsClarification: result.needsClarification };
  } catch {
    return failure("INTERNAL_PROCESSING_FAILURE");
  }
}

function buildChatContext(
  client: ClientRecord,
  analysis: AnalysisState | null,
  priorMessages: ConsultationMessageRow[],
): ConsultationChatContext {
  return {
    clientFullName: client.fullName,
    recentMessages: priorMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
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
            missingData: collectMissingData(analysis),
            planSummary: analysis.recommendations.length > 0 ? analysis.recommendations.join(" ") : undefined,
          },
        }
      : {}),
  };
}

// Merges missingData from whichever plan(s) actually exist -- never
// re-derives it independently, so it can never drift from what the real
// deterministic engines (cutting/color/treatment-plan-engine.ts) already
// computed.
function collectMissingData(analysis: AnalysisState): string[] {
  const merged = new Set<string>();
  for (const plan of [analysis.technicalCutPlan, analysis.colorPlan, analysis.treatmentPlan]) {
    for (const field of plan?.missingData ?? []) {
      merged.add(field);
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
