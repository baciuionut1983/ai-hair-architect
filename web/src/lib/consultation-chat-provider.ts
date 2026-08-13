export interface ConsultationChatCurrentAnalysis {
  goal: string;
  hairType: string;
  density: string;
  porosity: string;
  faceShape?: string;
  headShape?: string;
  hairLength?: string;
  hairTexture?: string;
  hairCondition?: string;
  growthPattern?: string;
  targetShape?: string;
  confidenceScore: number;
  missingData: string[];
  // Reuses the exact recommendation lines the deterministic engines already
  // produced (analysis-engine.ts's buildRecommendationsAndSafetyNotes) --
  // never a second, separately-derived summary that could drift from the
  // real structured plan.
  planSummary?: string;
}

export interface ConsultationChatHistoryEntry {
  role: "stylist" | "assistant";
  content: string;
}

export interface ConsultationChatContext {
  clientFullName: string;
  currentAnalysis?: ConsultationChatCurrentAnalysis;
  recentMessages: ConsultationChatHistoryEntry[];
}

export interface ConsultationChatProposedCorrection {
  field: string;
  value: string;
  reason: string;
  source: "stylist_confirmed" | "client_reported";
}

export interface ConsultationChatResult {
  reply: string;
  proposedCorrection?: ConsultationChatProposedCorrection;
  needsClarification: boolean;
}

export interface ChatProviderError extends Error {
  code: "TIMEOUT" | "INVALID_FORMAT" | "RATE_LIMITED" | "PROVIDER_ERROR" | "NOT_CONFIGURED";
  retryable: boolean;
}

/**
 * Minimal, provider-agnostic contract for the Conversational Professional AI
 * milestone -- mirrors ImageAnalysisProvider's shape (image-analysis-provider.ts)
 * on purpose, but for text, not vision. A proposedCorrection is ALWAYS only a
 * suggestion: nothing implementing this interface is ever allowed to apply a
 * change itself. Only an explicit call to POST /api/v1/analysis/{id}/correct
 * (analysis-repository.ts's applyAnalysisCorrection) changes professional data.
 */
export abstract class ConsultationChatProvider {
  abstract readonly name: string;
  abstract readonly modelVersion: string;

  abstract respond(message: string, context: ConsultationChatContext, signal: AbortSignal): Promise<ConsultationChatResult>;

  protected createProviderError(
    code: ChatProviderError["code"],
    message: string,
    retryable: boolean = false
  ): ChatProviderError {
    const err = new Error(message) as ChatProviderError;
    err.code = code;
    err.retryable = retryable;
    return err;
  }
}
