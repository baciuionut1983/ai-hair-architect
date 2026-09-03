import { describe, expect, it } from "vitest";

import type { OrchestratorDecision } from "@/lib/orchestrator-contracts";
import { buildVideoOfferCheckRequestBody, interpretVideoOfferDecision } from "./concierge-video-offer-logic";

function decision(overrides: Partial<OrchestratorDecision> = {}): OrchestratorDecision {
  return {
    intent: "open_clients",
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
    ...overrides,
  };
}

describe("buildVideoOfferCheckRequestBody", () => {
  it("builds a context-only body -- no message field, ever", () => {
    const body = buildVideoOfferCheckRequestBody("client-1", "analysis-1");
    expect(body).toEqual({ currentClientId: "client-1", currentAnalysisId: "analysis-1", hasCompletedPhotoPreview: true });
    expect(body).not.toHaveProperty("message");
  });
});

describe("interpretVideoOfferDecision -- test A/B (task section 13)", () => {
  it("A: a real OFFER_VIDEO decision (from a COMPLETED Photo Preview) interprets as offered", () => {
    const offerDecision = decision({
      recommendedAction: "OFFER_VIDEO",
      reasonCode: "video_offer_after_completed_preview",
      nextStepCode: "video_offer_after_completed_preview",
      costClass: "NO_INCREMENTAL_COST",
      requiresUserConsent: false,
    });
    expect(interpretVideoOfferDecision(offerDecision)).toBe("offered");
  });

  it("B: any other decision (non-completed Photo Preview, or any other reason) interprets as not_offered", () => {
    expect(interpretVideoOfferDecision(decision({ reasonCode: "no_client_selected" }))).toBe("not_offered");
    expect(interpretVideoOfferDecision(decision({ reasonCode: "role_not_yet_supported" }))).toBe("not_offered");
    expect(interpretVideoOfferDecision(decision({ reasonCode: "client_and_analysis_identified", recommendedAction: "OPEN_ANALYSIS" }))).toBe("not_offered");
  });
});
