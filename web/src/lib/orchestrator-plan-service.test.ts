import { describe, expect, it } from "vitest";

import { cancelPlan, resolveVisualizeResultPlan } from "./orchestrator-plan-service";
import type { OrchestratorContext } from "./orchestrator-contracts";
import type { ProposalRecord } from "./proposal-repository";

// AI Concierge / Orchestrator, Stage 5 -- proves resolveVisualizeResultPlan's
// step-sequencing logic in complete isolation from Postgres, via a fake
// findCurrentConfirmedProposal (matching this codebase's own
// no-mocking-library convention). The real repository function's own
// correctness is already proven by proposal-repository.test.ts; a small
// number of real-Postgres integration tests in orchestrator-service.test.ts
// separately prove the real wiring end to end.

function context(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return { roleClass: "professional", currentClientId: null, currentAnalysisId: null, hasCompletedPhotoPreview: false, ...overrides };
}

function fakeProposal(confirmed: boolean): () => Promise<ProposalRecord | null> {
  return async () => (confirmed ? ({ id: "proposal-1", status: "CONFIRMED" } as unknown as ProposalRecord) : null);
}

function rejectingProposalLookup(): () => Promise<ProposalRecord | null> {
  return async () => {
    throw new Error("db unavailable");
  };
}

describe("resolveVisualizeResultPlan -- task section 2/5/6", () => {
  // task section 18, test P (partial -- the full forged-id proof lives in
  // orchestrator-service.test.ts, where context is actually re-verified;
  // this proves the plan itself never treats "no client" as anything but
  // blocked, exactly mirroring what a forged id resolves to).
  it("no client resolved -- step 1 BLOCKED, plan BLOCKED", async () => {
    const plan = await resolveVisualizeResultPlan({ ownerUserId: "owner-1", context: context(), pendingDecision: null, confirmation: null });
    expect(plan.status).toBe("BLOCKED");
    expect(plan.currentStepId).toBe("open_client");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ stepId: "open_client", action: "OPEN_CLIENT", status: "ACTIVE", blockingReason: "no_client_resolved" });
  });

  it("public role -- BLOCKED regardless of context, defense in depth", async () => {
    const plan = await resolveVisualizeResultPlan({
      ownerUserId: "owner-1",
      context: context({ roleClass: "public", currentClientId: "client-1", currentAnalysisId: "analysis-1" }),
      pendingDecision: null,
      confirmation: null,
    });
    expect(plan.status).toBe("BLOCKED");
    expect(plan.steps[0].blockingReason).toBe("role_not_supported");
  });

  it("client resolved, no analysis yet -- step 2 ACTIVE, plan ACTIVE", async () => {
    const plan = await resolveVisualizeResultPlan({
      ownerUserId: "owner-1",
      context: context({ currentClientId: "client-1" }),
      pendingDecision: null,
      confirmation: null,
    });
    expect(plan.status).toBe("ACTIVE");
    expect(plan.currentStepId).toBe("ensure_analysis");
    expect(plan.steps.map((s) => [s.stepId, s.status])).toEqual([
      ["open_client", "COMPLETED"],
      ["ensure_analysis", "ACTIVE"],
    ]);
  });

  // task section 18, test I: an existing analysis is never treated as a
  // fresh step to (re-)execute.
  it("client + analysis already exist -- step 2 is SKIPPED, never re-executed", async () => {
    const plan = await resolveVisualizeResultPlan(
      { ownerUserId: "owner-1", context: context({ currentClientId: "client-1", currentAnalysisId: "analysis-1" }), pendingDecision: null, confirmation: null },
      { findCurrentConfirmedProposal: fakeProposal(false) },
    );
    expect(plan.steps.find((s) => s.stepId === "ensure_analysis")?.status).toBe("SKIPPED");
  });

  // task section 8/18, test D: professional approval requirement stops
  // progression -- a real, honest DB-derived fact, never guessed.
  it("analysis exists, no CONFIRMED proposal -- step 3 WAITING_FOR_APPROVAL, requiresProfessionalApproval true", async () => {
    const plan = await resolveVisualizeResultPlan(
      { ownerUserId: "owner-1", context: context({ currentClientId: "client-1", currentAnalysisId: "analysis-1" }), pendingDecision: null, confirmation: null },
      { findCurrentConfirmedProposal: fakeProposal(false) },
    );
    expect(plan.status).toBe("WAITING_FOR_APPROVAL");
    expect(plan.currentStepId).toBe("review_proposed_look");
    const step = plan.steps.find((s) => s.stepId === "review_proposed_look");
    expect(step).toMatchObject({ action: "OPEN_ANALYSIS", status: "ACTIVE", blockingReason: "awaiting_professional_approval", requiresProfessionalApproval: true });
  });

  it("a proposal-read failure fails CLOSED -- never treated as approved", async () => {
    const plan = await resolveVisualizeResultPlan(
      { ownerUserId: "owner-1", context: context({ currentClientId: "client-1", currentAnalysisId: "analysis-1" }), pendingDecision: null, confirmation: null },
      { findCurrentConfirmedProposal: rejectingProposalLookup() },
    );
    expect(plan.status).toBe("WAITING_FOR_APPROVAL");
  });

  // task section 10/18, test J: Photo Preview PROCESSING (not yet
  // complete) yields WAITING_FOR_ENGINE.
  it("proposal confirmed, Photo Preview not complete -- step 4 WAITING_FOR_ENGINE", async () => {
    const plan = await resolveVisualizeResultPlan(
      { ownerUserId: "owner-1", context: context({ currentClientId: "client-1", currentAnalysisId: "analysis-1" }), pendingDecision: null, confirmation: null },
      { findCurrentConfirmedProposal: fakeProposal(true) },
    );
    expect(plan.status).toBe("WAITING_FOR_ENGINE");
    expect(plan.currentStepId).toBe("offer_video");
    expect(plan.steps.find((s) => s.stepId === "review_proposed_look")?.status).toBe("COMPLETED");
    expect(plan.steps.find((s) => s.stepId === "offer_video")).toMatchObject({ blockingReason: "awaiting_photo_preview_completion" });
  });

  // task section 18, test K: Photo Preview COMPLETED can advance to
  // OFFER_VIDEO -- the conversational offer moment.
  it("proposal confirmed, Photo Preview COMPLETED, no answer yet -- step 4 WAITING_FOR_USER", async () => {
    const plan = await resolveVisualizeResultPlan(
      {
        ownerUserId: "owner-1",
        context: context({ currentClientId: "client-1", currentAnalysisId: "analysis-1", hasCompletedPhotoPreview: true }),
        pendingDecision: null,
        confirmation: null,
      },
      { findCurrentConfirmedProposal: fakeProposal(true) },
    );
    expect(plan.status).toBe("WAITING_FOR_USER");
    expect(plan.currentStepId).toBe("offer_video");
    expect(plan.steps.find((s) => s.stepId === "offer_video")).toMatchObject({ status: "ACTIVE", blockingReason: "awaiting_user_confirmation" });
  });

  // task section 9/18, test M: YES only ever reaches existing cost
  // confirmation -- never submits Video itself.
  it("YES to the video offer -- step 5 WAITING_FOR_COST_CONFIRMATION, never further", async () => {
    const plan = await resolveVisualizeResultPlan(
      {
        ownerUserId: "owner-1",
        context: context({ currentClientId: "client-1", currentAnalysisId: "analysis-1", hasCompletedPhotoPreview: true }),
        pendingDecision: "VIDEO_OFFER",
        confirmation: "yes",
      },
      { findCurrentConfirmedProposal: fakeProposal(true) },
    );
    expect(plan.status).toBe("WAITING_FOR_COST_CONFIRMATION");
    expect(plan.currentStepId).toBe("confirm_video");
    expect(plan.steps.find((s) => s.stepId === "offer_video")?.status).toBe("COMPLETED");
    const confirmStep = plan.steps.find((s) => s.stepId === "confirm_video");
    expect(confirmStep).toMatchObject({ action: "REQUEST_VIDEO", status: "ACTIVE", blockingReason: "awaiting_cost_confirmation", requiresUserConsent: true, costClass: "MEANINGFUL_COST" });
  });

  // task section 18, test L: NO completes/skips the optional video branch.
  it("NO to the video offer -- plan COMPLETED, video step SKIPPED", async () => {
    const plan = await resolveVisualizeResultPlan(
      {
        ownerUserId: "owner-1",
        context: context({ currentClientId: "client-1", currentAnalysisId: "analysis-1", hasCompletedPhotoPreview: true }),
        pendingDecision: "VIDEO_OFFER",
        confirmation: "no",
      },
      { findCurrentConfirmedProposal: fakeProposal(true) },
    );
    expect(plan.status).toBe("COMPLETED");
    expect(plan.currentStepId).toBeNull();
    expect(plan.steps.find((s) => s.stepId === "confirm_video")?.status).toBe("SKIPPED");
  });

  it("every step's action is one of the real registered OrchestratorActionId values, never invented", async () => {
    const plan = await resolveVisualizeResultPlan(
      {
        ownerUserId: "owner-1",
        context: context({ currentClientId: "client-1", currentAnalysisId: "analysis-1", hasCompletedPhotoPreview: true }),
        pendingDecision: "VIDEO_OFFER",
        confirmation: "yes",
      },
      { findCurrentConfirmedProposal: fakeProposal(true) },
    );
    const validActions = ["OPEN_CLIENTS", "OPEN_CLIENT", "START_ANALYSIS", "OPEN_ANALYSIS", "OFFER_VIDEO", "REQUEST_VIDEO"];
    for (const step of plan.steps) {
      expect(validActions).toContain(step.action);
    }
  });

  it("planId is a stable, deterministic label for the same (goal, client) pairing", async () => {
    const planA1 = await resolveVisualizeResultPlan({ ownerUserId: "owner-1", context: context({ currentClientId: "client-1" }), pendingDecision: null, confirmation: null });
    const planA2 = await resolveVisualizeResultPlan({ ownerUserId: "owner-1", context: context({ currentClientId: "client-1" }), pendingDecision: null, confirmation: null });
    const planB = await resolveVisualizeResultPlan({ ownerUserId: "owner-1", context: context({ currentClientId: "client-2" }), pendingDecision: null, confirmation: null });
    expect(planA1.planId).toBe(planA2.planId);
    expect(planA1.planId).not.toBe(planB.planId);
    expect(planA1.goal).toBe("visualize_result");
  });

  it("every dependsOn entry references a real, already-listed stepId -- never a dangling reference", async () => {
    const plan = await resolveVisualizeResultPlan(
      {
        ownerUserId: "owner-1",
        context: context({ currentClientId: "client-1", currentAnalysisId: "analysis-1", hasCompletedPhotoPreview: true }),
        pendingDecision: "VIDEO_OFFER",
        confirmation: "yes",
      },
      { findCurrentConfirmedProposal: fakeProposal(true) },
    );
    const knownStepIds = new Set(plan.steps.map((s) => s.stepId));
    for (const step of plan.steps) {
      for (const dep of step.dependsOn) {
        expect(knownStepIds.has(dep)).toBe(true);
      }
    }
  });
});

describe("cancelPlan -- task section 11", () => {
  it("overlays CANCELLED status + null currentStepId, preserving the real step history unchanged", async () => {
    const plan = await resolveVisualizeResultPlan(
      { ownerUserId: "owner-1", context: context({ currentClientId: "client-1", currentAnalysisId: "analysis-1" }), pendingDecision: null, confirmation: null },
      { findCurrentConfirmedProposal: fakeProposal(false) },
    );
    const cancelled = cancelPlan(plan);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.currentStepId).toBeNull();
    expect(cancelled.steps).toEqual(plan.steps); // real progress is never erased
    expect(cancelled.planId).toBe(plan.planId);
    expect(cancelled.goal).toBe(plan.goal);
  });
});
