import { describe, expect, it } from "vitest";

import { initialState, isTerminal, transition } from "./state-machine.js";
import type { SupervisorState } from "./types.js";

describe("initialState", () => {
  it("starts at IDLE", () => {
    expect(initialState()).toBe("IDLE");
  });
});

describe("transition -- the happy path end to end", () => {
  it("walks a fully successful task from IDLE to COMPLETED", () => {
    let state: SupervisorState = "IDLE";
    const steps: Array<[Parameters<typeof transition>[1], SupervisorState]> = [
      [{ type: "TASK_CONTRACT_ACCEPTED" }, "TASK_RECEIVED"],
      [{ type: "PREFLIGHT_PASSED" }, "PREFLIGHT"],
      [{ type: "EXECUTOR_LAUNCHED" }, "EXECUTOR_RUNNING"],
      [{ type: "EXECUTOR_COMPLETED_CLEANLY" }, "TECHNICAL_REVIEW"],
      [{ type: "SCOPE_CLEAN" }, "CHECKS_RUNNING"],
      [{ type: "CHECKS_PASSED" }, "COMMIT_READY"],
      [{ type: "PUSH_VERIFIED" }, "PUSHED"],
      [{ type: "CI_STARTED" }, "CI_WAITING"],
      [{ type: "CI_SUCCEEDED" }, "COMPLETED"],
    ];
    for (const [event, expected] of steps) {
      const result = transition(state, event);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.next).toBe(expected);
        state = result.next;
      }
    }
    expect(state).toBe("COMPLETED");
    expect(isTerminal(state)).toBe(true);
  });
});

describe("transition -- interruption and automatic resume", () => {
  it("moves EXECUTOR_RUNNING -> EXECUTOR_INTERRUPTED -> RESUMING -> EXECUTOR_RUNNING on a successful auto-restart", () => {
    let state: SupervisorState = "EXECUTOR_RUNNING";
    let result = transition(state, { type: "EXECUTOR_INTERRUPTED", reason: "API Error: transport" });
    expect(result).toEqual({ ok: true, next: "EXECUTOR_INTERRUPTED" });
    state = (result as { ok: true; next: SupervisorState }).next;

    result = transition(state, { type: "RESTART_APPROVED" });
    expect(result).toEqual({ ok: true, next: "RESUMING" });
    state = (result as { ok: true; next: SupervisorState }).next;

    result = transition(state, { type: "EXECUTOR_LAUNCHED" });
    expect(result).toEqual({ ok: true, next: "EXECUTOR_RUNNING" });
  });

  it("escalates when restarts are exhausted instead of looping", () => {
    const result = transition("EXECUTOR_INTERRUPTED", { type: "RESTART_EXHAUSTED", reason: "max restarts reached" });
    expect(result).toEqual({ ok: true, next: "ESCALATED" });
  });
});

describe("transition -- scope enforcement", () => {
  it("routes a Level 2 scope violation to WAITING_FOR_HUMAN, never auto-continuing", () => {
    const result = transition("TECHNICAL_REVIEW", { type: "SCOPE_VIOLATION_LEVEL_2", detail: "touched voice-activity-logic.ts" });
    expect(result).toEqual({ ok: true, next: "WAITING_FOR_HUMAN" });
  });

  it("routes a Level 3 scope violation straight to HARD_STOP, never through WAITING_FOR_HUMAN", () => {
    const result = transition("TECHNICAL_REVIEW", { type: "SCOPE_VIOLATION_LEVEL_3", detail: "touched billing-repository.ts" });
    expect(result).toEqual({ ok: true, next: "HARD_STOP" });
  });
});

describe("transition -- v1.2 commit/push authorization boundary", () => {
  it("routes an unauthorized commit/push attempt from COMMIT_READY to WAITING_FOR_HUMAN, never HARD_STOP or a silent COMPLETED", () => {
    const result = transition("COMMIT_READY", { type: "OPERATION_NOT_AUTHORIZED", reason: "allowedOperations does not include 'commit'" });
    expect(result).toEqual({ ok: true, next: "WAITING_FOR_HUMAN" });
  });
});

describe("transition -- HARD_STOP is reachable from nearly every non-terminal state", () => {
  const nonTerminalStates: SupervisorState[] = [
    "IDLE",
    "TASK_RECEIVED",
    "PREFLIGHT",
    "EXECUTOR_RUNNING",
    "EXECUTOR_INTERRUPTED",
    "RESUMING",
    "TECHNICAL_REVIEW",
    "CHECKS_RUNNING",
    "COMMIT_READY",
    "PUSHED",
    "CI_WAITING",
    "CI_FAILED",
    "WAITING_FOR_HUMAN",
  ];

  it.each(nonTerminalStates)("HARD_STOP_TRIGGERED from %s always lands on HARD_STOP", (state) => {
    const result = transition(state, { type: "HARD_STOP_TRIGGERED", reason: "force push detected" });
    expect(result).toEqual({ ok: true, next: "HARD_STOP" });
  });
});

describe("transition -- terminal states never accept another event", () => {
  const terminalStates: SupervisorState[] = ["COMPLETED", "ESCALATED", "HARD_STOP"];

  it.each(terminalStates)("%s ignores TASK_CONTRACT_ACCEPTED rather than silently restarting", (state) => {
    const result = transition(state, { type: "TASK_CONTRACT_ACCEPTED" });
    expect(result.ok).toBe(false);
  });
});

describe("transition -- CI failure routing", () => {
  it("sends a Level-1 CI failure to CI_FAILED (eligible for an automatic correction attempt)", () => {
    const result = transition("CI_WAITING", { type: "CI_FAILED_LEVEL_1", reason: "flaky test" });
    expect(result).toEqual({ ok: true, next: "CI_FAILED" });
  });

  it("sends a CI failure that implies scope expansion to WAITING_FOR_HUMAN, never auto-corrected", () => {
    const result = transition("CI_WAITING", { type: "CI_FAILED_NEEDS_REVIEW", reason: "new dependency required to fix" });
    expect(result).toEqual({ ok: true, next: "WAITING_FOR_HUMAN" });
  });

  it("never declares COMPLETED merely because push succeeded -- CI_SUCCEEDED is a separate, required event", () => {
    const result = transition("PUSHED", { type: "CI_SUCCEEDED" });
    expect(result.ok).toBe(false);
  });
});

describe("transition -- production validation gate", () => {
  it("routes a task that needs real production validation to WAITING_FOR_HUMAN, not COMPLETED", () => {
    const result = transition("CI_WAITING", { type: "PRODUCTION_VALIDATION_REQUIRED" });
    expect(result).toEqual({ ok: true, next: "WAITING_FOR_HUMAN" });
  });

  it("only reaches COMPLETED after an explicit PRODUCTION_VALIDATED event", () => {
    const result = transition("WAITING_FOR_HUMAN", { type: "PRODUCTION_VALIDATED" });
    expect(result).toEqual({ ok: true, next: "COMPLETED" });
  });
});

describe("transition -- unrecognized event/state combinations are never silently accepted", () => {
  it("rejects an event that does not apply to the current state", () => {
    const result = transition("IDLE", { type: "CI_SUCCEEDED" });
    expect(result).toEqual({ ok: false, reason: "event CI_SUCCEEDED is not valid from state IDLE" });
  });
});
