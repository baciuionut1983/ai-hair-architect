import type { ConciergePendingDecision, OrchestratorDecision } from "@/lib/orchestrator-contracts";

// AI Concierge / Orchestrator, Stage 4 -- pure workflow-continuity logic,
// no React, no fetch. Mirrors concierge-logic.ts's own established split
// (pure logic file, fully unit-tested; use-concierge.ts, which owns this
// state, is not).
//
// PERSISTENCE STRATEGY (task section 14): plain in-memory React state in
// use-concierge.ts -- NOT sessionStorage/localStorage, NOT a new DB model.
// This is a deliberate choice, not an oversight: task section 7 explicitly
// wants a page reload/browser restart to invalidate remembered context,
// and task section 15 wants one tab's context to never leak into another
// -- in-memory React state gives BOTH properties for free (a reload
// re-mounts the component with a blank slate; each tab has its own,
// completely independent module/component instance), with zero new
// persistence code, matching task section 14's own explicit preference
// ("prefer no migration if continuity can be safely achieved using
// existing architecture"). The tradeoff (a same-tab reload also forgets
// context) is exactly what task section 7 asks for, not a limitation to
// work around.
export interface ConciergeWorkflowMemory {
  activeClientId: string | null;
  activeAnalysisId: string | null;
  pendingDecision: ConciergePendingDecision | null;
}

export const INITIAL_WORKFLOW_MEMORY: ConciergeWorkflowMemory = {
  activeClientId: null,
  activeAnalysisId: null,
  pendingDecision: null,
};

// task section 16: the two workflow-continuity events that genuinely
// require cross-turn memory (this file's own reason for existing) -- the
// other four required events (pending_decision_created/accepted/declined/
// invalidated) are all derivable from a SINGLE decision alone and are
// logged server-side instead, in orchestrator-service.ts's own
// deriveOrchestrationEvent -- see that function's header comment for why.
export type ConciergeWorkflowEvent = "workflow_started" | "workflow_continued" | "context_switched";

export interface UpdateWorkflowMemoryResult {
  memory: ConciergeWorkflowMemory;
  events: ConciergeWorkflowEvent[];
}

// Recomputes the FULL remembered workflow state from ONE real decision --
// never merged/accumulated with anything older. This single rule is what
// makes context invalidation and pending-decision clearing both correct
// automatically (task section 7/8), with no separate "invalidate" branch
// anywhere:
//  - pendingDecision is ALWAYS replaced, never carried over -- accepting,
//    declining, asking something unrelated, or switching client all
//    naturally produce a decision that ISN'T OFFER_VIDEO, so the old
//    pending decision is gone the moment anything else happens (task
//    section 3/7: no stale pending decision can ever outlive one turn
//    where it wasn't the active topic).
//  - activeClientId/activeAnalysisId are ALWAYS taken from
//    decision.currentContext, the SAME already-server-verified echo every
//    other field on the decision is built from -- never
//    decision.targetClientId (null for many decision kinds) and never a
//    value this function invents. If the server's own fresh context comes
//    back null (a deleted client, a revoked forged id, anything), memory
//    resets to null right along with it -- DB truth always wins over
//    whatever was previously remembered (task section 6).
export function updateWorkflowMemory(previous: ConciergeWorkflowMemory, decision: OrchestratorDecision): UpdateWorkflowMemoryResult {
  const nextActiveClientId = decision.currentContext.currentClientId;
  const nextActiveAnalysisId = decision.currentContext.currentAnalysisId;
  const nextPendingDecision: ConciergePendingDecision | null = decision.recommendedAction === "OFFER_VIDEO" ? "VIDEO_OFFER" : null;

  const events: ConciergeWorkflowEvent[] = [];
  if (nextActiveClientId) {
    if (!previous.activeClientId) {
      events.push("workflow_started");
    } else if (previous.activeClientId !== nextActiveClientId) {
      // task section 8: an explicit subject/client change -- the OLD
      // client's own pending decision is already gone by construction
      // (nextPendingDecision above is scoped to THIS decision, not the
      // previous client's).
      events.push("context_switched");
    } else {
      events.push("workflow_continued");
    }
  }

  return {
    memory: { activeClientId: nextActiveClientId, activeAnalysisId: nextActiveAnalysisId, pendingDecision: nextPendingDecision },
    events,
  };
}

export interface ConciergePageContext {
  currentClientId?: string | null;
  currentAnalysisId?: string | null;
  hasCompletedPhotoPreview?: boolean;
}

export interface ConciergeEffectiveContext {
  currentClientId: string | null;
  currentAnalysisId: string | null;
  hasCompletedPhotoPreview: boolean;
  pendingDecision: ConciergePendingDecision | null;
}

// Merges the CALLER's own real page context (route params, e.g. a future
// analysis-page-embedded Concierge -- always wins when supplied, since
// it's a fresher, more authoritative signal than several turns of
// remembered chat) with remembered workflow memory (used only as a
// fallback for whichever fields the page itself leaves unset) -- this is
// what lets "Continuă de unde am rămas" resolve richly even from a
// context-less page like the Dashboard, once a prior turn has already
// established an active client/analysis (task section 5).
// pendingDecision always comes from memory alone -- no page ever supplies
// it directly, it only ever exists because a PRIOR decision set it.
export function resolveEffectiveContext(pageContext: ConciergePageContext, memory: ConciergeWorkflowMemory): ConciergeEffectiveContext {
  return {
    currentClientId: pageContext.currentClientId ?? memory.activeClientId,
    currentAnalysisId: pageContext.currentAnalysisId ?? memory.activeAnalysisId,
    hasCompletedPhotoPreview: pageContext.hasCompletedPhotoPreview === true,
    pendingDecision: memory.pendingDecision,
  };
}
