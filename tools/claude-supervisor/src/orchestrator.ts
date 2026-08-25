// The thin, real-I/O orchestration layer -- wires together every pure
// module (task-contract, state-machine, decide-next-action, scope-guard,
// restart-policy, persistence, git-inspect, ci-watch, claude-cli,
// stream-events, lock, logger) into one runnable loop. Deliberately kept
// as SMALL as possible: every real decision already lives in
// decide-next-action.ts (fully unit-tested, zero I/O); this file's own
// job is only to gather real observations (git, checks, CI) and real
// actions (spawn/resume the executor), never to re-decide anything
// itself. See this package's own top-level doc comment and this round's
// final report's "known limitations" for why the EXECUTOR-SPAWNING path
// specifically is the one piece that still needs a live smoke test
// before ACTIVE mode is trusted end to end.
import { classifyDiff } from "./scope-guard.js";
import { captureGitSnapshot, isWorkingTreeCleanExcept } from "./git-inspect.js";
import { decideNextAction, type Observation } from "./decide-next-action.js";
import { transition } from "./state-machine.js";
import { logSupervisorEvent } from "./logger.js";
import type { SupervisorRunState, TaskContract } from "./types.js";

export interface PreflightObservation {
  clean: boolean;
  reason?: string;
  headSha: string;
}

// ALWAYS safe to run, in both dry-run and active mode -- pure
// observation, zero mutation, matching this round's own task spec:
// "În dry-run: observă... NU face commit/push" (observing is explicitly
// permitted; only the mutating actions are gated behind dry-run).
export async function runPreflight(cwd: string, allowedUntrackedPrefixes: readonly string[]): Promise<PreflightObservation> {
  const [clean, snapshot] = await Promise.all([
    isWorkingTreeCleanExcept(cwd, allowedUntrackedPrefixes),
    captureGitSnapshot(cwd),
  ]);
  return {
    clean,
    headSha: snapshot.headSha,
    ...(clean ? {} : { reason: `working tree is not clean: ${snapshot.statusLines.join("; ")}` }),
  };
}

export interface DryRunStep {
  observation: Observation;
  decision: ReturnType<typeof decideNextAction>;
  wouldTransitionTo: string;
}

// The CORE dry-run guarantee this function exists to prove (task spec
// requirement 18, "dry-run sends no action"): planDryRun performs ZERO
// I/O of its own -- it takes an ALREADY-GATHERED observation (the caller
// decides whether/how to gather it; in real dry-run usage that's the
// read-only runPreflight above, never a git push or an executor spawn)
// and returns a plan, full stop. Nothing here can start a process, write
// a file, or make a network call.
export function planDryRun(runState: SupervisorRunState, contract: TaskContract, observation: Observation): DryRunStep {
  const decision = decideNextAction(runState, contract, observation);
  const result = transition(runState.state, decision.event);
  return {
    observation,
    decision,
    wouldTransitionTo: result.ok ? result.next : `IGNORED (${result.reason})`,
  };
}

export function applyDecision(runState: SupervisorRunState, contract: TaskContract, observation: Observation, now: () => string): SupervisorRunState {
  const decision = decideNextAction(runState, contract, observation);
  const result = transition(runState.state, decision.event);
  const nextState = result.ok ? result.next : runState.state;

  logSupervisorEvent({
    taskId: contract.taskId,
    state: nextState,
    executorSession: runState.executorSessionId,
    action: decision.event.type,
    result: decision.humanMessage,
    timestamp: now(),
  });

  return {
    ...runState,
    state: nextState,
    updatedAt: now(),
    lastAction: decision.humanMessage,
  };
}

// Re-exported for cli.ts's own convenience -- keeps classifyDiff's own
// import local to this module's real usage rather than every caller
// re-importing scope-guard.ts directly.
export { classifyDiff };
