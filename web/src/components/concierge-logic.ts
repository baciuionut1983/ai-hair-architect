import type { TranslationKey } from "@/lib/translations";
import type { OrchestratorActionId, OrchestratorDecision, OrchestratorReasonCode } from "@/lib/orchestrator-contracts";

// AI Concierge / Orchestrator, Stage 1 -- pure UI-facing logic, no React,
// no fetch. Mirrors video-demonstration-logic.ts's own established split
// (pure logic file, fully unit-tested; the component/hook that use it are
// not) -- keeps the orchestration DOMAIN language-independent (task
// section 9): this is the ONE place an OrchestratorReasonCode/
// OrchestratorActionId ever becomes a TranslationKey.

const REASON_CODE_TO_KEY: Record<OrchestratorReasonCode, TranslationKey> = {
  client_and_analysis_identified: "concierge.info.clientAndAnalysisIdentified",
  client_identified_no_analysis_yet: "concierge.info.clientIdentifiedNoAnalysisYet",
  no_client_selected: "concierge.info.noClientSelected",
  // The proactive video offer reuses the SAME copy the offer question
  // itself uses (task section 5's exact required phrase) -- one piece of
  // real copy, not a duplicate.
  video_offer_after_completed_preview: "concierge.videoOffer.question",
  role_not_yet_supported: "concierge.info.roleNotYetSupported",
  intent_not_understood: "concierge.info.intentNotUnderstood",
};

export function reasonCodeToTranslationKey(code: OrchestratorReasonCode): TranslationKey {
  return REASON_CODE_TO_KEY[code];
}

const ACTION_ID_TO_KEY: Record<OrchestratorActionId, TranslationKey> = {
  OPEN_CLIENTS: "concierge.action.openClients",
  OPEN_CLIENT: "concierge.action.openClient",
  START_ANALYSIS: "concierge.action.startAnalysis",
  OPEN_ANALYSIS: "concierge.action.openAnalysis",
  REQUEST_VIDEO: "concierge.action.requestVideo",
};

export function actionIdToTranslationKey(actionId: OrchestratorActionId): TranslationKey {
  return ACTION_ID_TO_KEY[actionId];
}

export interface OrchestrateRequestBody {
  message: string;
  currentClientId?: string | null;
  currentAnalysisId?: string | null;
  hasCompletedPhotoPreview?: boolean;
}

// Trims and validates a raw message before it is ever sent -- the same
// non-empty/length rule the API route itself enforces server-side (never
// trust the client-side check alone, but a real, honest client-side
// pre-check avoids a pointless round trip for a message the server would
// just reject).
export const CONCIERGE_MESSAGE_MAX_LENGTH = 2000;

export function buildOrchestrateRequestBody(
  rawMessage: string,
  context: { currentClientId?: string | null; currentAnalysisId?: string | null; hasCompletedPhotoPreview?: boolean },
): OrchestrateRequestBody | null {
  const message = rawMessage.trim();
  if (!message || message.length > CONCIERGE_MESSAGE_MAX_LENGTH) return null;

  return {
    message,
    currentClientId: context.currentClientId ?? null,
    currentAnalysisId: context.currentAnalysisId ?? null,
    hasCompletedPhotoPreview: context.hasCompletedPhotoPreview === true,
  };
}

// Whether the decision's recommended action is the conversational video
// offer specifically -- the UI renders this as a DA/NU choice (task
// section 5), never as a single navigation button, so it needs its own
// distinguishable predicate rather than just checking recommendedAction.
export function isVideoOfferDecision(decision: OrchestratorDecision): boolean {
  return decision.reasonCode === "video_offer_after_completed_preview";
}

// A decision with no recommended action at all (role not supported /
// intent not understood) still gets a "here's what you CAN do" fallback --
// task section 1's own "fail honestly and suggest available next steps."
export function hasNoActionableRecommendation(decision: OrchestratorDecision): boolean {
  return decision.recommendedAction === null && decision.availableActions.length === 0;
}
