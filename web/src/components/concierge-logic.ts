import type { TranslationKey } from "@/lib/translations";
import type { ConciergePendingDecision, OrchestratorActionId, OrchestratorDecision, OrchestratorReasonCode } from "@/lib/orchestrator-contracts";
import type { OrchestrationPlanGoal } from "@/lib/orchestrator-plan-contracts";

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
  // Stage 3: distinct copy from intentNotUnderstood -- the classifier
  // recognized something plausible but isn't confident enough to act on
  // one specific option (orchestrator-hybrid-classifier.ts's own
  // "clarification" source).
  ambiguous_intent_needs_clarification: "concierge.info.ambiguousIntentNeedsClarification",
  // Stage 4: a bare "no" reply to a pending video offer -- a clean,
  // honest acknowledgment, never conflated with "I didn't understand."
  video_offer_declined: "concierge.info.videoOfferDeclined",
  // Stage 5: a recognized "Stop."/"Anulează." -- future orchestration
  // steps stop; never implies a real provider operation was cancelled.
  plan_cancelled: "concierge.info.planCancelled",
  // Production Fix #1 (client name resolution): a candidate name matched
  // more than one real, owner-scoped client -- see
  // orchestrator-client-name-resolver.ts. The real candidates themselves
  // ride on OrchestratorDecision.ambiguousClientCandidates, rendered
  // separately (see concierge-panel.tsx).
  client_name_ambiguous: "concierge.info.clientNameAmbiguous",
  // Production Fix #1: a candidate name matched no real, owner-scoped
  // client -- distinct, more honest copy than the generic
  // noClientSelected (which also covers "no name was mentioned at all").
  client_name_not_found: "concierge.info.clientNameNotFound",
};

export function reasonCodeToTranslationKey(code: OrchestratorReasonCode): TranslationKey {
  return REASON_CODE_TO_KEY[code];
}

const ACTION_ID_TO_KEY: Record<OrchestratorActionId, TranslationKey> = {
  OPEN_CLIENTS: "concierge.action.openClients",
  OPEN_CLIENT: "concierge.action.openClient",
  START_ANALYSIS: "concierge.action.startAnalysis",
  OPEN_ANALYSIS: "concierge.action.openAnalysis",
  // Stage 2: OFFER_VIDEO is presentational (see orchestrator-action-registry.ts) --
  // it is never rendered as a generic action button by ConciergePanel in
  // practice (the dedicated ConciergeVideoOffer component handles it), but
  // this Record must stay exhaustive. Reuses the exact same question copy
  // reasonCodeToTranslationKey already maps to for this same moment.
  OFFER_VIDEO: "concierge.videoOffer.question",
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
  // Stage 4: echoes whatever the caller's own remembered workflow memory
  // (concierge-workflow-memory-logic.ts) currently believes is pending --
  // null/undefined whenever nothing is. Purely a hint; see
  // orchestrator-service.ts's own header comment on why this is never
  // trusted as authority server-side.
  pendingDecision?: ConciergePendingDecision | null;
  // Stage 5: the SAME echo pattern, for whichever OrchestrationPlanGoal
  // (if any) the caller is still tracking -- see orchestrator-service.ts's
  // own header comment on ResolveOrchestratorDecisionInput.activePlanGoal.
  activePlanGoal?: OrchestrationPlanGoal | null;
}

// Trims and validates a raw message before it is ever sent -- the same
// non-empty/length rule the API route itself enforces server-side (never
// trust the client-side check alone, but a real, honest client-side
// pre-check avoids a pointless round trip for a message the server would
// just reject).
export const CONCIERGE_MESSAGE_MAX_LENGTH = 2000;

export function buildOrchestrateRequestBody(
  rawMessage: string,
  context: {
    currentClientId?: string | null;
    currentAnalysisId?: string | null;
    hasCompletedPhotoPreview?: boolean;
    pendingDecision?: ConciergePendingDecision | null;
    activePlanGoal?: OrchestrationPlanGoal | null;
  },
): OrchestrateRequestBody | null {
  const message = rawMessage.trim();
  if (!message || message.length > CONCIERGE_MESSAGE_MAX_LENGTH) return null;

  return {
    message,
    currentClientId: context.currentClientId ?? null,
    currentAnalysisId: context.currentAnalysisId ?? null,
    hasCompletedPhotoPreview: context.hasCompletedPhotoPreview === true,
    pendingDecision: context.pendingDecision ?? null,
    activePlanGoal: context.activePlanGoal ?? null,
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

// Production Fix #1 (input clearing): the real production bug was that
// ConciergePanel's handleSubmit called ask(message) but never reset the
// composer's own local state -- the same text stayed in the box and could
// visually concatenate with whatever the professional typed next. This is
// the exact same non-empty/not-already-loading guard handleSubmit already
// uses to decide whether to send at all, pulled out as its own pure,
// testable predicate: this codebase has no component-test harness (no
// jsdom/testing-library configured -- see vitest.config.ts), so the DOM
// effect of clearing can only be proven by a real browser check, but the
// DECISION of when to clear is fully regression-tested here.
export function shouldClearComposerAfterSubmit(rawMessage: string, isLoading: boolean): boolean {
  return rawMessage.trim().length > 0 && !isLoading;
}
