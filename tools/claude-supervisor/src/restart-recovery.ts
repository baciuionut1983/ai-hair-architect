// Pure reconciliation logic for Phase 9 -- "On restart: inspect reality
// first. Never assume persisted state is truth." Given a persisted
// SupervisorRunState (loaded from disk by a NEW Supervisor process --
// possibly after the previous one crashed) and INDEPENDENTLY,
// freshly-gathered real git facts, decides whether the persisted state
// can be trusted as-is, whether it can be safely ADVANCED past a step
// that reality shows already completed, or whether reality has
// diverged in a way that must never be silently continued past.
//
// SCOPE (honest limitation, not a gap): this is a SAFETY GATE, not a
// full "resume the exact in-flight pipeline step" engine -- v1.2's
// cli.ts wires it as a refuse-to-proceed check when a non-terminal
// persisted state already exists for a task (see cli.ts's own doc
// comment), rather than a seamless mid-pipeline continuation. Building
// full step-resumption would require re-entering
// runQualityGatesAndCommitPush's own internal loop at an arbitrary
// point, a materially larger feature than "never act on stale state."
import type { SupervisorRunState, SupervisorState } from "./types.js";

export interface RealGitReality {
  headSha: string;
  originMasterSha: string | null;
}

export type ReconciliationOutcome =
  | { action: "TRUST_AND_RESUME"; reconciledState: SupervisorRunState }
  | { action: "TRUST_AND_ADVANCE"; reconciledState: SupervisorRunState; reason: string }
  | { action: "ESCALATE"; reason: string };

// Only these states even CLAIM a specific commit exists (lastKnownHeadSha
// set) -- any earlier state (still mid-executor-run, no commit made yet)
// has no git fact to have diverged from yet, so it is always trivially
// safe to trust literally.
const STATES_THAT_IMPLY_A_KNOWN_COMMIT: ReadonlySet<SupervisorState> = new Set(["COMMIT_READY", "PUSHED", "CI_WAITING", "CI_FAILED", "WAITING_FOR_HUMAN"]);

export function reconcileOnRestart(persisted: SupervisorRunState, reality: RealGitReality): ReconciliationOutcome {
  if (persisted.lastKnownHeadSha === null || !STATES_THAT_IMPLY_A_KNOWN_COMMIT.has(persisted.state)) {
    return { action: "TRUST_AND_RESUME", reconciledState: persisted };
  }

  // The persisted state claims a SPECIFIC commit exists -- verify it
  // STILL does, exactly, as the real current HEAD. Anything else (HEAD
  // moved further, moved to something else entirely, or moved backward)
  // is drift this Supervisor run did not itself cause and must never
  // continue blindly past -- the exact task-spec example: "persisted =
  // CI_WAITING but origin/master differs -> inspect and reconcile."
  if (reality.headSha !== persisted.lastKnownHeadSha) {
    return {
      action: "ESCALATE",
      reason: `persisted lastKnownHeadSha (${persisted.lastKnownHeadSha}) does not match the real current HEAD (${reality.headSha}) -- the repository has changed since this task last persisted its state; refusing to continue blindly.`,
    };
  }

  // HEAD matches exactly -- the commit this run made is still there. If
  // origin/master ALSO already matches, the push (whether or not this
  // run ever got to record PUSHED) already succeeded for real, so a
  // persisted COMMIT_READY can be safely advanced to PUSHED rather than
  // re-attempting a push that would find nothing new to do.
  if (reality.originMasterSha === reality.headSha && persisted.state === "COMMIT_READY") {
    return {
      action: "TRUST_AND_ADVANCE",
      reconciledState: { ...persisted, state: "PUSHED" },
      reason: "real origin/master already matches the real local HEAD -- the pending push already succeeded before the previous run ended.",
    };
  }

  return { action: "TRUST_AND_RESUME", reconciledState: persisted };
}
