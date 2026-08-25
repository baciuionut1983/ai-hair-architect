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
import { decideRestart } from "./restart-policy.js";
import { transition, type SupervisorEvent } from "./state-machine.js";
import { logSupervisorEvent } from "./logger.js";
import { verifySessionIdMatches, type ExecutorOutcome } from "./stream-events.js";
import type { SupervisorLogEntry, SupervisorRunState, SupervisorState, TaskContract } from "./types.js";

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

// ---------------------------------------------------------------------
// ACTIVE MODE (Supervisor v1.1) -- minimal, explicitly bounded per this
// round's own task spec Phase 6: launch one executor, observe its
// structured stream, detect completion/interruption, resume within the
// restart policy, perform independent git inspection, enforce scope
// policy, and stop/escalate. Required checks / commit / push / CI-watch
// are DELIBERATELY NOT invoked from this loop in v1.1 -- see this
// round's own final report's "what ACTIVE mode still cannot do": the
// task spec's own Phase 6 bullet list names exactly these nine
// capabilities and no more, and reaching further (auto-running checks,
// auto-committing) in the same pass that first proves the launch/stream/
// resume mechanism works live would combine two separate risk surfaces
// this task explicitly asked to keep apart ("Do NOT yet allow Supervisor
// to invent new task instructions").
//
// The actual `claude` process spawn is injected as an ExecutorLauncher
// (see real-executor-launcher.ts for the real implementation wiring
// claude-cli.ts + executor-runner.ts) so this entire loop -- including
// the interruption/restart/backoff/scope-enforcement decision path --
// is fully unit-testable with a fake launcher, never a real spawn.
export interface ExecutorLauncher {
  launch(sessionId: string, prompt: string, cwd: string): Promise<ExecutorOutcome>;
  resume(sessionId: string, cwd: string): Promise<ExecutorOutcome>;
}

export interface RunActiveExecutionOptions {
  contract: TaskContract;
  runState: SupervisorRunState;
  cwd: string;
  sessionId: string;
  launcher: ExecutorLauncher;
  // Independent verification, never the executor's own claim -- real
  // usage passes `(cwd) => captureGitSnapshot(cwd).then((s) =>
  // s.changedFiles)`; tests inject a fake to control the diff without a
  // real git repo.
  captureChangedFiles: (cwd: string) => Promise<readonly string[]>;
  now: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export interface ActiveExecutionResult {
  runState: SupervisorRunState;
  log: SupervisorLogEntry[];
}

const DEFAULT_SLEEP = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

export async function runActiveExecution(options: RunActiveExecutionOptions): Promise<ActiveExecutionResult> {
  const sleep = options.sleep ?? DEFAULT_SLEEP;
  const log: SupervisorLogEntry[] = [];
  let runState = options.runState;

  // Applies one state-machine transition, appends one log entry (via the
  // real logger, so every ACTIVE-mode decision is written in the exact
  // "[SUPERVISOR] taskId=... state=... action=... result=..." format),
  // and folds the result back into runState. An event the state machine
  // rejects from the current state is a genuine bug in this loop's own
  // sequencing (never a normal runtime outcome) -- surfaced by simply
  // leaving the state unchanged rather than throwing, so a live run
  // degrades to "stuck, visible in the log" instead of crashing.
  function record(event: SupervisorEvent, humanMessage: string): SupervisorState {
    const result = transition(runState.state, event);
    const nextState: SupervisorState = result.ok ? result.next : runState.state;
    const entry: SupervisorLogEntry = {
      taskId: options.contract.taskId,
      state: nextState,
      executorSession: runState.executorSessionId,
      action: event.type,
      result: result.ok ? humanMessage : `${humanMessage} [REJECTED: ${result.reason}]`,
      timestamp: options.now(),
    };
    log.push(entry);
    logSupervisorEvent(entry);
    runState = { ...runState, state: nextState, updatedAt: options.now(), lastAction: entry.result };
    return nextState;
  }

  record({ type: "EXECUTOR_LAUNCHED" }, `Launching executor session ${options.sessionId} with the approved prompt.`);
  runState = { ...runState, executorSessionId: options.sessionId };
  let outcome = await options.launcher.launch(options.sessionId, options.contract.approvedPrompt, options.cwd);

  for (;;) {
    // A resume (or, defensively, even a first launch) that reports a
    // DIFFERENT session id than the one requested is never trusted at
    // face value -- see stream-events.ts's own doc comment on
    // verifySessionIdMatches and this round's own Phase 4 requirement
    // "no new uncontrolled executor/session is created".
    if (outcome.sessionId !== null && !verifySessionIdMatches(options.sessionId, outcome)) {
      record(
        { type: "HARD_STOP_TRIGGERED", reason: `observed session id ${outcome.sessionId} does not match the requested ${options.sessionId}` },
        `Session id mismatch: requested ${options.sessionId}, observed ${outcome.sessionId}. Treating as an uncontrolled session, never proceeding.`,
      );
      return { runState, log };
    }

    if (outcome.status === "incomplete") {
      const decision = decideNextAction(runState, options.contract, { type: "EXECUTOR_RESULT", outcome, changedFiles: [] });
      record(decision.event, decision.humanMessage);

      const restart = decideRestart(runState.restartCount);
      if (restart.action === "ESCALATE") {
        record({ type: "RESTART_EXHAUSTED", reason: restart.reason }, `Restart budget exhausted: ${restart.reason}. Escalating, never looping further.`);
        return { runState, log };
      }
      record({ type: "RESTART_APPROVED" }, `Restart ${restart.attemptNumber}/3 approved after a ${restart.backoffMs}ms backoff.`);
      runState = { ...runState, restartCount: restart.attemptNumber };
      await sleep(restart.backoffMs);
      record({ type: "EXECUTOR_LAUNCHED" }, `Resuming session ${options.sessionId} with the fixed continuation instruction.`);
      outcome = await options.launcher.resume(options.sessionId, options.cwd);
      continue;
    }

    if (outcome.status === "completed_error") {
      const decision = decideNextAction(runState, options.contract, { type: "EXECUTOR_RESULT", outcome, changedFiles: [] });
      record(decision.event, decision.humanMessage);
      return { runState, log };
    }

    // completed_success -- first the unconditional state-machine hop
    // (EXECUTOR_RUNNING -> TECHNICAL_REVIEW) that only a clean completion
    // ever takes, THEN the scope-classification event decideNextAction
    // computes from the INDEPENDENTLY captured diff (never the
    // executor's own claim of what it changed).
    record({ type: "EXECUTOR_COMPLETED_CLEANLY" }, "Executor completed cleanly (result event, subtype success). Entering technical review.");
    const changedFiles = await options.captureChangedFiles(options.cwd);
    const decision = decideNextAction(runState, options.contract, { type: "EXECUTOR_RESULT", outcome, changedFiles });
    record(decision.event, decision.humanMessage);
    return { runState, log };
  }
}
