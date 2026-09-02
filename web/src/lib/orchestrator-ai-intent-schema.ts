import type { OrchestratorIntent } from "@/lib/orchestrator-contracts";

// AI Concierge / Orchestrator, Stage 3 -- the SMALL, constrained semantic
// vocabulary an AI classifier is allowed to produce (task section 3: "the
// model must return a small constrained semantic result... use the
// smallest representation that fits the existing architecture").
//
// This is deliberately NOT the same type as OrchestratorIntent
// (orchestrator-contracts.ts). That stays the deterministic domain's own
// closed vocabulary, produced only by decideFromIntent's already-tested
// policy logic (orchestrator-service.ts). This file is the seam ONE step
// upstream of it: what a natural-language classifier (deterministic or,
// new in Stage 3, AI-backed) is allowed to claim it understood, before
// mapSemanticIntentToOrchestratorIntent below ever turns that into
// something the deterministic policy layer acts on. The AI output can
// NEVER be an OrchestratorActionId, a URL, an API route, or any other
// executable value -- only one of these seven strings.
export type AiSemanticIntent =
  | "find_or_open_client"
  | "start_or_continue_analysis"
  | "view_proposed_look"
  | "request_result_visualization"
  | "request_video_option"
  | "general_consultation"
  | "unknown";

export const AI_SEMANTIC_INTENT_VALUES: readonly AiSemanticIntent[] = [
  "find_or_open_client",
  "start_or_continue_analysis",
  "view_proposed_look",
  "request_result_visualization",
  "request_video_option",
  "general_consultation",
  "unknown",
];

export function isAiSemanticIntent(value: unknown): value is AiSemanticIntent {
  return typeof value === "string" && (AI_SEMANTIC_INTENT_VALUES as readonly string[]).includes(value);
}

// The AI classifier's own confidence in its `semanticIntent` guess.
// Deliberately a two-value enum, not a numeric score: a fabricated-looking
// float (e.g. 0.73) would imply a precision this small a classifier call
// can't honestly back up, and every consumer only ever needs a binary
// "trust this enough to act on it, or don't" decision (task section 9).
export type AiIntentClassificationConfidence = "high" | "low";

export interface AiIntentClassificationResult {
  semanticIntent: AiSemanticIntent;
  confidence: AiIntentClassificationConfidence;
}

// The runtime boundary for RAW AI JSON (task section 2/3: "avoid arbitrary
// unvalidated AI JSON crossing into execution code") -- mirrors
// isOrchestratorDecision's own role in orchestrator-contracts.ts, but one
// step further upstream, at the exact point untrusted model output first
// enters this codebase. An AI provider implementation (e.g.
// orchestrator-ai-intent-provider-gemini.ts) already validates its own raw
// response against this same closed shape before ever returning it -- the
// hybrid classifier (orchestrator-hybrid-classifier.ts) re-checks here
// anyway, defense in depth, exactly like buildDecision's own re-check of
// isOrchestratorDecision downstream.
export function isAiIntentClassificationResult(value: unknown): value is AiIntentClassificationResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isAiSemanticIntent(candidate.semanticIntent)) return false;
  if (candidate.confidence !== "high" && candidate.confidence !== "low") return false;
  return true;
}

// The ONE place a validated AI semantic intent becomes a deterministic
// OrchestratorIntent (task section 4's required chain: "AI semantic
// interpretation -> validated semantic intent -> deterministic server-side
// action registry"). Pure, total, and deliberately coarse: several
// semantic intents collapse onto the SAME OrchestratorIntent because this
// app's real, existing navigation surface (Stage 1/2) only has ONE place
// that shows a proposed look, a photo preview, or a visualized result --
// the analysis page itself (OPEN_ANALYSIS). Keeping them distinct at the
// AiSemanticIntent level (rather than collapsing the vocabulary itself)
// costs nothing today and leaves room for a later stage to route
// view_proposed_look and request_result_visualization to two genuinely
// different real pages, if that ever exists, without a prompt/schema
// change -- see decideFromIntent's own "open_analysis" case
// (orchestrator-service.ts) for how it ALREADY distinguishes "continue an
// existing analysis" from "start one" purely from real, server-verified
// context, which is exactly task section 6's own contextual-reasoning
// requirement, satisfied here with zero new branching.
//
// general_consultation intentionally maps to the SAME "unsupported"
// intent as unknown -- the Concierge has no registered action for
// open-ended conversation (that already exists elsewhere, as Consult AI,
// a completely separate surface this task does not touch), so pretending
// otherwise would violate task section 7 ("never simulate completion").
// Kept as its own AiSemanticIntent value anyway, purely for observability
// (orchestrator-hybrid-classifier.ts's own logging distinguishes "the
// model recognized this as general chat" from "the model was genuinely
// lost"), never for a different user-facing outcome.
export function mapSemanticIntentToOrchestratorIntent(semanticIntent: AiSemanticIntent): OrchestratorIntent {
  switch (semanticIntent) {
    case "find_or_open_client":
      return "open_clients";
    case "start_or_continue_analysis":
    case "view_proposed_look":
    case "request_result_visualization":
      return "open_analysis";
    case "request_video_option":
      return "request_video";
    case "general_consultation":
    case "unknown":
      return "unsupported";
    default: {
      const exhaustiveCheck: never = semanticIntent;
      return exhaustiveCheck;
    }
  }
}
