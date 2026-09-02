import { describe, expect, it } from "vitest";

import type { OrchestratorDecision } from "@/lib/orchestrator-contracts";
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
    ...overrides,
  };
}

function withClient(clientId: string | null, analysisId: string | null = null, overrides: Partial<OrchestratorDecision> = {}): OrchestratorDecision {
  return decision({
    currentContext: { roleClass: "professional", currentClientId: clientId, currentAnalysisId: analysisId, hasCompletedPhotoPreview: false },
    ...overrides,
  });
}

describe("updateWorkflowMemory -- task section 2/7/8/16", () => {
  it("workflow_started: the first decision to resolve a real client, from a blank slate", () => {
    const { memory, events } = updateWorkflowMemory(INITIAL_WORKFLOW_MEMORY, withClient("client-1", "analysis-1"));
    expect(memory).toEqual({ activeClientId: "client-1", activeAnalysisId: "analysis-1", pendingDecision: null });
    expect(events).toEqual(["workflow_started"]);
  });

  it("workflow_continued: a later decision resolving the SAME client", () => {
    const first = updateWorkflowMemory(INITIAL_WORKFLOW_MEMORY, withClient("client-1", "analysis-1"));
    const { memory, events } = updateWorkflowMemory(first.memory, withClient("client-1", "analysis-1"));
    expect(memory.activeClientId).toBe("client-1");
    expect(events).toEqual(["workflow_continued"]);
  });

  // task section 8: explicit context switching.
  it("context_switched: a decision resolving a DIFFERENT client than the one remembered", () => {
    const first = updateWorkflowMemory(INITIAL_WORKFLOW_MEMORY, withClient("client-1", "analysis-1"));
    const { memory, events } = updateWorkflowMemory(first.memory, withClient("client-2", "analysis-2"));
    expect(memory).toEqual({ activeClientId: "client-2", activeAnalysisId: "analysis-2", pendingDecision: null });
    expect(events).toEqual(["context_switched"]);
  });

  it("no workflow event at all when the decision resolves no client (nothing to remember yet)", () => {
    const { events } = updateWorkflowMemory(INITIAL_WORKFLOW_MEMORY, withClient(null));
    expect(events).toEqual([]);
  });

  // task section 3/16: OFFER_VIDEO creates a pending decision.
  it("sets pendingDecision to VIDEO_OFFER when the decision recommends OFFER_VIDEO", () => {
    const { memory } = updateWorkflowMemory(
      INITIAL_WORKFLOW_MEMORY,
      withClient("client-1", "analysis-1", { recommendedAction: "OFFER_VIDEO", reasonCode: "video_offer_after_completed_preview", nextStepCode: "video_offer_after_completed_preview" }),
    );
    expect(memory.pendingDecision).toBe("VIDEO_OFFER");
  });

  // task section 3/7, test D: ANY other decision clears a pending
  // decision -- accepting, declining, asking something unrelated, or
  // switching client all naturally clear it since none of them are
  // themselves OFFER_VIDEO.
  it("clears a previously-pending decision on the very next decision, whatever it is", () => {
    const offered: ConciergeWorkflowMemory = { activeClientId: "client-1", activeAnalysisId: "analysis-1", pendingDecision: "VIDEO_OFFER" };

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
    const established: ConciergeWorkflowMemory = { activeClientId: "client-1", activeAnalysisId: "analysis-1", pendingDecision: null };
    const { memory } = updateWorkflowMemory(established, withClient(null, null, { recommendedAction: "OPEN_CLIENTS", reasonCode: "no_client_selected", nextStepCode: "no_client_selected" }));
    expect(memory.activeClientId).toBeNull();
    expect(memory.activeAnalysisId).toBeNull();
  });
});

describe("resolveEffectiveContext -- task section 5/8", () => {
  const memory: ConciergeWorkflowMemory = { activeClientId: "remembered-client", activeAnalysisId: "remembered-analysis", pendingDecision: "VIDEO_OFFER" };

  it("falls back to remembered memory when the page supplies no context of its own (e.g. the Dashboard)", () => {
    const effective = resolveEffectiveContext({}, memory);
    expect(effective.currentClientId).toBe("remembered-client");
    expect(effective.currentAnalysisId).toBe("remembered-analysis");
    expect(effective.pendingDecision).toBe("VIDEO_OFFER");
  });

  // task section 8: real page-supplied context (e.g. route params on a
  // client/analysis-scoped page) always wins over remembered memory.
  it("prefers the page's own real context over remembered memory when both are present", () => {
    const effective = resolveEffectiveContext({ currentClientId: "page-client", currentAnalysisId: "page-analysis" }, memory);
    expect(effective.currentClientId).toBe("page-client");
    expect(effective.currentAnalysisId).toBe("page-analysis");
  });

  it("hasCompletedPhotoPreview is never remembered -- always exactly what the page currently asserts", () => {
    expect(resolveEffectiveContext({ hasCompletedPhotoPreview: true }, memory).hasCompletedPhotoPreview).toBe(true);
    expect(resolveEffectiveContext({}, memory).hasCompletedPhotoPreview).toBe(false);
  });

  it("pendingDecision always comes from memory -- no page context field can supply or override it", () => {
    expect(resolveEffectiveContext({ currentClientId: "page-client" }, memory).pendingDecision).toBe("VIDEO_OFFER");
    expect(resolveEffectiveContext({}, INITIAL_WORKFLOW_MEMORY).pendingDecision).toBeNull();
  });
});
