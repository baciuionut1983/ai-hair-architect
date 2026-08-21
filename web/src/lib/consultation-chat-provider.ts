import type { AiUsageQuantities } from "./ai-usage-contracts";
import type { LanguageCode } from "./language-registry";

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
  // Two independent language signals, matching the app's own "Auto vs.
  // fixed language" selector. Both are LanguageCode (see
  // language-registry.ts) -- always one of conversationSupportedLanguages()
  // by the time this reaches a provider; never restricted to en/ro at the
  // type level (that would recreate the exact hardcoded-union problem this
  // registry replaces), so validation of "is this code actually usable for
  // a conversation" lives at the one real boundary (the chat route parsing
  // the request body), not scattered across every consumer.
  // - forcedReplyLanguage: the stylist explicitly picked a language
  //   (selector set to something other than "Auto") -- the model MUST
  //   reply in this language always, even if the stylist's own message
  //   happens to be written in a different one. This is what "fixing"
  //   the language means. Never set at the same time as
  //   fallbackReplyLanguage below.
  // - fallbackReplyLanguage: selector is "Auto" -- used ONLY when the
  //   stylist's own message is genuinely ambiguous (too short, a name, a
  //   number). Never overrides a message that clearly indicates its own
  //   language -- the model is instructed to prefer the message's own
  //   language above this hint. See SYSTEM_INSTRUCTION in
  //   consultation-chat-provider-gemini.ts for the exact rule.
  forcedReplyLanguage?: LanguageCode;
  fallbackReplyLanguage?: LanguageCode;
  // Voice latency optimization (2026-08-20): true only when this turn
  // originated from a voice-initiated conversation (see consultation-
  // chat-service.ts's own voiceTurnId parameter) -- a real production
  // measurement showed a ~26-second spoken reply contributing directly to
  // slow Consult AI generation time AND slow TTS synthesis/transfer/decode
  // time downstream. Never set for a typed message, so typed-chat replies
  // are completely unaffected -- this only nudges the model toward a
  // reply LENGTH appropriate for being read aloud, never toward omitting
  // genuinely necessary professional detail (see SYSTEM_INSTRUCTION rule
  // 12 in consultation-chat-provider-gemini.ts for the exact wording).
  preferConciseReply?: boolean;
}

export interface ConsultationChatProposedCorrection {
  field: string;
  value: string;
  reason: string;
  source: "stylist_confirmed" | "client_reported";
}

// A candidate ProfessionalMemory the AI recognized in this message --
// ALWAYS only a suggestion, exactly like proposedCorrection. `action`
// reuses professional-memory-repository.ts's MEMORY_PROPOSAL_ACTIONS
// vocabulary directly (imported by the Gemini provider for its schema
// enum), so what the model is even allowed to propose can never drift from
// what POST /api/v1/clients/{id}/memories actually accepts. Nothing
// implementing this interface is ever allowed to create the memory itself
// -- only an explicit, separate confirm call does that.
export interface ConsultationChatProposedMemory {
  action: "save_client_memory" | "save_professional_rule" | "mark_preference" | "save_outcome";
  content: string;
  reason: string;
}

export interface ConsultationChatResult {
  reply: string;
  proposedCorrection?: ConsultationChatProposedCorrection;
  proposedMemory?: ConsultationChatProposedMemory;
  needsClarification: boolean;
  // The model's OWN classification of what language it just wrote `reply`
  // in (see consultation-chat-provider-gemini.ts's RESPONSE_SCHEMA) --
  // Gemini's own multilingual understanding is a far more reliable
  // "what language is this" signal than a hand-rolled detector could ever
  // be for arbitrary languages, so consultation-chat-service.ts prefers
  // this over re-detecting the reply text locally. Optional at this type
  // level only so a provider that hasn't populated it yet (or a test
  // double) still type-checks -- the service's own fallback chain
  // (forced hint -> this field -> local detection -> soft fallback)
  // covers its absence.
  replyLanguageCode?: LanguageCode;
  // AI Usage & Cost Metering Phase 1: the real provider usage for THIS
  // response, when the provider exposed any -- absent (never a fabricated
  // object of zeros) whenever it didn't. See GeminiConsultationChatProvider's
  // own `respond` for how this is captured without changing what
  // generateContent returns to existing callers/tests.
  usage?: AiUsageQuantities;
  providerRequestId?: string;
  // Consult AI voice thinking A/B (2026-08-21): the real Gemini
  // thinking_level this exact call requested ("MINIMAL"/"LOW"/"MEDIUM"/
  // "HIGH"), or the literal string "default" when no override applied
  // (every typed message, and every voice turn when the experiment isn't
  // enabled) -- see GeminiConsultationChatProvider's own respond() for
  // exactly how this is decided. Always one or the other, never undefined,
  // so a real production test can always tell which mode a given reply
  // actually used.
  thinkingMode?: string;
}

export interface ChatProviderError extends Error {
  code: "TIMEOUT" | "INVALID_FORMAT" | "RATE_LIMITED" | "PROVIDER_ERROR" | "NOT_CONFIGURED";
  retryable: boolean;
  // The real HTTP status the provider's API returned, when known (e.g. 400,
  // 429, 500) -- distinct from `code`, which is this app's own coarse
  // classification. Carried through purely for diagnostics (structured
  // failure logs in consultation-chat-service.ts).
  status?: number;
  // Consult AI 404/PROVIDER_UNAVAILABLE root-cause diagnosis (2026-08-21):
  // Google's own canonical, short error-status vocabulary (e.g.
  // "UNAVAILABLE", "NOT_FOUND", "RESOURCE_EXHAUSTED" -- see
  // https://cloud.google.com/apis/design/errors#error_model), parsed from
  // the SAME error the provider already threw -- mirrors voice-transcript/
  // route.ts's own providerErrorStatus exactly, applying that same,
  // already-authorized pattern here. Supersedes this interface's previous
  // "raw error text is deliberately never logged" stance -- see
  // providerRawMessage below for why that's no longer true, in a bounded,
  // safe way.
  providerCanonicalStatus?: string;
  // Google's own human-readable diagnostic message, sanitized (control
  // characters stripped) and bounded to a safe length (see
  // consultation-chat-provider-gemini.ts's own sanitizeProviderErrorMessage)
  // -- genuinely free text, unlike providerCanonicalStatus's fixed
  // vocabulary. Never the API key, never Authorization, never the prompt/
  // conversation content, never audio/personal data -- sourced only from
  // Google's own error response, which never echoes any of those back.
  providerRawMessage?: string;
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
