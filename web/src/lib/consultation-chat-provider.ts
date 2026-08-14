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
  // uncertaintyReasons/assumptions are professional defaults the engine
  // fell back to, not confirmed observations -- kept separate from
  // missingData (truly unknown) so the AI can honestly distinguish "we
  // don't know" from "we assumed this in the absence of better data" and
  // never present either as a verified fact.
  assumptions: string[];
  // Merged from whichever plan(s) exist (technicalCutPlan/colorPlan/
  // treatmentPlan) -- never re-derived, so it can never drift from what the
  // real deterministic engines actually computed.
  contraindications: string[];
  safetyNotes: string[];
  // The stylist's own answers to this analysis's clarification questions,
  // in the order asked -- distinct from a later correction: these were
  // given during the original clarification flow, not as a contradiction.
  clarificationAnswers: string[];
  // The technique labels actually chosen by the deterministic engines, so
  // the AI can discuss e.g. "why scissor_over_comb" by name instead of only
  // through the prose in planSummary.
  cuttingTechnique?: string;
  colorFormulaDirection?: string;
  treatmentCategory?: string;
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

// A confirmed ProfessionalMemory row already scored/filtered by
// professional-memory-repository.ts's retrieveRelevantMemories -- always
// status="active" at the point it reaches this context (revoked/pending
// rows are excluded at the query level, never filtered here).
export interface ConsultationChatMemoryItem {
  scope: "client_specific" | "stylist_specific" | "shared_knowledge";
  kind: "fact" | "professional_rule" | "preference" | "outcome" | "ai_observation";
  content: string;
  source: string;
  confidence: number;
}

export interface ConsultationChatMemoryCorrection {
  fieldName: string;
  newValue: unknown;
  source: string;
  reason: string | null;
  createdAt: string;
}

export interface ConsultationChatMemoryConsultation {
  summary: string;
  nextSteps: string[];
  createdAt: string;
}

export interface ConsultationChatMemoryService {
  name: string;
  details: string;
  createdAt: string;
}

// Bounded, already-confirmed client history -- built by
// consultation-client-context.ts. Kept structurally distinct from
// recentMessages (the raw chat transcript): everything here already went
// through its own explicit-confirm step (a correction applied, a
// consultation saved, a formula/treatment logged) before it ever reached
// this context, so the AI can treat it as real history, not as something a
// stylist merely typed in this conversation.
export interface ConsultationChatClientMemory {
  recentCorrections: ConsultationChatMemoryCorrection[];
  recentConsultations: ConsultationChatMemoryConsultation[];
  recentFormulas: ConsultationChatMemoryService[];
  recentTreatments: ConsultationChatMemoryService[];
}

export interface ConsultationChatContext {
  clientFullName: string;
  currentAnalysis?: ConsultationChatCurrentAnalysis;
  recentMessages: ConsultationChatHistoryEntry[];
  // Both always populated by consultation-chat-service.ts (empty
  // arrays/all-empty-lists when there is nothing to report), never omitted
  // -- so "no memory" is always an explicit, honest empty state the model
  // can see, not an absent field it might paper over.
  professionalMemory: ConsultationChatMemoryItem[];
  clientProfessionalMemory: ConsultationChatClientMemory;
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
  // The real HTTP status the provider's API returned, when known (e.g. 400,
  // 429, 500) -- distinct from `code`, which is this app's own coarse
  // classification. Carried through purely for diagnostics (structured
  // failure logs in consultation-chat-service.ts): a status code is safe,
  // non-sensitive metadata, unlike the provider's raw error text, which this
  // codebase deliberately never logs (see image-analysis-processing-service.ts's
  // logProviderFailure).
  status?: number;
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
    retryable: boolean = false,
    status?: number
  ): ChatProviderError {
    const err = new Error(message) as ChatProviderError;
    err.code = code;
    err.retryable = retryable;
    if (status !== undefined) err.status = status;
    return err;
  }
}
