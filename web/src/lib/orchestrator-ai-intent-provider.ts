import type { AiUsageQuantities } from "@/lib/ai-usage-contracts";
import type { AiIntentClassificationResult } from "@/lib/orchestrator-ai-intent-schema";
import type { ConciergeWorkflowStage } from "@/lib/orchestrator-workflow-stage";

// AI Concierge / Orchestrator, Stage 3 -- minimal, provider-agnostic
// contract for the intent classifier's AI layer. Mirrors
// ConsultationChatProvider's shape (consultation-chat-provider.ts) on
// purpose -- same codebase convention, same error taxonomy -- but scoped
// down to exactly what this call needs: a single free-text message in, a
// tiny closed-vocabulary classification out (orchestrator-ai-intent-
// schema.ts). No client history, no professional memory, no image, no
// correction/memory proposal shape -- this is deliberately the smallest
// possible AI surface, not a re-use of the much larger Consult AI contract
// (task section 1: "reuse existing infrastructure... do not create
// another PARALLEL AI/provider framework" -- reusing that framework's
// SHAPE and conventions is the reuse; reusing its much larger payload
// would be sending client data this call never needs, violating task
// section 14's own data-minimization requirement).
export interface OrchestratorIntentAiResult extends AiIntentClassificationResult {
  usage?: AiUsageQuantities;
  providerRequestId?: string;
}

// AI Concierge / Orchestrator, Stage 4 (task section 10): the ONLY
// contextual metadata the AI classifier may ever receive beyond the raw
// message itself -- deliberately just these two small, already-server-
// verified, non-identifying signals (never a client name, never message
// history, never any id). workflowStage comes from
// orchestrator-workflow-stage.ts's own resolveWorkflowStage (derived from
// the SAME already-authority-checked OrchestratorContext every other
// decision in this turn is built from -- never a remembered/stale value).
// hasPendingDecision is true only when the caller's own pendingDecision
// hint survived this turn's context re-verification (see
// orchestrator-service.ts's own buildDecision) -- it tells the model
// "a yes/no reply right now would mean something," never WHAT that
// pending decision concerns (the model never needs, and never receives,
// the pending decision's own identity -- that stays entirely
// deterministic, resolved by orchestrator-confirmation-detector.ts before
// the AI is ever consulted).
export interface AiClassifierContext {
  workflowStage: ConciergeWorkflowStage;
  hasPendingDecision: boolean;
}

export interface OrchestratorIntentProviderError extends Error {
  code: "TIMEOUT" | "INVALID_FORMAT" | "RATE_LIMITED" | "PROVIDER_ERROR" | "NOT_CONFIGURED";
  retryable: boolean;
  status?: number;
  providerCanonicalStatus?: string;
  providerRawMessage?: string;
}

/**
 * Minimal, provider-agnostic contract for the Concierge intent classifier's
 * AI layer (Stage 3). Nothing implementing this interface is ever allowed
 * to return anything beyond a validated AiIntentClassificationResult --
 * never an OrchestratorActionId, a URL, or any other executable value (see
 * orchestrator-ai-intent-schema.ts's own isAiIntentClassificationResult,
 * which every real implementation validates its own raw response against
 * before returning, and which orchestrator-hybrid-classifier.ts re-checks
 * again anyway, defense in depth).
 */
export abstract class OrchestratorIntentAiProvider {
  abstract readonly name: string;
  abstract readonly modelVersion: string;

  // `context` is optional (undefined) purely so an existing/hand-built
  // fake provider from an earlier stage's test doesn't need to change --
  // every REAL call site (orchestrator-hybrid-classifier.ts) always
  // supplies one.
  abstract classify(message: string, signal: AbortSignal, context?: AiClassifierContext): Promise<OrchestratorIntentAiResult>;

  protected createProviderError(
    code: OrchestratorIntentProviderError["code"],
    message: string,
    retryable: boolean = false,
    status?: number,
  ): OrchestratorIntentProviderError {
    const err = new Error(message) as OrchestratorIntentProviderError;
    err.code = code;
    err.retryable = retryable;
    if (status !== undefined) err.status = status;
    return err;
  }
}
