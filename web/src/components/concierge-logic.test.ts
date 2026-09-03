import { describe, expect, it } from "vitest";

import {
  actionIdToTranslationKey,
  buildOrchestrateRequestBody,
  CONCIERGE_MESSAGE_MAX_LENGTH,
  hasNoActionableRecommendation,
  isConciergeVoiceInputBusy,
  isVideoOfferDecision,
  reasonCodeToTranslationKey,
  shouldClearComposerAfterSubmit,
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
  "client_name_ambiguous",
  "client_name_not_found",
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
    ambiguousClientCandidates: [],
    eligiblePhotoPreviewGenerationId: null,
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

  // Production Fix #1: the two new client-name-resolution reason codes each
  // map to their own distinct, honest copy -- never the generic
  // no_client_selected/intent_not_understood keys.
  it("the client-name-ambiguous and client-name-not-found reason codes map to their own distinct keys", () => {
    const ambiguousKey = reasonCodeToTranslationKey("client_name_ambiguous");
    const notFoundKey = reasonCodeToTranslationKey("client_name_not_found");
    expect(ambiguousKey).toBe("concierge.info.clientNameAmbiguous");
    expect(notFoundKey).toBe("concierge.info.clientNameNotFound");
    expect(ambiguousKey).not.toBe(notFoundKey);
    expect(ambiguousKey).not.toBe(reasonCodeToTranslationKey("no_client_selected"));
    expect(notFoundKey).not.toBe(reasonCodeToTranslationKey("no_client_selected"));
  });
});

describe("shouldClearComposerAfterSubmit -- Production Fix #1 (input clearing)", () => {
  it("clears for a real, non-empty message while not loading", () => {
    expect(shouldClearComposerAfterSubmit("Vreau să văd clientul Baciu", false)).toBe(true);
  });

  it("does not clear for an empty/whitespace-only message", () => {
    expect(shouldClearComposerAfterSubmit("", false)).toBe(false);
    expect(shouldClearComposerAfterSubmit("   ", false)).toBe(false);
  });

  it("does not clear while a request is already loading", () => {
    expect(shouldClearComposerAfterSubmit("hello", true)).toBe(false);
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
      suppressVideoOfferForPhotoPreviewId: null,
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
      suppressVideoOfferForPhotoPreviewId: null,
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

describe("isConciergeVoiceInputBusy -- Voice Input Integration", () => {
  it("is not busy when neither Concierge nor Voice is doing anything", () => {
    expect(isConciergeVoiceInputBusy(false, false)).toBe(false);
  });

  it("is busy while a Concierge orchestration request is in flight, even if Voice itself is idle", () => {
    expect(isConciergeVoiceInputBusy(true, false)).toBe(true);
  });

  it("is busy while Voice is transcribing, even if Concierge itself is idle", () => {
    expect(isConciergeVoiceInputBusy(false, true)).toBe(true);
  });

  it("is busy when both are active", () => {
    expect(isConciergeVoiceInputBusy(true, true)).toBe(true);
  });
});
