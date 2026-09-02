import type { AiUsageQuantities } from "@/lib/ai-usage-contracts";
import type { AiIntentClassificationResult } from "@/lib/orchestrator-ai-intent-schema";

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

  abstract classify(message: string, signal: AbortSignal): Promise<OrchestratorIntentAiResult>;

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
