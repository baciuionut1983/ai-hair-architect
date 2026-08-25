import { describe, expect, it } from "vitest";

import { decideNextAction } from "./decide-next-action.js";
import { initialRunState } from "./persistence.js";
import { validateTaskContract } from "./task-contract.js";
import type { ExecutorOutcome } from "./stream-events.js";
import type { TaskContract } from "./types.js";

function contract(overrides: Partial<TaskContract> = {}): TaskContract {
  const result = validateTaskContract({
    taskId: "task-1",
    title: "TTS A/B experiment",
    approvedPrompt: "Do the approved thing.",
    scope: ["TTS experiment"],
    protectedAreas: ["VAD", "billing", "auth"],
    requiredChecks: ["web_typecheck", "web_lint", "web_tests_relevant", "web_build"],
    ...overrides,
  });
  if (!result.ok) throw new Error("test fixture contract is invalid");
  return result.contract;
}

function outcome(overrides: Partial<ExecutorOutcome> = {}): ExecutorOutcome {
  return { status: "completed_success", detail: "result event with subtype success", sessionId: "abc-123", apiRetryCount: 0, ...overrides };
}

describe("decideNextAction -- PREFLIGHT_RESULT", () => {
  it("moves forward on a clean preflight", () => {
    const action = decideNextAction(initialRunState("task-1"), contract(), { type: "PREFLIGHT_RESULT", clean: true });
    expect(action.event).toEqual({ type: "PREFLIGHT_PASSED" });
  });

  it("escalates immediately on a dirty preflight -- never launches the executor", () => {
    const action = decideNextAction(initialRunState("task-1"), contract(), {
      type: "PREFLIGHT_RESULT",
      clean: false,
      reason: "uncommitted changes from a prior session",
    });
    expect(action.event.type).toBe("PREFLIGHT_FAILED");
  });
});

describe("decideNextAction -- EXECUTOR_RESULT: incomplete (the core interruption case)", () => {
  it("requests a restart when under the restart bound", () => {
    const state = { ...initialRunState("task-1"), restartCount: 0 };
    const action = decideNextAction(state, contract(), {
      type: "EXECUTOR_RESULT",
      outcome: outcome({ status: "incomplete", detail: "no result event observed" }),
      changedFiles: [],
    });
    expect(action.event.type).toBe("EXECUTOR_INTERRUPTED");
    expect(action.humanMessage).toContain("Restart 1");
  });

  it("still emits EXECUTOR_INTERRUPTED once restarts are exhausted, but says so plainly -- state-machine.ts's own restart-exhausted event is a separate step the orchestrator issues next", () => {
    const state = { ...initialRunState("task-1"), restartCount: 3 };
    const action = decideNextAction(state, contract(), {
      type: "EXECUTOR_RESULT",
      outcome: outcome({ status: "incomplete", detail: "no result event observed" }),
      changedFiles: [],
    });
    expect(action.event.type).toBe("EXECUTOR_INTERRUPTED");
    expect(action.humanMessage).toContain("escalate");
  });
});

describe("decideNextAction -- EXECUTOR_RESULT: completed_error", () => {
  it("hard-stops on a genuine, self-reported executor failure -- never auto-restarted like an interruption", () => {
    const action = decideNextAction(initialRunState("task-1"), contract(), {
      type: "EXECUTOR_RESULT",
      outcome: outcome({ status: "completed_error", detail: "result event with subtype error_max_turns" }),
      changedFiles: [],
    });
    expect(action.event.type).toBe("HARD_STOP_TRIGGERED");
  });
});

describe("decideNextAction -- EXECUTOR_RESULT: completed_success, scope classification", () => {
  it("proceeds to checks when the diff is fully in scope", () => {
    const action = decideNextAction(initialRunState("task-1"), contract(), {
      type: "EXECUTOR_RESULT",
      outcome: outcome(),
      changedFiles: ["web/src/lib/tts-provider-gemini.ts"],
    });
    expect(action.event).toEqual({ type: "SCOPE_CLEAN" });
  });

  it("pauses for human review on a Level 2 violation (e.g. VAD touched)", () => {
    const action = decideNextAction(initialRunState("task-1"), contract(), {
      type: "EXECUTOR_RESULT",
      outcome: outcome(),
      changedFiles: ["web/src/components/consultation/voice-activity-logic.ts"],
    });
    expect(action.event.type).toBe("SCOPE_VIOLATION_LEVEL_2");
  });

  it("hard-stops on a Level 3 violation (e.g. billing touched), regardless of the contract's own protectedAreas list", () => {
    const action = decideNextAction(initialRunState("task-1"), contract({ protectedAreas: ["VAD"] }), {
      type: "EXECUTOR_RESULT",
      outcome: outcome(),
      changedFiles: ["web/src/lib/billing-repository.ts"],
    });
    expect(action.event.type).toBe("SCOPE_VIOLATION_LEVEL_3");
  });
});

describe("decideNextAction -- CHECK_RESULT", () => {
  it("moves forward when a check passes", () => {
    const action = decideNextAction(initialRunState("task-1"), contract(), { type: "CHECK_RESULT", check: "web_typecheck", passed: true, detail: "clean" });
    // CHECKS_STARTED is CHECKS_RUNNING's own modeled self-loop -- a
    // single passed check never leaves CHECKS_RUNNING by itself (only
    // ALL_CHECKS_PASSED does, see the next describe block).
    expect(action.event).toEqual({ type: "CHECKS_STARTED" });
  });

  it("requests a correction when a check fails, attributing it to the Supervisor's own independent verification", () => {
    const action = decideNextAction(initialRunState("task-1"), contract(), {
      type: "CHECK_RESULT",
      check: "web_tests_relevant",
      passed: false,
      detail: "3 tests failed",
    });
    expect(action.event).toEqual({ type: "CHECKS_FAILED", reason: "web_tests_relevant: 3 tests failed" });
    expect(action.humanMessage).toContain("verified by the Supervisor itself");
  });
});

describe("decideNextAction -- PUSH_VERIFIED_RESULT", () => {
  it("confirms the push when HEAD genuinely matches origin/master", () => {
    const action = decideNextAction(initialRunState("task-1"), contract(), { type: "PUSH_VERIFIED_RESULT", headMatchesOrigin: true });
    expect(action.event).toEqual({ type: "PUSH_VERIFIED" });
  });

  it("hard-stops rather than trusting a claimed push that HEAD does not actually confirm", () => {
    const action = decideNextAction(initialRunState("task-1"), contract(), { type: "PUSH_VERIFIED_RESULT", headMatchesOrigin: false });
    expect(action.event.type).toBe("HARD_STOP_TRIGGERED");
  });
});

describe("decideNextAction -- CI_RESULT (v1.2, ciPolicy-aware via classifyCiOutcome)", () => {
  it("declares success once CI has completed AND succeeded (ciPolicy=required)", () => {
    const action = decideNextAction(initialRunState("task-1"), contract({ ciPolicy: "required" }), {
      type: "CI_RESULT",
      result: { allCompleted: true, overallSuccess: true, checks: [{ status: "completed", conclusion: "success", name: "a", htmlUrl: null }], timedOut: false },
    });
    expect(action.event).toEqual({ type: "CI_SUCCEEDED" });
  });

  it("routes a real CI failure to the Level-1 correction path", () => {
    const action = decideNextAction(initialRunState("task-1"), contract({ ciPolicy: "required" }), {
      type: "CI_RESULT",
      result: { allCompleted: true, overallSuccess: false, checks: [{ status: "completed", conclusion: "failure", name: "web-quality", htmlUrl: null }], timedOut: false },
    });
    expect(action.event.type).toBe("CI_FAILED_LEVEL_1");
  });

  it("routes a cancelled CI run to CI_FAILED_NEEDS_REVIEW, never an automatic correction", () => {
    const action = decideNextAction(initialRunState("task-1"), contract({ ciPolicy: "required" }), {
      type: "CI_RESULT",
      result: { allCompleted: true, overallSuccess: false, checks: [{ status: "completed", conclusion: "cancelled", name: "a", htmlUrl: null }], timedOut: false },
    });
    expect(action.event.type).toBe("CI_FAILED_NEEDS_REVIEW");
  });

  it("routes a poll-budget timeout on a required task to CI_FAILED_NEEDS_REVIEW", () => {
    const action = decideNextAction(initialRunState("task-1"), contract({ ciPolicy: "required" }), {
      type: "CI_RESULT",
      result: { allCompleted: false, overallSuccess: false, checks: [{ status: "in_progress", conclusion: null, name: "a", htmlUrl: null }], timedOut: true },
    });
    expect(action.event.type).toBe("CI_FAILED_NEEDS_REVIEW");
  });

  // Test requirement 22: no-checks-expected -- a Supervisor-only commit
  // legitimately triggers zero web checks (path filtering); never a
  // false failure.
  it("treats a Supervisor-only task (ciPolicy=none) as CI_SUCCEEDED without ever needing a real result", () => {
    const action = decideNextAction(initialRunState("task-1"), contract({ ciPolicy: "none" }), {
      type: "CI_RESULT",
      result: { allCompleted: false, overallSuccess: false, checks: [], timedOut: false },
    });
    expect(action.event).toEqual({ type: "CI_SUCCEEDED" });
  });

  it("treats zero checks under ciPolicy=optional as CI_SUCCEEDED, never a failure", () => {
    const action = decideNextAction(initialRunState("task-1"), contract({ ciPolicy: "optional" }), {
      type: "CI_RESULT",
      result: { allCompleted: false, overallSuccess: false, checks: [], timedOut: false },
    });
    expect(action.event).toEqual({ type: "CI_SUCCEEDED" });
  });
});

describe("decideNextAction -- HUMAN_DECISION", () => {
  it("completes the task on a real production validation confirmation", () => {
    const action = decideNextAction(initialRunState("task-1"), contract(), { type: "HUMAN_DECISION", approved: true, productionValidated: true });
    expect(action.event).toEqual({ type: "PRODUCTION_VALIDATED" });
  });

  it("resumes execution on a plain approval", () => {
    const action = decideNextAction(initialRunState("task-1"), contract(), { type: "HUMAN_DECISION", approved: true });
    expect(action.event).toEqual({ type: "HUMAN_APPROVED_CONTINUE" });
  });

  it("escalates on a human rejection -- never auto-retries a rejected decision", () => {
    const action = decideNextAction(initialRunState("task-1"), contract(), { type: "HUMAN_DECISION", approved: false });
    expect(action.event).toEqual({ type: "HUMAN_REJECTED" });
  });
});
