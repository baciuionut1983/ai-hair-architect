import { describe, expect, it } from "vitest";

import { isOrchestrationPlan, isOrchestrationPlanGoal, type OrchestrationPlan, type OrchestrationPlanStep } from "./orchestrator-plan-contracts";
import { ORCHESTRATOR_ACTION_REGISTRY } from "./orchestrator-action-registry";

function step(overrides: Partial<OrchestrationPlanStep> = {}): OrchestrationPlanStep {
  return {
    stepId: "open_client",
    action: "OPEN_CLIENT",
    status: "ACTIVE",
    requiresContext: false,
    requiresProfessionalApproval: false,
    requiresUserConsent: false,
    costClass: "NO_INCREMENTAL_COST",
    blockingReason: "no_client_resolved",
    dependsOn: [],
    ...overrides,
  };
}

function plan(overrides: Partial<OrchestrationPlan> = {}): OrchestrationPlan {
  return {
    planId: "visualize_result:client-1",
    goal: "visualize_result",
    status: "BLOCKED",
    currentStepId: "open_client",
    steps: [step()],
    ...overrides,
  };
}

describe("isOrchestrationPlanGoal", () => {
  it("accepts the one real goal", () => {
    expect(isOrchestrationPlanGoal("visualize_result")).toBe(true);
  });

  it("rejects an invented goal", () => {
    expect(isOrchestrationPlanGoal("delete_everything")).toBe(false);
    expect(isOrchestrationPlanGoal("")).toBe(false);
    expect(isOrchestrationPlanGoal(null)).toBe(false);
  });
});

describe("isOrchestrationPlan -- the runtime boundary (task section 2/3)", () => {
  it("accepts a genuinely well-formed plan", () => {
    expect(isOrchestrationPlan(plan())).toBe(true);
  });

  it("rejects null/undefined/non-object input", () => {
    expect(isOrchestrationPlan(null)).toBe(false);
    expect(isOrchestrationPlan(undefined)).toBe(false);
    expect(isOrchestrationPlan("plan")).toBe(false);
  });

  it("rejects an invented goal", () => {
    expect(isOrchestrationPlan(plan({ goal: "take_over_the_app" as never }))).toBe(false);
  });

  it("rejects an invented plan status", () => {
    expect(isOrchestrationPlan(plan({ status: "AUTONOMOUSLY_EXECUTING" as never }))).toBe(false);
  });

  // task section 3/18, test B/R: the exact "AI invents an action" case --
  // a step whose action is not a real registered OrchestratorActionId.
  it("rejects a step with an invented/unregistered action id", () => {
    expect(isOrchestrationPlan(plan({ steps: [step({ action: "DELETE_CLIENT" as never })] }))).toBe(false);
    expect(isOrchestrationPlan(plan({ steps: [step({ action: "GENERATE_VIDEO_NOW" as never })] }))).toBe(false);
    expect(isOrchestrationPlan(plan({ steps: [step({ action: "ADMIN_ACTION" as never })] }))).toBe(false);
  });

  it("rejects an invented step status", () => {
    expect(isOrchestrationPlan(plan({ steps: [step({ status: "AUTO_RUNNING" as never })] }))).toBe(false);
  });

  it("rejects an invented blockingReason", () => {
    expect(isOrchestrationPlan(plan({ steps: [step({ blockingReason: "because_i_said_so" as never })] }))).toBe(false);
  });

  it("accepts a null blockingReason (an unblocked step)", () => {
    expect(isOrchestrationPlan(plan({ steps: [step({ blockingReason: null })] }))).toBe(true);
  });

  it("rejects a currentStepId that does not reference any real step in the plan", () => {
    expect(isOrchestrationPlan(plan({ currentStepId: "a-step-that-does-not-exist" }))).toBe(false);
  });

  it("accepts a null currentStepId (nothing left to do -- e.g. COMPLETED/CANCELLED)", () => {
    expect(isOrchestrationPlan(plan({ status: "COMPLETED", currentStepId: null, steps: [step({ status: "COMPLETED", blockingReason: null })] }))).toBe(
      true,
    );
  });

  it("rejects dependsOn entries that are not strings", () => {
    expect(isOrchestrationPlan(plan({ steps: [step({ dependsOn: [42 as never] })] }))).toBe(false);
  });

  it("rejects a malformed step (missing required fields)", () => {
    expect(isOrchestrationPlan(plan({ steps: [{ stepId: "x" } as never] }))).toBe(false);
  });
});

// Guards against orchestrator-plan-contracts.ts's own internal action-id
// allowlist silently drifting from the real registry (this file
// deliberately does not import the registry itself, to avoid a dependency
// cycle -- see its own header comment) -- this test is the seam that
// would catch a future new action id added to the registry but forgotten
// here.
describe("plan-contracts action-id allowlist stays in sync with the real registry", () => {
  it("every real registered action id is accepted as a plan step action", () => {
    for (const actionId of Object.keys(ORCHESTRATOR_ACTION_REGISTRY)) {
      expect(isOrchestrationPlan(plan({ steps: [step({ action: actionId as never })] }))).toBe(true);
    }
  });
});
