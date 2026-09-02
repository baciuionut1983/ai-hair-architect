import { describe, expect, it } from "vitest";

import {
  actionIdToTranslationKey,
  buildOrchestrateRequestBody,
  CONCIERGE_MESSAGE_MAX_LENGTH,
  hasNoActionableRecommendation,
  isVideoOfferDecision,
  reasonCodeToTranslationKey,
} from "./concierge-logic";
import type { OrchestratorActionId, OrchestratorDecision, OrchestratorReasonCode } from "@/lib/orchestrator-contracts";
import { translate, type TranslationKey } from "@/lib/translations";

const ALL_REASON_CODES: OrchestratorReasonCode[] = [
  "client_and_analysis_identified",
  "client_identified_no_analysis_yet",
  "no_client_selected",
  "video_offer_after_completed_preview",
  "role_not_yet_supported",
  "intent_not_understood",
  "ambiguous_intent_needs_clarification",
  "video_offer_declined",
  "plan_cancelled",
];

const ALL_ACTION_IDS: OrchestratorActionId[] = ["OPEN_CLIENTS", "OPEN_CLIENT", "START_ANALYSIS", "OPEN_ANALYSIS", "OFFER_VIDEO", "REQUEST_VIDEO"];

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
    ...overrides,
  };
}

describe("reasonCodeToTranslationKey / actionIdToTranslationKey -- the ONLY place codes become language text (task section 9)", () => {
  it("maps every reason code to a real, translated key (English at minimum)", () => {
    for (const code of ALL_REASON_CODES) {
      const key: TranslationKey = reasonCodeToTranslationKey(code);
      expect(translate("en", key)).not.toBe("");
    }
  });

  it("maps every action id to a real, translated key", () => {
    for (const id of ALL_ACTION_IDS) {
      const key: TranslationKey = actionIdToTranslationKey(id);
      expect(translate("en", key)).not.toBe("");
    }
  });

  it("the video offer reason code maps to the exact required conversational question key", () => {
    expect(reasonCodeToTranslationKey("video_offer_after_completed_preview")).toBe("concierge.videoOffer.question");
  });

  // Stage 4: distinct copy from intentNotUnderstood/ambiguousIntentNeedsClarification.
  it("the video-offer-declined reason code maps to its own distinct, non-generic key", () => {
    const key = reasonCodeToTranslationKey("video_offer_declined");
    expect(key).toBe("concierge.info.videoOfferDeclined");
    expect(key).not.toBe(reasonCodeToTranslationKey("intent_not_understood"));
    expect(key).not.toBe(reasonCodeToTranslationKey("ambiguous_intent_needs_clarification"));
  });

  // Stage 5: same distinctness proof for the cancellation reason code.
  it("the plan-cancelled reason code maps to its own distinct, non-generic key", () => {
    const key = reasonCodeToTranslationKey("plan_cancelled");
    expect(key).toBe("concierge.info.planCancelled");
    expect(key).not.toBe(reasonCodeToTranslationKey("intent_not_understood"));
    expect(key).not.toBe(reasonCodeToTranslationKey("video_offer_declined"));
  });
});

describe("buildOrchestrateRequestBody", () => {
  it("trims the message and carries context through", () => {
    const body = buildOrchestrateRequestBody("  show me the result  ", { currentClientId: "c1", currentAnalysisId: "a1", hasCompletedPhotoPreview: true });
    expect(body).toEqual({
      message: "show me the result",
      currentClientId: "c1",
      currentAnalysisId: "a1",
      hasCompletedPhotoPreview: true,
      pendingDecision: null,
      activePlanGoal: null,
    });
  });

  it("returns null for an empty/whitespace-only message", () => {
    expect(buildOrchestrateRequestBody("   ", {})).toBeNull();
    expect(buildOrchestrateRequestBody("", {})).toBeNull();
  });

  it("returns null for a message exceeding the max length", () => {
    expect(buildOrchestrateRequestBody("x".repeat(CONCIERGE_MESSAGE_MAX_LENGTH + 1), {})).toBeNull();
  });

  it("defaults missing context fields safely", () => {
    expect(buildOrchestrateRequestBody("hello", {})).toEqual({
      message: "hello",
      currentClientId: null,
      currentAnalysisId: null,
      hasCompletedPhotoPreview: false,
      pendingDecision: null,
      activePlanGoal: null,
    });
  });

  // Stage 4.
  it("carries pendingDecision through when supplied", () => {
    const body = buildOrchestrateRequestBody("Da", { pendingDecision: "VIDEO_OFFER" });
    expect(body?.pendingDecision).toBe("VIDEO_OFFER");
  });

  // Stage 5.
  it("carries activePlanGoal through when supplied", () => {
    const body = buildOrchestrateRequestBody("continue", { activePlanGoal: "visualize_result" });
    expect(body?.activePlanGoal).toBe("visualize_result");
  });
});

describe("isVideoOfferDecision / hasNoActionableRecommendation", () => {
  it("isVideoOfferDecision is true only for the video-offer reason code", () => {
    expect(isVideoOfferDecision(decision({ reasonCode: "video_offer_after_completed_preview" }))).toBe(true);
    expect(isVideoOfferDecision(decision({ reasonCode: "no_client_selected" }))).toBe(false);
  });

  it("hasNoActionableRecommendation is true only when there is truly nothing to do", () => {
    expect(hasNoActionableRecommendation(decision({ recommendedAction: null, availableActions: [] }))).toBe(true);
    expect(hasNoActionableRecommendation(decision({ recommendedAction: "OPEN_CLIENTS", availableActions: ["OPEN_CLIENTS"] }))).toBe(false);
  });
});
