// Pure state machine for the Supervisor's own lifecycle -- every state
// name is exactly the one this round's own task spec listed, so a human
// reading a persisted state file (persistence.ts) recognizes it
// immediately. Deliberately a plain, total function (event, state) ->
// state -- no side effects, no I/O, so it is fully unit-testable and the
// orchestrator (the one place allowed to have side effects) can trust it
// completely rather than re-deriving transition logic itself.
//
// DESIGN PRINCIPLE: an unrecognized event for the current state is NEVER
// silently ignored and never silently treated as a no-op transition to
// an arbitrary state -- transition() always returns an explicit
// TransitionResult that is either a real next state or an "ignored"
// marker the caller must handle deliberately (e.g. by logging it as
// unexpected), so a bug in the orchestrator's own event sequencing shows
// up immediately instead of quietly corrupting the recorded state.
import type { SupervisorState } from "./types.js";

export type SupervisorEvent =
  | { type: "TASK_CONTRACT_ACCEPTED" }
  | { type: "PREFLIGHT_PASSED" }
  | { type: "PREFLIGHT_FAILED"; reason: string }
  | { type: "EXECUTOR_LAUNCHED" }
  | { type: "EXECUTOR_COMPLETED_CLEANLY" }
  | { type: "EXECUTOR_INTERRUPTED"; reason: string }
  | { type: "RESTART_APPROVED" }
  | { type: "RESTART_EXHAUSTED"; reason: string }
  | { type: "REVIEW_STARTED" }
  | { type: "SCOPE_VIOLATION_LEVEL_2"; detail: string }
  | { type: "SCOPE_VIOLATION_LEVEL_3"; detail: string }
  | { type: "SCOPE_CLEAN" }
  | { type: "CHECKS_STARTED" }
  | { type: "CHECKS_PASSED" }
  | { type: "CHECKS_FAILED"; reason: string }
  | { type: "COMMIT_VERIFIED" }
  | { type: "PUSH_VERIFIED" }
  | { type: "CI_STARTED" }
  | { type: "CI_SUCCEEDED" }
  | { type: "CI_FAILED_LEVEL_1"; reason: string }
  | { type: "CI_FAILED_NEEDS_REVIEW"; reason: string }
  | { type: "PRODUCTION_VALIDATION_REQUIRED" }
  | { type: "PRODUCTION_VALIDATED" }
  | { type: "HUMAN_APPROVED_CONTINUE" }
  | { type: "HUMAN_REJECTED" }
  | { type: "HARD_STOP_TRIGGERED"; reason: string };

export interface TransitionOk {
  ok: true;
  next: SupervisorState;
}

export interface TransitionIgnored {
  ok: false;
  reason: string;
}

export type TransitionResult = TransitionOk | TransitionIgnored;

// Every state that is NOT WAITING_FOR_HUMAN, ESCALATED, HARD_STOP, or
// COMPLETED can transition to HARD_STOP on a HARD_STOP_TRIGGERED event --
// modeled once, here, rather than repeated in every branch below, so a
// future new state can never accidentally omit this and become
// un-stoppable.
const HARD_STOP_REACHABLE_FROM: ReadonlySet<SupervisorState> = new Set([
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
]);

export function transition(current: SupervisorState, event: SupervisorEvent): TransitionResult {
  if (event.type === "HARD_STOP_TRIGGERED" && HARD_STOP_REACHABLE_FROM.has(current)) {
    return { ok: true, next: "HARD_STOP" };
  }

  switch (current) {
    case "IDLE":
      if (event.type === "TASK_CONTRACT_ACCEPTED") return { ok: true, next: "TASK_RECEIVED" };
      break;

    case "TASK_RECEIVED":
      if (event.type === "PREFLIGHT_PASSED") return { ok: true, next: "PREFLIGHT" };
      break;

    case "PREFLIGHT":
      if (event.type === "EXECUTOR_LAUNCHED") return { ok: true, next: "EXECUTOR_RUNNING" };
      if (event.type === "PREFLIGHT_FAILED") return { ok: true, next: "ESCALATED" };
      break;

    case "EXECUTOR_RUNNING":
      if (event.type === "EXECUTOR_COMPLETED_CLEANLY") return { ok: true, next: "TECHNICAL_REVIEW" };
      if (event.type === "EXECUTOR_INTERRUPTED") return { ok: true, next: "EXECUTOR_INTERRUPTED" };
      break;

    case "EXECUTOR_INTERRUPTED":
      if (event.type === "RESTART_APPROVED") return { ok: true, next: "RESUMING" };
      if (event.type === "RESTART_EXHAUSTED") return { ok: true, next: "ESCALATED" };
      break;

    case "RESUMING":
      if (event.type === "EXECUTOR_LAUNCHED") return { ok: true, next: "EXECUTOR_RUNNING" };
      break;

    case "TECHNICAL_REVIEW":
      if (event.type === "REVIEW_STARTED") return { ok: true, next: "TECHNICAL_REVIEW" };
      if (event.type === "SCOPE_CLEAN") return { ok: true, next: "CHECKS_RUNNING" };
      if (event.type === "SCOPE_VIOLATION_LEVEL_2") return { ok: true, next: "WAITING_FOR_HUMAN" };
      if (event.type === "SCOPE_VIOLATION_LEVEL_3") return { ok: true, next: "HARD_STOP" };
      break;

    case "CHECKS_RUNNING":
      if (event.type === "CHECKS_STARTED") return { ok: true, next: "CHECKS_RUNNING" };
      if (event.type === "CHECKS_PASSED") return { ok: true, next: "COMMIT_READY" };
      // A check failure produced by the task's own code is Level 1 (the
      // executor gets a correction request and tries again -- modeled by
      // the orchestrator re-entering EXECUTOR_RUNNING, not by this state
      // machine itself looping, since that requires a fresh executor
      // launch); a check failure the Supervisor cannot attribute to the
      // task at all (e.g. an environment problem) escalates instead. Both
      // paths are available to the orchestrator; which one it chooses is
      // an orchestration decision, not this pure module's own concern --
      // CHECKS_FAILED always resolves to the SAME next state
      // (EXECUTOR_RUNNING, for a correction attempt) and it is the
      // orchestrator's own restart-count bookkeeping (restart-policy.ts)
      // that ultimately decides ESCALATED if corrections never converge.
      if (event.type === "CHECKS_FAILED") return { ok: true, next: "EXECUTOR_RUNNING" };
      break;

    case "COMMIT_READY":
      if (event.type === "COMMIT_VERIFIED") return { ok: true, next: "COMMIT_READY" };
      if (event.type === "PUSH_VERIFIED") return { ok: true, next: "PUSHED" };
      break;

    case "PUSHED":
      if (event.type === "CI_STARTED") return { ok: true, next: "CI_WAITING" };
      break;

    case "CI_WAITING":
      if (event.type === "CI_SUCCEEDED") return { ok: true, next: "COMPLETED" };
      if (event.type === "CI_FAILED_LEVEL_1") return { ok: true, next: "CI_FAILED" };
      if (event.type === "CI_FAILED_NEEDS_REVIEW") return { ok: true, next: "WAITING_FOR_HUMAN" };
      if (event.type === "PRODUCTION_VALIDATION_REQUIRED") return { ok: true, next: "WAITING_FOR_HUMAN" };
      break;

    case "CI_FAILED":
      // A Level-1 CI failure sends the executor a correction request --
      // same reasoning as CHECKS_FAILED above.
      if (event.type === "RESTART_APPROVED") return { ok: true, next: "RESUMING" };
      if (event.type === "RESTART_EXHAUSTED") return { ok: true, next: "ESCALATED" };
      break;

    case "WAITING_FOR_HUMAN":
      if (event.type === "HUMAN_APPROVED_CONTINUE") return { ok: true, next: "EXECUTOR_RUNNING" };
      if (event.type === "PRODUCTION_VALIDATED") return { ok: true, next: "COMPLETED" };
      if (event.type === "HUMAN_REJECTED") return { ok: true, next: "ESCALATED" };
      break;

    case "COMPLETED":
    case "ESCALATED":
    case "HARD_STOP":
      // Terminal states -- every event is ignored, deliberately, rather
      // than silently accepted. A HARD_STOP or ESCALATED task resuming
      // itself without a fresh, explicit human decision (which always
      // starts a NEW task contract / NEW IDLE->TASK_RECEIVED transition,
      // never an event fed into this same terminal state) would defeat
      // the entire point of those states.
      break;
  }

  return { ok: false, reason: `event ${event.type} is not valid from state ${current}` };
}

export function initialState(): SupervisorState {
  return "IDLE";
}

export function isTerminal(state: SupervisorState): boolean {
  return state === "COMPLETED" || state === "ESCALATED" || state === "HARD_STOP";
}
