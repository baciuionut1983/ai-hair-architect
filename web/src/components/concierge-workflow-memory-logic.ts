import type { ConciergePendingDecision, OrchestratorDecision } from "@/lib/orchestrator-contracts";
import type { OrchestrationPlan, OrchestrationPlanGoal } from "@/lib/orchestrator-plan-contracts";

// AI Concierge / Orchestrator, Stage 4/5 -- pure workflow-continuity
// logic, no React, no fetch. Mirrors concierge-logic.ts's own established
// split (pure logic file, fully unit-tested; use-concierge.ts, which owns
// this state, is not).
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
//
// Stage 5 (task section 13): the SAME "no new persistence" decision
// applies to plan tracking -- activePlanGoal/activePlanStepId below are
// just two more fields on this SAME ephemeral memory object, never a
// separately-persisted plan record. The plan itself is never stored here
// either -- only its GOAL and current step id are remembered (as an echo
// hint for the next request), never its full step list; the real plan is
// always reconstructed fresh from DB state server-side (task section 14).
export interface ConciergeWorkflowMemory {
  activeClientId: string | null;
  activeAnalysisId: string | null;
  pendingDecision: ConciergePendingDecision | null;
  activePlanGoal: OrchestrationPlanGoal | null;
  activePlanStepId: string | null;
}

export const INITIAL_WORKFLOW_MEMORY: ConciergeWorkflowMemory = {
  activeClientId: null,
  activeAnalysisId: null,
  pendingDecision: null,
  activePlanGoal: null,
  activePlanStepId: null,
};

// task section 16 (Stage 4) + task section 17 (Stage 5): the workflow/plan
// continuity events that genuinely require cross-turn memory (this file's
// own reason for existing) -- every OTHER required event
// (pending_decision_created/accepted/declined/invalidated,
// plan_step_selected/waiting_for_user/waiting_for_approval/
// waiting_for_engine/blocked/cancelled) is derivable from a SINGLE
// decision/plan alone and is logged server-side instead, in
// orchestrator-service.ts's own deriveOrchestrationEvent/derivePlanEvent
// -- see those functions' own header comments for why.
// plan_replanned is reserved but never actually emitted by this stage's
// implementation: with exactly one registered, fixed-shape goal
// ("visualize_result" -- see orchestrator-plan-service.ts), the step
// SEQUENCE itself never restructures, only individual step statuses
// change turn to turn -- there is honestly nothing to detect yet. Kept in
// the type for fidelity to task section 17's own named list, exactly like
// OrchestrationPlanStatus's own PLANNED value.
export type ConciergeWorkflowEvent = "workflow_started" | "workflow_continued" | "context_switched" | "plan_created" | "plan_step_completed" | "plan_replanned";

export interface UpdateWorkflowMemoryResult {
  memory: ConciergeWorkflowMemory;
  events: ConciergeWorkflowEvent[];
}

// Recomputes the FULL remembered workflow state from ONE real decision
// (+ its accompanying plan, if any) -- never merged/accumulated with
// anything older. This single rule is what makes context invalidation,
// pending-decision clearing, AND plan tracking all correct automatically
// (task section 7/8 Stage 4, task section 5/7/8 Stage 5), with no
// separate "invalidate" branch anywhere:
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
//  - activePlanGoal/activePlanStepId are ALWAYS taken from `plan` (null
//    whenever the server didn't return one this turn) -- a plan that
//    completes, gets cancelled, or simply stops applying (e.g. the user
//    asked about something else entirely) is never kept alive by stale
//    client memory; the NEXT request will honestly stop echoing
//    activePlanGoal, exactly mirroring pendingDecision's own rule.
export function updateWorkflowMemory(
  previous: ConciergeWorkflowMemory,
  decision: OrchestratorDecision,
  plan: OrchestrationPlan | null = null,
): UpdateWorkflowMemoryResult {
  const nextActiveClientId = decision.currentContext.currentClientId;
  const nextActiveAnalysisId = decision.currentContext.currentAnalysisId;
  const nextPendingDecision: ConciergePendingDecision | null = decision.recommendedAction === "OFFER_VIDEO" ? "VIDEO_OFFER" : null;
  const nextPlanGoal = plan?.goal ?? null;
  const nextPlanStepId = plan?.currentStepId ?? null;

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

  if (nextPlanGoal && !previous.activePlanGoal) {
    events.push("plan_created");
  } else if (previous.activePlanStepId !== null && previous.activePlanStepId !== nextPlanStepId) {
    // The step that was active last turn is no longer the active one --
    // it either finished (real progress) or the whole plan finished/was
    // superseded. Either way, something concrete happened between turns.
    events.push("plan_step_completed");
  }

  return {
    memory: {
      activeClientId: nextActiveClientId,
      activeAnalysisId: nextActiveAnalysisId,
      pendingDecision: nextPendingDecision,
      activePlanGoal: nextPlanGoal,
      activePlanStepId: nextPlanStepId,
    },
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
  activePlanGoal: OrchestrationPlanGoal | null;
}

// Merges the CALLER's own real page context (route params, e.g. a future
// analysis-page-embedded Concierge -- always wins when supplied, since
// it's a fresher, more authoritative signal than several turns of
// remembered chat) with remembered workflow memory (used only as a
// fallback for whichever fields the page itself leaves unset) -- this is
// what lets "Continuă de unde am rămas" resolve richly even from a
// context-less page like the Dashboard, once a prior turn has already
// established an active client/analysis (task section 5).
// pendingDecision/activePlanGoal always come from memory alone -- no page
// ever supplies either directly, they only ever exist because a PRIOR
// decision set them.
export function resolveEffectiveContext(pageContext: ConciergePageContext, memory: ConciergeWorkflowMemory): ConciergeEffectiveContext {
  return {
    currentClientId: pageContext.currentClientId ?? memory.activeClientId,
    currentAnalysisId: pageContext.currentAnalysisId ?? memory.activeAnalysisId,
    hasCompletedPhotoPreview: pageContext.hasCompletedPhotoPreview === true,
    pendingDecision: memory.pendingDecision,
    activePlanGoal: memory.activePlanGoal,
  };
}
