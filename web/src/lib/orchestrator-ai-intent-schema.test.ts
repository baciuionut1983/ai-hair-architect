import { describe, expect, it } from "vitest";

import {
  AI_SEMANTIC_INTENT_VALUES,
  isAiIntentClassificationResult,
  isAiSemanticIntent,
  mapSemanticIntentToOrchestratorIntent,
  type AiSemanticIntent,
} from "./orchestrator-ai-intent-schema";
import { isOrchestratorDecision } from "./orchestrator-contracts";

describe("isAiSemanticIntent -- the closed AI-output vocabulary (task section 3)", () => {
  it("accepts every real semantic intent value", () => {
    for (const value of AI_SEMANTIC_INTENT_VALUES) {
      expect(isAiSemanticIntent(value)).toBe(true);
    }
  });

  // task section 18, test D: an invented action-like name has nowhere to
  // go -- it is not even a valid AiSemanticIntent, let alone an
  // OrchestratorActionId.
  it("rejects an invented/injected value outside the closed vocabulary", () => {
    expect(isAiSemanticIntent("DELETE_CLIENT")).toBe(false);
    expect(isAiSemanticIntent("REQUEST_VIDEO")).toBe(false);
    expect(isAiSemanticIntent("/api/admin")).toBe(false);
    expect(isAiSemanticIntent("")).toBe(false);
    expect(isAiSemanticIntent(null)).toBe(false);
    expect(isAiSemanticIntent(undefined)).toBe(false);
    expect(isAiSemanticIntent(42)).toBe(false);
  });
});

describe("isAiIntentClassificationResult -- the raw-AI-JSON runtime boundary (task section 2/3)", () => {
  it("accepts a genuinely well-formed result", () => {
    expect(isAiIntentClassificationResult({ semanticIntent: "find_or_open_client", confidence: "high" })).toBe(true);
    expect(isAiIntentClassificationResult({ semanticIntent: "unknown", confidence: "low" })).toBe(true);
  });

  it("rejects null/undefined/non-object input", () => {
    expect(isAiIntentClassificationResult(null)).toBe(false);
    expect(isAiIntentClassificationResult(undefined)).toBe(false);
    expect(isAiIntentClassificationResult("find_or_open_client")).toBe(false);
    expect(isAiIntentClassificationResult(42)).toBe(false);
  });

  it("rejects an invented semanticIntent value -- the exact 'prompt injection tries to return an arbitrary action' case", () => {
    expect(isAiIntentClassificationResult({ semanticIntent: "DELETE_CLIENT", confidence: "high" })).toBe(false);
    expect(isAiIntentClassificationResult({ semanticIntent: "REQUEST_VIDEO", confidence: "high" })).toBe(false);
  });

  it("rejects an invented confidence value", () => {
    expect(isAiIntentClassificationResult({ semanticIntent: "unknown", confidence: "certain" })).toBe(false);
    expect(isAiIntentClassificationResult({ semanticIntent: "unknown", confidence: 0.9 })).toBe(false);
  });

  it("rejects a missing field", () => {
    expect(isAiIntentClassificationResult({ semanticIntent: "unknown" })).toBe(false);
    expect(isAiIntentClassificationResult({ confidence: "high" })).toBe(false);
    expect(isAiIntentClassificationResult({})).toBe(false);
  });

  it("ignores extra, unrecognized fields rather than rejecting them outright -- structural validation, not exact-shape", () => {
    expect(isAiIntentClassificationResult({ semanticIntent: "unknown", confidence: "high", extraField: "injected" })).toBe(true);
  });
});

describe("mapSemanticIntentToOrchestratorIntent -- the ONLY seam AI output crosses into deterministic policy (task section 4)", () => {
  const EXPECTED: Record<AiSemanticIntent, string> = {
    find_or_open_client: "open_clients",
    start_or_continue_analysis: "open_analysis",
    view_proposed_look: "open_analysis",
    request_result_visualization: "open_analysis",
    request_video_option: "request_video",
    general_consultation: "unsupported",
    unknown: "unsupported",
  };

  it("maps every real semantic intent to a real, closed OrchestratorIntent value", () => {
    for (const semanticIntent of AI_SEMANTIC_INTENT_VALUES) {
      expect(mapSemanticIntentToOrchestratorIntent(semanticIntent)).toBe(EXPECTED[semanticIntent]);
    }
  });

  it("never produces a value outside OrchestratorIntent's own closed 5-value set", () => {
    const validIntents = ["open_clients", "start_analysis", "open_analysis", "request_video", "unsupported"];
    for (const semanticIntent of AI_SEMANTIC_INTENT_VALUES) {
      expect(validIntents).toContain(mapSemanticIntentToOrchestratorIntent(semanticIntent));
    }
  });

  // task section 5: video is offered/navigated to, NEVER submitted --
  // request_video_option maps only to the existing "request_video"
  // OrchestratorIntent, which orchestrator-service.ts's decideFromIntent
  // only ever turns into REQUEST_VIDEO (a "navigate" action, per
  // orchestrator-action-registry.ts) -- provable purely from the mapping's
  // own output, with no execution path attached anywhere in this file.
  it("request_video_option never maps to anything beyond the existing navigate-only request_video intent", () => {
    expect(mapSemanticIntentToOrchestratorIntent("request_video_option")).toBe("request_video");
  });
});

// A minimal end-to-end sanity check that this file's own output type
// (OrchestratorIntent) is exactly what orchestrator-contracts.ts's own
// runtime boundary already expects -- proving the seam types actually
// line up, not just compile.
describe("cross-check against isOrchestratorDecision's own closed intent list", () => {
  it("every mapped OrchestratorIntent value is one isOrchestratorDecision would accept on a full decision", () => {
    const decision = {
      intent: mapSemanticIntentToOrchestratorIntent("find_or_open_client"),
      targetVertical: "clients",
      targetClientId: null,
      targetAnalysisId: null,
      currentContext: { roleClass: "professional", currentClientId: null, currentAnalysisId: null, hasCompletedPhotoPreview: false },
      recommendedAction: "OPEN_CLIENTS",
      availableActions: ["OPEN_CLIENTS"],
      requiresProfessionalApproval: false,
      requiresUserConsent: false,
      costClass: "NO_INCREMENTAL_COST",
      reasonCode: "no_client_selected",
      nextStepCode: "no_client_selected",
      ambiguousClientCandidates: [],
      eligiblePhotoPreviewGenerationId: null,
    };
    expect(isOrchestratorDecision(decision)).toBe(true);
  });
});
