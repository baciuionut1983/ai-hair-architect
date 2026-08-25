// The Supervisor's own decision "brain" -- a single pure function that
// takes (current run state, the task contract, one fresh observation)
// and decides the next SupervisorEvent to feed into state-machine.ts's
// own transition(). This is where restart-policy.ts and scope-guard.ts
// actually get consulted -- kept in ONE place, fully unit-testable with
// zero I/O, so orchestrator.ts (the thin, real-I/O glue) never has to
// re-implement or duplicate any of this decision logic itself.
import { decideRestart } from "./restart-policy.js";
import { classifyDiff } from "./scope-guard.js";
import type { SupervisorEvent } from "./state-machine.js";
import type { ExecutorOutcome } from "./stream-events.js";
import type { CiWatchResult } from "./ci-watch.js";
import type { RequiredCheckName, SupervisorRunState, TaskContract } from "./types.js";

export type Observation =
  | { type: "PREFLIGHT_RESULT"; clean: boolean; reason?: string }
  | { type: "EXECUTOR_RESULT"; outcome: ExecutorOutcome; changedFiles: readonly string[] }
  | { type: "CHECK_RESULT"; check: RequiredCheckName; passed: boolean; detail: string }
  | { type: "ALL_CHECKS_PASSED" }
  | { type: "COMMIT_VERIFIED"; sha: string }
  | { type: "PUSH_VERIFIED_RESULT"; headMatchesOrigin: boolean }
  | { type: "CI_RESULT"; result: CiWatchResult }
  | { type: "PRODUCTION_VALIDATION_NEEDED" }
  | { type: "HUMAN_DECISION"; approved: boolean; productionValidated?: boolean };

export interface NextAction {
  event: SupervisorEvent;
  // A short, human-readable explanation of WHY this event was chosen --
  // always populated, so a human reading the Supervisor's own log can
  // understand a decision without re-deriving it themselves.
  humanMessage: string;
}

export function decideNextAction(runState: SupervisorRunState, contract: TaskContract, observation: Observation): NextAction {
  switch (observation.type) {
    case "PREFLIGHT_RESULT":
      return observation.clean
        ? { event: { type: "PREFLIGHT_PASSED" }, humanMessage: "Preflight clean -- launching executor." }
        : {
            event: { type: "PREFLIGHT_FAILED", reason: observation.reason ?? "unknown preflight failure" },
            humanMessage: `Preflight failed: ${observation.reason ?? "unknown"}. Escalating without ever launching the executor.`,
          };

    case "EXECUTOR_RESULT": {
      if (observation.outcome.status === "incomplete") {
        const restart = decideRestart(runState.restartCount);
        if (restart.action === "RESTART") {
          return {
            event: { type: "EXECUTOR_INTERRUPTED", reason: observation.outcome.detail },
            humanMessage: `Executor run ended without a result event (${observation.outcome.detail}) -- treating as a transport interruption. Restart ${restart.attemptNumber} will follow a ${restart.backoffMs}ms backoff.`,
          };
        }
        return {
          event: { type: "EXECUTOR_INTERRUPTED", reason: observation.outcome.detail },
          humanMessage: `Executor interrupted again, but ${restart.reason} -- this will escalate rather than restart again.`,
        };
      }

      if (observation.outcome.status === "completed_error") {
        return {
          event: { type: "HARD_STOP_TRIGGERED", reason: `executor reported a genuine failure result: ${observation.outcome.detail}` },
          humanMessage: `Executor completed with an error result (${observation.outcome.detail}) -- this is not a transport interruption, so it is not auto-restarted. Needs human attention.`,
        };
      }

      // completed_success -- now, and only now, is the diff scope
      // actually checked (see this module's own doc comment: nothing
      // upstream of a clean, self-reported completion should ever be
      // scope-checked, since an interrupted/errored run's own partial
      // diff is reviewed at the SAME technical-review step regardless of
      // why the run ended, not gated on it ending cleanly first).
      const classification = classifyDiff(observation.changedFiles, contract.protectedAreas);
      if (classification.level === "LEVEL_3_HARD_STOP") {
        return {
          event: { type: "SCOPE_VIOLATION_LEVEL_3", detail: JSON.stringify(classification.violations) },
          humanMessage: `HARD STOP: diff touches a protected area at Level 3 (${classification.violations.map((v) => v.file).join(", ")}). Never auto-committed.`,
        };
      }
      if (classification.level === "LEVEL_2_REVIEW_REQUIRED") {
        return {
          event: { type: "SCOPE_VIOLATION_LEVEL_2", detail: JSON.stringify(classification.violations) },
          humanMessage: `Review required: diff touches a Level 2 area (${classification.violations.map((v) => v.file).join(", ")}). Pausing for human review before checks/commit.`,
        };
      }
      return { event: { type: "SCOPE_CLEAN" }, humanMessage: "Diff is fully in scope -- proceeding to required checks." };
    }

    case "CHECK_RESULT":
      return observation.passed
        ? { event: { type: "REVIEW_STARTED" }, humanMessage: `Check '${observation.check}' passed.` }
        : {
            event: { type: "CHECKS_FAILED", reason: `${observation.check}: ${observation.detail}` },
            humanMessage: `Check '${observation.check}' failed independently (verified by the Supervisor itself, not taken from the executor's own claim) -- sending the executor a correction request.`,
          };

    case "ALL_CHECKS_PASSED":
      return { event: { type: "CHECKS_PASSED" }, humanMessage: "Every required check verified independently. Ready to verify the commit." };

    case "COMMIT_VERIFIED":
      return { event: { type: "COMMIT_VERIFIED" }, humanMessage: `Commit ${observation.sha} verified to exist on HEAD.` };

    case "PUSH_VERIFIED_RESULT":
      return observation.headMatchesOrigin
        ? { event: { type: "PUSH_VERIFIED" }, humanMessage: "HEAD matches origin/master -- push independently confirmed." }
        : {
            event: { type: "HARD_STOP_TRIGGERED", reason: "HEAD does not match origin/master after a claimed push" },
            humanMessage: "The executor claimed to push, but HEAD does not match origin/master. This is not trusted at face value.",
          };

    case "CI_RESULT":
      if (!observation.result.allCompleted) {
        return { event: { type: "CI_STARTED" }, humanMessage: "CI still in progress -- continuing to wait, never declaring done early." };
      }
      if (observation.result.overallSuccess) {
        return { event: { type: "CI_SUCCEEDED" }, humanMessage: "CI succeeded -- verified independently via the GitHub API, not the executor's own claim." };
      }
      return {
        event: { type: "CI_FAILED_LEVEL_1", reason: JSON.stringify(observation.result.checks) },
        humanMessage: "CI failed. If the failure is clearly attributable to this task's own code, a correction request will follow; otherwise this pauses for review.",
      };

    case "PRODUCTION_VALIDATION_NEEDED":
      return {
        event: { type: "PRODUCTION_VALIDATION_REQUIRED" },
        humanMessage: "This task's own acceptance criteria require a real production test. Waiting for a human to provide it -- v1 never simulates or assumes this.",
      };

    case "HUMAN_DECISION":
      if (observation.productionValidated) {
        return { event: { type: "PRODUCTION_VALIDATED" }, humanMessage: "Human confirmed real production validation. Task complete." };
      }
      return observation.approved
        ? { event: { type: "HUMAN_APPROVED_CONTINUE" }, humanMessage: "Human approved continuing." }
        : { event: { type: "HUMAN_REJECTED" }, humanMessage: "Human rejected -- escalating, never auto-retrying a rejected decision." };
  }
}
