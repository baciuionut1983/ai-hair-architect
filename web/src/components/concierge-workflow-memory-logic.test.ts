import { describe, expect, it } from "vitest";

import type { OrchestratorDecision } from "@/lib/orchestrator-contracts";
import type { OrchestrationPlan } from "@/lib/orchestrator-plan-contracts";
import {
  INITIAL_WORKFLOW_MEMORY,
  resolveEffectiveContext,
  updateWorkflowMemory,
  type ConciergeWorkflowMemory,
} from "./concierge-workflow-memory-logic";

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
    ...overrides,
  };
}

function withClient(clientId: string | null, analysisId: string | null = null, overrides: Partial<OrchestratorDecision> = {}): OrchestratorDecision {
  return decision({
    currentContext: { roleClass: "professional", currentClientId: clientId, currentAnalysisId: analysisId, hasCompletedPhotoPreview: false },
    ...overrides,
  });
}

function plan(overrides: Partial<OrchestrationPlan> = {}): OrchestrationPlan {
  return {
    planId: "visualize_result:client-1",
    goal: "visualize_result",
    status: "WAITING_FOR_APPROVAL",
    currentStepId: "review_proposed_look",
    steps: [],
    ...overrides,
  };
}

function memory(overrides: Partial<ConciergeWorkflowMemory> = {}): ConciergeWorkflowMemory {
  return { ...INITIAL_WORKFLOW_MEMORY, ...overrides };
}

describe("updateWorkflowMemory -- task section 2/7/8/16 (Stage 4) + section 5/7/8/17 (Stage 5)", () => {
  it("workflow_started: the first decision to resolve a real client, from a blank slate", () => {
    const { memory: result, events } = updateWorkflowMemory(INITIAL_WORKFLOW_MEMORY, withClient("client-1", "analysis-1"));
    expect(result).toEqual(memory({ activeClientId: "client-1", activeAnalysisId: "analysis-1" }));
    expect(events).toEqual(["workflow_started"]);
  });

  it("workflow_continued: a later decision resolving the SAME client", () => {
    const first = updateWorkflowMemory(INITIAL_WORKFLOW_MEMORY, withClient("client-1", "analysis-1"));
    const { memory: result, events } = updateWorkflowMemory(first.memory, withClient("client-1", "analysis-1"));
    expect(result.activeClientId).toBe("client-1");
    expect(events).toEqual(["workflow_continued"]);
  });

  // task section 8: explicit context switching.
  it("context_switched: a decision resolving a DIFFERENT client than the one remembered", () => {
    const first = updateWorkflowMemory(INITIAL_WORKFLOW_MEMORY, withClient("client-1", "analysis-1"));
    const { memory: result, events } = updateWorkflowMemory(first.memory, withClient("client-2", "analysis-2"));
    expect(result).toEqual(memory({ activeClientId: "client-2", activeAnalysisId: "analysis-2" }));
    expect(events).toEqual(["context_switched"]);
  });

  it("no workflow event at all when the decision resolves no client (nothing to remember yet)", () => {
    const { events } = updateWorkflowMemory(INITIAL_WORKFLOW_MEMORY, withClient(null));
    expect(events).toEqual([]);
  });

  // task section 3/16: OFFER_VIDEO creates a pending decision.
  it("sets pendingDecision to VIDEO_OFFER when the decision recommends OFFER_VIDEO", () => {
    const { memory: result } = updateWorkflowMemory(
      INITIAL_WORKFLOW_MEMORY,
      withClient("client-1", "analysis-1", { recommendedAction: "OFFER_VIDEO", reasonCode: "video_offer_after_completed_preview", nextStepCode: "video_offer_after_completed_preview" }),
    );
    expect(result.pendingDecision).toBe("VIDEO_OFFER");
  });

  // task section 3/7, test D: ANY other decision clears a pending
  // decision -- accepting, declining, asking something unrelated, or
  // switching client all naturally clear it since none of them are
  // themselves OFFER_VIDEO.
  it("clears a previously-pending decision on the very next decision, whatever it is", () => {
    const offered = memory({ activeClientId: "client-1", activeAnalysisId: "analysis-1", pendingDecision: "VIDEO_OFFER" });

    const accepted = updateWorkflowMemory(offered, withClient("client-1", "analysis-1", { recommendedAction: "REQUEST_VIDEO", reasonCode: "client_and_analysis_identified", nextStepCode: "client_and_analysis_identified" }));
    expect(accepted.memory.pendingDecision).toBeNull();

    const declined = updateWorkflowMemory(offered, withClient("client-1", "analysis-1", { recommendedAction: null, reasonCode: "video_offer_declined", nextStepCode: "video_offer_declined" }));
    expect(declined.memory.pendingDecision).toBeNull();

    const unrelated = updateWorkflowMemory(offered, withClient("client-1", "analysis-1", { recommendedAction: "OPEN_ANALYSIS", reasonCode: "client_and_analysis_identified", nextStepCode: "client_and_analysis_identified" }));
    expect(unrelated.memory.pendingDecision).toBeNull();
  });

  // task section 6: DB/server truth always wins -- if the server's fresh
  // context comes back with no client at all (a deleted client, a
  // revoked forged id), memory resets right along with it, even if a
  // client WAS previously remembered.
  it("resets activeClientId/activeAnalysisId to null when the server's fresh context no longer resolves one", () => {
    const established = memory({ activeClientId: "client-1", activeAnalysisId: "analysis-1" });
    const { memory: result } = updateWorkflowMemory(established, withClient(null, null, { recommendedAction: "OPEN_CLIENTS", reasonCode: "no_client_selected", nextStepCode: "no_client_selected" }));
    expect(result.activeClientId).toBeNull();
    expect(result.activeAnalysisId).toBeNull();
  });

  // Stage 5, task section 17: plan_created.
  it("plan_created: the first decision to resolve a real plan, from a blank slate", () => {
    const { memory: result, events } = updateWorkflowMemory(INITIAL_WORKFLOW_MEMORY, withClient("client-1", "analysis-1"), plan());
    expect(result.activePlanGoal).toBe("visualize_result");
    expect(result.activePlanStepId).toBe("review_proposed_look");
    expect(events).toContain("plan_created");
  });

  it("no plan_created a second time -- a plan already being tracked doesn't re-fire it", () => {
    const first = updateWorkflowMemory(INITIAL_WORKFLOW_MEMORY, withClient("client-1", "analysis-1"), plan());
    const { events } = updateWorkflowMemory(first.memory, withClient("client-1", "analysis-1"), plan());
    expect(events).not.toContain("plan_created");
  });

  // Stage 5, task section 17: plan_step_completed -- the active step
  // genuinely changed between turns.
  it("plan_step_completed: the previously-active step is no longer the active one", () => {
    const first = updateWorkflowMemory(INITIAL_WORKFLOW_MEMORY, withClient("client-1", "analysis-1"), plan({ currentStepId: "review_proposed_look" }));
    const { events } = updateWorkflowMemory(
      first.memory,
      withClient("client-1", "analysis-1"),
      plan({ status: "WAITING_FOR_ENGINE", currentStepId: "offer_video" }),
    );
    expect(events).toContain("plan_step_completed");
  });

  it("plan_step_completed also fires when the plan finishes (currentStepId becomes null)", () => {
    const first = updateWorkflowMemory(INITIAL_WORKFLOW_MEMORY, withClient("client-1", "analysis-1"), plan({ currentStepId: "offer_video" }));
    const { events } = updateWorkflowMemory(first.memory, withClient("client-1", "analysis-1"), plan({ status: "COMPLETED", currentStepId: null }));
    expect(events).toContain("plan_step_completed");
  });

  // task section 3/7 (Stage 5 mirrors Stage 4's pendingDecision rule):
  // ANY decision without a plan clears activePlanGoal -- a completed/
  // cancelled/no-longer-applicable plan is never kept alive by stale
  // client memory.
  it("clears activePlanGoal/activePlanStepId when no plan applies this turn", () => {
    const tracking = memory({ activeClientId: "client-1", activeAnalysisId: "analysis-1", activePlanGoal: "visualize_result", activePlanStepId: "offer_video" });
    const { memory: result } = updateWorkflowMemory(tracking, withClient("client-1", "analysis-1", { recommendedAction: "OPEN_CLIENT" }), null);
    expect(result.activePlanGoal).toBeNull();
    expect(result.activePlanStepId).toBeNull();
  });
});

describe("resolveEffectiveContext -- task section 5/8 (Stage 4) + section 5 (Stage 5)", () => {
  const remembered = memory({ activeClientId: "remembered-client", activeAnalysisId: "remembered-analysis", pendingDecision: "VIDEO_OFFER", activePlanGoal: "visualize_result" });

  it("falls back to remembered memory when the page supplies no context of its own (e.g. the Dashboard)", () => {
    const effective = resolveEffectiveContext({}, remembered);
    expect(effective.currentClientId).toBe("remembered-client");
    expect(effective.currentAnalysisId).toBe("remembered-analysis");
    expect(effective.pendingDecision).toBe("VIDEO_OFFER");
    expect(effective.activePlanGoal).toBe("visualize_result");
  });

  // task section 8: real page-supplied context (e.g. route params on a
  // client/analysis-scoped page) always wins over remembered memory.
  it("prefers the page's own real context over remembered memory when both are present", () => {
    const effective = resolveEffectiveContext({ currentClientId: "page-client", currentAnalysisId: "page-analysis" }, remembered);
    expect(effective.currentClientId).toBe("page-client");
    expect(effective.currentAnalysisId).toBe("page-analysis");
  });

  it("hasCompletedPhotoPreview is never remembered -- always exactly what the page currently asserts", () => {
    expect(resolveEffectiveContext({ hasCompletedPhotoPreview: true }, remembered).hasCompletedPhotoPreview).toBe(true);
    expect(resolveEffectiveContext({}, remembered).hasCompletedPhotoPreview).toBe(false);
  });

  it("pendingDecision always comes from memory -- no page context field can supply or override it", () => {
    expect(resolveEffectiveContext({ currentClientId: "page-client" }, remembered).pendingDecision).toBe("VIDEO_OFFER");
    expect(resolveEffectiveContext({}, INITIAL_WORKFLOW_MEMORY).pendingDecision).toBeNull();
  });

  // Stage 5.
  it("activePlanGoal always comes from memory -- no page context field can supply or override it", () => {
    expect(resolveEffectiveContext({ currentClientId: "page-client" }, remembered).activePlanGoal).toBe("visualize_result");
    expect(resolveEffectiveContext({}, INITIAL_WORKFLOW_MEMORY).activePlanGoal).toBeNull();
  });
});
