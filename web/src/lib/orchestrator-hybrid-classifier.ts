import { randomUUID } from "crypto";

import type { RecordAiUsageEventInput } from "@/lib/ai-usage-contracts";
import { recordAiUsageEvent } from "@/lib/ai-usage-repository";
import { resolveImageAnalysisProviderConfig } from "@/lib/image-analysis-provider-config";
import type { OrchestratorIntent, OrchestratorRoleClass } from "@/lib/orchestrator-contracts";
import { classifyOrchestratorIntent } from "@/lib/orchestrator-intent-classifier";
import {
  isAiIntentClassificationResult,
  mapSemanticIntentToOrchestratorIntent,
} from "@/lib/orchestrator-ai-intent-schema";
import {
  OrchestratorIntentAiProvider,
  type OrchestratorIntentAiResult,
  type OrchestratorIntentProviderError,
} from "@/lib/orchestrator-ai-intent-provider";
import { GeminiOrchestratorIntentProvider } from "@/lib/orchestrator-ai-intent-provider-gemini";

// AI Concierge / Orchestrator, Stage 3 -- the HYBRID classification
// pipeline (task section 2). Sits between orchestrator-service.ts (which
// still owns ALL authority/policy resolution, unchanged) and the two
// classifiers it may consult: the existing Stage 1 deterministic one
// (orchestrator-intent-classifier.ts, untouched) and, new here, an
// AI-backed one (orchestrator-ai-intent-provider-gemini.ts) used only when
// the deterministic pass genuinely can't confidently resolve the message.
//
// Preferred flow (task section 2), exactly as implemented below:
//   deterministic high-confidence match -> use it, no AI call
//   -> otherwise, a real AI provider IS configured -> ONE AI attempt
//      -> validated + high confidence -> map to OrchestratorIntent
//      -> validated but low confidence, or ambiguous -> "clarification"
//      -> invalid/malformed AI output, or the call fails -> "fallback"
//   -> otherwise (no provider configured) -> "fallback"
// "fallback" always means "unsupported" -- an honest abstention, never a
// low-confidence guess silently promoted to a real recommendation (task
// section 8/9).
export const CONCIERGE_INTENT_CLASSIFICATION_FEATURE = "concierge_intent_classification";

// task section 17: distinguishes exactly how each decision's intent was
// actually produced, for CONCIERGE_ORCHESTRATION's own log line
// (orchestrator-service.ts) -- never persisted, never part of the public
// OrchestratorDecision contract itself (see that file's own header
// comment on why classifierSource stays a service-internal concept).
export type ConciergeClassifierSource = "deterministic" | "ai" | "fallback" | "clarification";

export interface HybridClassificationOutcome {
  intent: OrchestratorIntent;
  source: ConciergeClassifierSource;
}

export interface HybridClassifierContext {
  ownerUserId: string;
  roleClass: OrchestratorRoleClass;
  clientId: string | null;
  analysisId: string | null;
}

export interface HybridClassifierDependencies {
  env?: Readonly<Record<string, string | undefined>>;
  createAiProvider?: (config: { apiKey: string; model: string }) => OrchestratorIntentAiProvider;
  recordAiUsageEvent?: typeof recordAiUsageEvent;
  classifyDeterministic?: typeof classifyOrchestratorIntent;
  now?: () => Date;
}

// A short, generous list of negation cues (EN + RO, this app's own
// FULL-coverage deterministic-classifier languages -- see
// orchestrator-intent-classifier.ts's own header comment) that make the
// deterministic classifier's keyword match UNTRUSTWORTHY, not necessarily
// wrong -- e.g. "Nu vreau video." (task's own PRIMARY GOAL example)
// otherwise matches the deterministic classifier's \bvideo\b rule and
// would silently recommend REQUEST_VIDEO for a message that just declined
// it. Deliberately broad: the only cost of a false positive here is one
// extra AI classification attempt (or, if no provider is configured, an
// honest "unsupported" instead of a shaky guess) -- never a wrong
// action, so over-triggering is always the safe direction.
const NEGATION_CUES = ["nu vreau", "nu doresc", "nu mai", "nu ", "don't want", "do not want", "dont want", "no video", "not now", "never mind"];

function isHighConfidenceDeterministicMatch(normalizedMessage: string): boolean {
  return !NEGATION_CUES.some((cue) => normalizedMessage.includes(cue));
}

export async function classifyOrchestratorIntentHybrid(
  message: string,
  context: HybridClassifierContext,
  dependencies: HybridClassifierDependencies = {},
): Promise<HybridClassificationOutcome> {
  const classifyDeterministic = dependencies.classifyDeterministic ?? classifyOrchestratorIntent;
  const trimmed = message.trim();

  // The Stage 2 context-only trigger (no user utterance at all) -- never
  // spends an AI call, or even a deterministic one, on an empty string.
  if (!trimmed) {
    return { intent: "unsupported", source: "deterministic" };
  }

  const deterministic = classifyDeterministic(trimmed);

  // Public role class: every action in the registry today is
  // professional-only (orchestrator-action-registry.ts), so no possible
  // classification could ever change the outcome -- decideFromIntent's own
  // role gating resolves to the identical roleUnsupportedDecision either
  // way. Spending a real AI call here could never be worth its cost.
  if (context.roleClass !== "professional") {
    return { intent: deterministic, source: "deterministic" };
  }

  if (deterministic !== "unsupported" && isHighConfidenceDeterministicMatch(trimmed.toLowerCase())) {
    return { intent: deterministic, source: "deterministic" };
  }

  const env = dependencies.env ?? process.env;
  const config = resolveImageAnalysisProviderConfig(env);
  if (config.status !== "enabled") {
    // No real provider configured (or misconfigured) -- never a 500, and
    // never the deterministic pass's own low-confidence/negative match
    // either (task section 8/9): an honest abstention.
    return { intent: "unsupported", source: "fallback" };
  }

  const createProvider = dependencies.createAiProvider ?? defaultCreateAiProvider;
  let provider: OrchestratorIntentAiProvider;
  try {
    provider = createProvider({ apiKey: config.apiKey, model: config.model });
  } catch {
    return { intent: "unsupported", source: "fallback" };
  }

  const recordUsage = dependencies.recordAiUsageEvent ?? recordAiUsageEvent;
  const correlationId = randomUUID();
  const controller = new AbortController();
  const startedAt = (dependencies.now ?? (() => new Date()))().getTime();

  let raw: OrchestratorIntentAiResult;
  try {
    raw = await provider.classify(trimmed, controller.signal);
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const providerError = error as Partial<OrchestratorIntentProviderError> | undefined;
    logConciergeClassifierFailure(providerError, latencyMs);
    // task section 8: no automatic retry here -- exactly one attempt, then
    // an honest fallback, so a provider outage never multiplies cost.
    await safeRecordUsage(recordUsage, meteringInput(context, correlationId, provider, "FAILED", latencyMs, {
      errorCategory: providerError?.code ?? "UNKNOWN",
    }));
    return { intent: "unsupported", source: "fallback" };
  }
  const latencyMs = Date.now() - startedAt;

  // Defense in depth -- see orchestrator-ai-intent-schema.ts's own doc
  // comment on isAiIntentClassificationResult for why this is exercised
  // for real here too, not assumed safe just because the provider already
  // validated its own response.
  if (!isAiIntentClassificationResult(raw)) {
    await safeRecordUsage(recordUsage, meteringInput(context, correlationId, provider, "FAILED", latencyMs, {
      errorCategory: "invalid_ai_output",
    }));
    return { intent: "unsupported", source: "fallback" };
  }

  await safeRecordUsage(recordUsage, meteringInput(context, correlationId, provider, "SUCCEEDED", latencyMs, {
    usage: raw.usage,
    providerRequestId: raw.providerRequestId,
  }));

  if (raw.semanticIntent === "unknown") {
    return { intent: "unsupported", source: "ai" };
  }
  if (raw.confidence === "low") {
    // task section 9: a real, recognized-but-uncertain classification
    // becomes a clarification request, never a risky guess promoted to a
    // real recommendation.
    return { intent: "unsupported", source: "clarification" };
  }
  return { intent: mapSemanticIntentToOrchestratorIntent(raw.semanticIntent), source: "ai" };
}

function defaultCreateAiProvider(config: { apiKey: string; model: string }): OrchestratorIntentAiProvider {
  return new GeminiOrchestratorIntentProvider(config);
}

function meteringInput(
  context: HybridClassifierContext,
  correlationId: string,
  provider: OrchestratorIntentAiProvider,
  outcome: "SUCCEEDED" | "FAILED",
  latencyMs: number,
  extra: Partial<Pick<RecordAiUsageEventInput, "usage" | "providerRequestId" | "errorCategory">>,
): RecordAiUsageEventInput {
  return {
    ownerUserId: context.ownerUserId,
    clientId: context.clientId,
    analysisId: context.analysisId,
    // task section 13: the classifier's own small, distinct feature key --
    // never folded into "consultation_chat" or any downstream engine's own
    // feature key, so its usage/cost is never double-counted against
    // theirs (Video cost stays Video cost, Photo Preview cost stays Photo
    // Preview cost -- see this file's own header comment).
    feature: CONCIERGE_INTENT_CLASSIFICATION_FEATURE,
    modality: "TEXT_GENERATION",
    correlationId,
    provider: provider.name,
    model: provider.modelVersion,
    outcome,
    latencyMs,
    ...extra,
  };
}

// recordAiUsageEvent already never throws on its own (ai-usage-repository.ts's
// own documented guarantee) -- this wrapper exists only so a THEORETICAL
// future change to that contract can never turn a metering problem into a
// user-visible Concierge failure, matching consultation-chat-service.ts's
// own identical defense-in-depth wrapper around the same call.
async function safeRecordUsage(recordUsage: typeof recordAiUsageEvent, input: RecordAiUsageEventInput): Promise<void> {
  try {
    await recordUsage(input);
  } catch {
    // Intentionally swallowed -- see comment above.
  }
}

// Safe-fields-only diagnostic log (never the message content) -- mirrors
// this codebase's own established convention (e.g.
// consultation-chat-service.ts's logConsultationChatFailure).
function logConciergeClassifierFailure(providerError: Partial<OrchestratorIntentProviderError> | undefined, latencyMs: number): void {
  console.error(
    JSON.stringify({
      gate: "CONCIERGE_INTENT_CLASSIFIER",
      status: "FAILED",
      errorCode: providerError?.code ?? "UNKNOWN",
      providerErrorStatus: providerError?.status ?? null,
      latencyMs,
    }),
  );
}
