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
import { classifyCiOutcome, type CiWatchResult } from "./ci-watch.js";
import type { GitHubRemote } from "./remote-parser.js";
import { buildCorrectionPrompt, computeFailureFingerprint, decideCorrectionAction, isRepeatedFailure } from "./correction-loop.js";
import { runPreCommitReview } from "./pre-commit-review.js";
import { buildCommitMessage, filterStageableFiles, isCommitAllowed, isPushAllowed } from "./commit-policy.js";
import type { CommitResult } from "./commit-runner.js";
import type { PushPreconditionResult, PushResult } from "./push-runner.js";
import { buildProductionValidationRequest, needsProductionValidation, type ProductionValidationRequest } from "./production-validation.js";
import type { CheckExecutionResult } from "./check-runner.js";
import type { RequiredCheckName, SupervisorLogEntry, SupervisorRunState, SupervisorState, TaskContract } from "./types.js";

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
  // prompt defaults to the fixed RESUME_INSTRUCTION (plain interruption
  // resume) but v1.2's correction loop passes an explicit, different
  // fixed prompt (correction-loop.ts's own buildCorrectionPrompt) --
  // see claude-cli.ts's own buildResumeArgs doc comment.
  resume(sessionId: string, cwd: string, prompt?: string): Promise<ExecutorOutcome>;
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

// Shared "apply one state-machine transition, log it, fold it back into
// runState" primitive -- both runActiveExecution (v1.1) and
// runQualityGatesAndCommitPush (v1.2) build their own local `record`
// closure over this, so the exact "[SUPERVISOR] taskId=... state=...
// action=... result=..." logging format and REJECTED-event handling
// never drifts between the two loops. An event the state machine
// rejects from the current state is a genuine bug in the CALLER's own
// sequencing (never a normal runtime outcome) -- surfaced by leaving the
// state unchanged rather than throwing, so a live run degrades to
// "stuck, visible in the log" instead of crashing.
function applyRecordedEvent(
  taskId: string,
  runState: SupervisorRunState,
  event: SupervisorEvent,
  humanMessage: string,
  now: () => string,
  log: SupervisorLogEntry[],
): SupervisorRunState {
  const result = transition(runState.state, event);
  const nextState: SupervisorState = result.ok ? result.next : runState.state;
  const entry: SupervisorLogEntry = {
    taskId,
    state: nextState,
    executorSession: runState.executorSessionId,
    action: event.type,
    result: result.ok ? humanMessage : `${humanMessage} [REJECTED: ${result.reason}]`,
    timestamp: now(),
  };
  log.push(entry);
  logSupervisorEvent(entry);
  return { ...runState, state: nextState, updatedAt: now(), lastAction: entry.result };
}

// Settles ONE logical executor run -- a first launch OR a resume -- by
// retrying through transport interruptions (restartCount/decideRestart,
// the SAME bound/backoff used since v1.1) until a REAL result arrives:
// completed_success, completed_error, or the run is stopped altogether
// (session id mismatch / restart budget exhausted, both of which already
// move the state machine to its terminal state before returning). Shared
// by runActiveExecution's own initial launch AND v1.2's correction-loop
// resumes (runQualityGatesAndCommitPush below) -- both need EXACTLY this
// same "keep retrying a transport hiccup, never a genuine failure"
// behavior, just for a different logical attempt (first launch vs. a
// correction resume) and a different fixed resume prompt (plain
// RESUME_INSTRUCTION vs. correction-loop.ts's own correction prompt).
export type SettledExecutorRun =
  | { kind: "completed"; outcome: ExecutorOutcome }
  | { kind: "stopped" };

async function settleExecutorRun(
  taskId: string,
  contract: TaskContract,
  runStateRef: { current: SupervisorRunState },
  log: SupervisorLogEntry[],
  now: () => string,
  sleep: (ms: number) => Promise<void>,
  sessionId: string,
  firstAttempt: () => Promise<ExecutorOutcome>,
  resumeOnTransportInterruption: () => Promise<ExecutorOutcome>,
): Promise<SettledExecutorRun> {
  function record(event: SupervisorEvent, humanMessage: string): void {
    runStateRef.current = applyRecordedEvent(taskId, runStateRef.current, event, humanMessage, now, log);
  }

  let outcome = await firstAttempt();

  for (;;) {
    // A resume (or, defensively, even a first launch) that reports a
    // DIFFERENT session id than the one requested is never trusted at
    // face value -- see stream-events.ts's own doc comment on
    // verifySessionIdMatches and this round's own Phase 4 requirement
    // "no new uncontrolled executor/session is created".
    if (outcome.sessionId !== null && !verifySessionIdMatches(sessionId, outcome)) {
      record(
        { type: "HARD_STOP_TRIGGERED", reason: `observed session id ${outcome.sessionId} does not match the requested ${sessionId}` },
        `Session id mismatch: requested ${sessionId}, observed ${outcome.sessionId}. Treating as an uncontrolled session, never proceeding.`,
      );
      return { kind: "stopped" };
    }

    if (outcome.status !== "incomplete") {
      return { kind: "completed", outcome };
    }

    const decision = decideNextAction(runStateRef.current, contract, { type: "EXECUTOR_RESULT", outcome, changedFiles: [] });
    record(decision.event, decision.humanMessage);

    const restart = decideRestart(runStateRef.current.restartCount);
    if (restart.action === "ESCALATE") {
      record({ type: "RESTART_EXHAUSTED", reason: restart.reason }, `Restart budget exhausted: ${restart.reason}. Escalating, never looping further.`);
      return { kind: "stopped" };
    }
    record({ type: "RESTART_APPROVED" }, `Restart ${restart.attemptNumber}/3 approved after a ${restart.backoffMs}ms backoff.`);
    runStateRef.current = { ...runStateRef.current, restartCount: restart.attemptNumber };
    await sleep(restart.backoffMs);
    record({ type: "EXECUTOR_LAUNCHED" }, `Resuming session ${sessionId} after a transport interruption.`);
    outcome = await resumeOnTransportInterruption();
  }
}

export async function runActiveExecution(options: RunActiveExecutionOptions): Promise<ActiveExecutionResult> {
  const sleep = options.sleep ?? DEFAULT_SLEEP;
  const log: SupervisorLogEntry[] = [];
  const runStateRef: { current: SupervisorRunState } = { current: { ...options.runState, executorSessionId: options.sessionId } };

  function record(event: SupervisorEvent, humanMessage: string): void {
    runStateRef.current = applyRecordedEvent(options.contract.taskId, runStateRef.current, event, humanMessage, options.now, log);
  }

  record({ type: "EXECUTOR_LAUNCHED" }, `Launching executor session ${options.sessionId} with the approved prompt.`);

  const settled = await settleExecutorRun(
    options.contract.taskId,
    options.contract,
    runStateRef,
    log,
    options.now,
    sleep,
    options.sessionId,
    () => options.launcher.launch(options.sessionId, options.contract.approvedPrompt, options.cwd),
    () => options.launcher.resume(options.sessionId, options.cwd),
  );

  if (settled.kind === "stopped") {
    return { runState: runStateRef.current, log };
  }

  const outcome = settled.outcome;
  if (outcome.status === "completed_error") {
    const decision = decideNextAction(runStateRef.current, options.contract, { type: "EXECUTOR_RESULT", outcome, changedFiles: [] });
    record(decision.event, decision.humanMessage);
    return { runState: runStateRef.current, log };
  }

  // completed_success -- first the unconditional state-machine hop
  // (EXECUTOR_RUNNING -> TECHNICAL_REVIEW) that only a clean completion
  // ever takes, THEN the scope-classification event decideNextAction
  // computes from the INDEPENDENTLY captured diff (never the executor's
  // own claim of what it changed).
  record({ type: "EXECUTOR_COMPLETED_CLEANLY" }, "Executor completed cleanly (result event, subtype success). Entering technical review.");
  const changedFiles = await options.captureChangedFiles(options.cwd);
  const decision = decideNextAction(runStateRef.current, options.contract, { type: "EXECUTOR_RESULT", outcome, changedFiles });
  record(decision.event, decision.humanMessage);
  return { runState: runStateRef.current, log };
}

// ---------------------------------------------------------------------
// SUPERVISOR v1.2 -- QUALITY GATES + SAFE COMMIT/PUSH + CI WATCH. Takes
// over exactly where runActiveExecution (v1.1) stops: called only when
// its result reached CHECKS_RUNNING (scope was clean). Drives the REST
// of the pipeline this round's own task spec asks for: required checks
// (with a bounded, fingerprinted correction loop) -> pre-commit review
// -> commit (only if contract-authorized) -> push (only if contract-
// authorized) -> CI watch (with its own bounded correction loop) ->
// human production validation (only if the contract requires it).
//
// Every real action (running a check, committing, pushing, polling CI)
// is injected, exactly like runActiveExecution's own ExecutorLauncher --
// real implementations live in check-runner.ts/commit-runner.ts/
// push-runner.ts/ci-watch.ts, wired together by cli.ts; tests inject
// fakes so this entire pipeline (including the two correction loops) is
// verified without a single real process spawn, commit, or network call.
export interface QualityGatesOptions {
  // The CURRENT, freshly re-read and re-validated contract -- see
  // pre-commit-review.ts's own contract_unchanged check, which compares
  // this against contractAtLaunch.
  contract: TaskContract;
  contractAtLaunch: TaskContract;
  runState: SupervisorRunState;
  cwd: string;
  sessionId: string;
  launcher: ExecutorLauncher;
  // The real HEAD sha captured right before the executor was FIRST
  // launched (before runActiveExecution ever ran) -- pre-commit-review's
  // own head_matches_expected check.
  expectedHeadSha: string;
  captureChangedFiles: (cwd: string) => Promise<readonly string[]>;
  captureStatusLines: (cwd: string) => Promise<readonly string[]>;
  captureHeadSha: (cwd: string) => Promise<string>;
  // Real usage passes `(cwd) => verifyHeadMatchesOrigin(cwd)` from
  // git-inspect.ts -- independent re-verification that a push actually
  // landed, never trusting a zero exit code alone.
  verifyPushed: (cwd: string) => Promise<boolean>;
  runCheck: (checkName: RequiredCheckName, cwd: string) => Promise<CheckExecutionResult>;
  commit: (cwd: string, files: readonly string[], message: string) => Promise<CommitResult>;
  verifyPushPreconditions: (cwd: string) => Promise<PushPreconditionResult>;
  executePush: (cwd: string) => Promise<PushResult>;
  deriveOwnerRepo: (cwd: string) => Promise<GitHubRemote | null>;
  pollCi: (owner: string, repo: string, sha: string) => Promise<CiWatchResult>;
  allowedUntrackedPrefixes: readonly string[];
  now: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export interface QualityGatesResult {
  runState: SupervisorRunState;
  log: SupervisorLogEntry[];
  // Populated ONLY when the run reached WAITING_FOR_HUMAN specifically
  // because contract.productionValidation === "required" -- see this
  // round's own task spec Phase 8. cli.ts prints this verbatim; the
  // Supervisor never claims production success itself.
  productionValidationRequest?: ProductionValidationRequest;
}

export async function runQualityGatesAndCommitPush(options: QualityGatesOptions): Promise<QualityGatesResult> {
  const sleep = options.sleep ?? DEFAULT_SLEEP;
  const log: SupervisorLogEntry[] = [];
  const runStateRef: { current: SupervisorRunState } = { current: options.runState };
  const contract = options.contract;
  let expectedHeadSha = options.expectedHeadSha;

  function record(event: SupervisorEvent, humanMessage: string): void {
    runStateRef.current = applyRecordedEvent(contract.taskId, runStateRef.current, event, humanMessage, options.now, log);
  }

  // Runs every required check in order, fail-fast. Returns the failed
  // check's own name+bounded summary, or null if every check passed.
  async function runAllChecksOnce(): Promise<{ check: RequiredCheckName; detail: string } | null> {
    for (const checkName of contract.requiredChecks) {
      const result = await options.runCheck(checkName, options.cwd);
      const decision = decideNextAction(runStateRef.current, contract, { type: "CHECK_RESULT", check: checkName, passed: result.passed, detail: result.summary });
      record(decision.event, decision.humanMessage);
      if (!result.passed) return { check: checkName, detail: result.summary };
    }
    const decision = decideNextAction(runStateRef.current, contract, { type: "ALL_CHECKS_PASSED" });
    record(decision.event, decision.humanMessage);
    return null;
  }

  // ===================== PHASE 1/2: CHECKS + CORRECTION =====================
  pipeline: for (;;) {
    for (;;) {
      const failure = await runAllChecksOnce();
      if (!failure) break; // CHECKS_PASSED -> COMMIT_READY already recorded

      const fingerprint = computeFailureFingerprint(failure.check, failure.detail);
      const recentFingerprints = [...runStateRef.current.recentCorrectionFingerprints, fingerprint];
      runStateRef.current = { ...runStateRef.current, recentCorrectionFingerprints: recentFingerprints };

      if (isRepeatedFailure(recentFingerprints)) {
        record(
          { type: "HARD_STOP_TRIGGERED", reason: `identical failure fingerprint repeated across correction attempts: ${fingerprint}` },
          `Check '${failure.check}' failed with IDENTICAL output across repeated correction attempts -- no real progress. Escalating, never looping further.`,
        );
        return { runState: runStateRef.current, log };
      }

      const correctionDecision = decideCorrectionAction(runStateRef.current.correctionCount);
      if (correctionDecision.action === "ESCALATE") {
        record(
          { type: "HARD_STOP_TRIGGERED", reason: correctionDecision.reason },
          `Correction budget exhausted for check '${failure.check}': ${correctionDecision.reason}. Escalating.`,
        );
        return { runState: runStateRef.current, log };
      }

      runStateRef.current = { ...runStateRef.current, correctionCount: correctionDecision.attemptNumber };
      await sleep(correctionDecision.backoffMs);

      const correctionPrompt = buildCorrectionPrompt({ checkOrCiName: failure.check, boundedFailureOutput: failure.detail });
      const settled = await settleExecutorRun(
        contract.taskId,
        contract,
        runStateRef,
        log,
        options.now,
        sleep,
        options.sessionId,
        () => options.launcher.resume(options.sessionId, options.cwd, correctionPrompt),
        () => options.launcher.resume(options.sessionId, options.cwd),
      );
      if (settled.kind === "stopped") return { runState: runStateRef.current, log };

      if (settled.outcome.status === "completed_error") {
        const decision = decideNextAction(runStateRef.current, contract, { type: "EXECUTOR_RESULT", outcome: settled.outcome, changedFiles: [] });
        record(decision.event, decision.humanMessage);
        return { runState: runStateRef.current, log };
      }

      // completed_success -- re-review scope BEFORE re-running checks
      // (test requirement 8: "scope changes after correction -> stop").
      record({ type: "EXECUTOR_COMPLETED_CLEANLY" }, `Correction attempt for '${failure.check}' completed cleanly. Re-reviewing scope before re-running checks.`);
      const changedFilesAfterCorrection = await options.captureChangedFiles(options.cwd);
      const scopeDecision = decideNextAction(runStateRef.current, contract, { type: "EXECUTOR_RESULT", outcome: settled.outcome, changedFiles: changedFilesAfterCorrection });
      record(scopeDecision.event, scopeDecision.humanMessage);
      if (scopeDecision.event.type !== "SCOPE_CLEAN") {
        return { runState: runStateRef.current, log };
      }
      // else: back to CHECKS_RUNNING -- loop re-runs every check from scratch.
    }

    // ===================== PHASE 3/4: PRE-COMMIT REVIEW + COMMIT =====================
    const [statusLines, actualHeadSha, changedFilesForCommit] = await Promise.all([
      options.captureStatusLines(options.cwd),
      options.captureHeadSha(options.cwd),
      options.captureChangedFiles(options.cwd),
    ]);

    const review = runPreCommitReview(
      {
        contractAtLaunch: options.contractAtLaunch,
        contractNow: contract,
        expectedHeadSha,
        actualHeadSha,
        changedFiles: changedFilesForCommit,
        statusLines,
        allowedUntrackedPrefixes: options.allowedUntrackedPrefixes,
        checksAllPassed: true,
      },
      options.now,
    );

    if (!review.ok) {
      const failedConditions = review.conditions.filter((c) => !c.passed).map((c) => c.name).join(", ");
      record({ type: "HARD_STOP_TRIGGERED", reason: `pre-commit review failed: ${failedConditions}` }, `Pre-commit review failed (${failedConditions}) -- NO COMMIT. Escalating.`);
      return { runState: runStateRef.current, log };
    }

    if (!isCommitAllowed(contract)) {
      record(
        { type: "OPERATION_NOT_AUTHORIZED", reason: "allowedOperations does not include 'commit'" },
        "Task contract does not authorize 'commit' -- stopping here for a human to review and commit manually.",
      );
      return { runState: runStateRef.current, log };
    }

    const { stageable, blocked } = filterStageableFiles(changedFilesForCommit);
    if (blocked.length > 0) {
      record(
        { type: "HARD_STOP_TRIGGERED", reason: `refused to stage protected paths: ${blocked.join(", ")}` },
        `Refusing to stage protected path(s) (${blocked.join(", ")}) even though they appeared in the diff. Escalating.`,
      );
      return { runState: runStateRef.current, log };
    }

    const commitMessage = buildCommitMessage(contract);
    const commitResult = await options.commit(options.cwd, stageable, commitMessage);
    if (!commitResult.ok || commitResult.sha === null) {
      record({ type: "HARD_STOP_TRIGGERED", reason: `commit failed: ${commitResult.reason ?? "unknown"}` }, `git commit failed (${commitResult.reason ?? "unknown"}). Escalating.`);
      return { runState: runStateRef.current, log };
    }

    const commitDecision = decideNextAction(runStateRef.current, contract, { type: "COMMIT_VERIFIED", sha: commitResult.sha });
    record(commitDecision.event, commitDecision.humanMessage);
    runStateRef.current = { ...runStateRef.current, lastKnownHeadSha: commitResult.sha };
    expectedHeadSha = commitResult.sha;

    // ===================== PHASE 5: PUSH =====================
    if (!isPushAllowed(contract)) {
      record(
        { type: "OPERATION_NOT_AUTHORIZED", reason: "allowedOperations does not include 'push'" },
        "Task contract does not authorize 'push' -- stopping here; the commit exists locally for a human to push manually.",
      );
      return { runState: runStateRef.current, log };
    }

    const pushPre = await options.verifyPushPreconditions(options.cwd);
    if (!pushPre.ok) {
      record({ type: "HARD_STOP_TRIGGERED", reason: `push preconditions failed: ${pushPre.reason ?? "unknown"}` }, `Push preconditions failed (${pushPre.reason ?? "unknown"}) -- refusing to push. Escalating.`);
      return { runState: runStateRef.current, log };
    }

    const pushResult = await options.executePush(options.cwd);
    if (!pushResult.ok) {
      record({ type: "HARD_STOP_TRIGGERED", reason: `push failed: ${pushResult.reason ?? "unknown"}` }, `git push failed (${pushResult.reason ?? "unknown"}). Escalating.`);
      return { runState: runStateRef.current, log };
    }

    const headMatchesOrigin = await options.verifyPushed(options.cwd);
    const pushDecision = decideNextAction(runStateRef.current, contract, { type: "PUSH_VERIFIED_RESULT", headMatchesOrigin });
    record(pushDecision.event, pushDecision.humanMessage);
    if (pushDecision.event.type !== "PUSH_VERIFIED") {
      return { runState: runStateRef.current, log };
    }

    // ===================== PHASE 6/7: CI WATCH + CI CORRECTION =====================
    record({ type: "CI_STARTED" }, "Push verified -- watching CI.");

    for (;;) {
      let ciResult: CiWatchResult;
      if (contract.ciPolicy === "none") {
        ciResult = { allCompleted: true, overallSuccess: true, checks: [], timedOut: false };
      } else {
        const remote = await options.deriveOwnerRepo(options.cwd);
        if (remote === null) {
          record(
            { type: "CI_FAILED_NEEDS_REVIEW", reason: "could not derive owner/repo from the real git remote" },
            "Could not derive the GitHub owner/repo from the real git remote -- cannot watch CI. Needs human review.",
          );
          return { runState: runStateRef.current, log };
        }
        ciResult = await options.pollCi(remote.owner, remote.repo, commitResult.sha);
      }

      const ciOutcome = classifyCiOutcome(contract.ciPolicy, ciResult);

      if (ciOutcome === "success" || ciOutcome === "no_checks_expected") {
        if (needsProductionValidation(contract)) {
          const prodDecision = decideNextAction(runStateRef.current, contract, { type: "PRODUCTION_VALIDATION_NEEDED" });
          record(prodDecision.event, prodDecision.humanMessage);
          return { runState: runStateRef.current, log, productionValidationRequest: buildProductionValidationRequest(contract, commitResult.sha) };
        }
        record(
          { type: "CI_SUCCEEDED" },
          ciOutcome === "no_checks_expected" ? `No CI checks expected for this task (ciPolicy=${contract.ciPolicy}) -- treating as passed.` : "CI succeeded -- verified independently via the GitHub API.",
        );
        return { runState: runStateRef.current, log };
      }

      if (ciOutcome === "cancelled" || ciOutcome === "timed_out") {
        record(
          { type: "CI_FAILED_NEEDS_REVIEW", reason: `${ciOutcome}: ${JSON.stringify(ciResult.checks)}` },
          ciOutcome === "cancelled"
            ? "A CI check was cancelled -- likely an external/human action, not a code defect. Needs human review."
            : "CI did not report a real result within the poll budget. Needs human review, never a silent pass.",
        );
        return { runState: runStateRef.current, log };
      }

      // ciOutcome === "failure" -- Level-1 CI correction loop (Phase 7),
      // same bounded/fingerprinted shape as the check-correction loop
      // above, reusing the SAME correctionCount budget (a check failure
      // and a CI failure are both "the task's own code needs a fix"
      // cases, so sharing one budget is a deliberate, conservative
      // choice -- see this round's own final report for why).
      record({ type: "CI_FAILED_LEVEL_1", reason: JSON.stringify(ciResult.checks) }, "CI failed. Attempting a bounded correction.");

      const ciFingerprint = computeFailureFingerprint("ci", JSON.stringify(ciResult.checks));
      const recentCiFingerprints = [...runStateRef.current.recentCorrectionFingerprints, ciFingerprint];
      runStateRef.current = { ...runStateRef.current, recentCorrectionFingerprints: recentCiFingerprints };

      if (isRepeatedFailure(recentCiFingerprints)) {
        record({ type: "HARD_STOP_TRIGGERED", reason: `identical CI failure fingerprint repeated: ${ciFingerprint}` }, "CI failed with IDENTICAL output across repeated correction attempts -- no real progress. Escalating.");
        return { runState: runStateRef.current, log };
      }

      const ciCorrectionDecision = decideCorrectionAction(runStateRef.current.correctionCount);
      if (ciCorrectionDecision.action === "ESCALATE") {
        record({ type: "RESTART_EXHAUSTED", reason: ciCorrectionDecision.reason }, `CI correction budget exhausted: ${ciCorrectionDecision.reason}. Escalating.`);
        return { runState: runStateRef.current, log };
      }

      record({ type: "RESTART_APPROVED" }, `CI correction ${ciCorrectionDecision.attemptNumber}/3 approved after a ${ciCorrectionDecision.backoffMs}ms backoff.`);
      runStateRef.current = { ...runStateRef.current, correctionCount: ciCorrectionDecision.attemptNumber };
      await sleep(ciCorrectionDecision.backoffMs);
      // CI_FAILED's own RESTART_APPROVED only reaches RESUMING -- unlike
      // the check-correction loop above (already in EXECUTOR_RUNNING via
      // CHECKS_FAILED), this path needs the second, required hop
      // (RESUMING -> EXECUTOR_RUNNING) applied BEFORE the resume's
      // outcome is evaluated, so EXECUTOR_COMPLETED_CLEANLY below is
      // always valid even when settleExecutorRun's own firstAttempt
      // succeeds with zero internal transport retries of its own.
      record({ type: "EXECUTOR_LAUNCHED" }, `Resuming session ${options.sessionId} with a CI correction request.`);

      const ciCorrectionPrompt = buildCorrectionPrompt({ checkOrCiName: "CI", boundedFailureOutput: JSON.stringify(ciResult.checks) });
      const ciSettled = await settleExecutorRun(
        contract.taskId,
        contract,
        runStateRef,
        log,
        options.now,
        sleep,
        options.sessionId,
        () => options.launcher.resume(options.sessionId, options.cwd, ciCorrectionPrompt),
        () => options.launcher.resume(options.sessionId, options.cwd),
      );
      if (ciSettled.kind === "stopped") return { runState: runStateRef.current, log };

      if (ciSettled.outcome.status === "completed_error") {
        const decision = decideNextAction(runStateRef.current, contract, { type: "EXECUTOR_RESULT", outcome: ciSettled.outcome, changedFiles: [] });
        record(decision.event, decision.humanMessage);
        return { runState: runStateRef.current, log };
      }

      // completed_success -- re-review scope, then re-run the WHOLE
      // pipeline (checks -> pre-commit review -> commit -> push -> CI)
      // from the top, since a CI fix needs a brand-new commit.
      record({ type: "EXECUTOR_COMPLETED_CLEANLY" }, "CI correction attempt completed cleanly. Re-reviewing scope before re-running the full pipeline.");
      const changedFilesAfterCiCorrection = await options.captureChangedFiles(options.cwd);
      const ciScopeDecision = decideNextAction(runStateRef.current, contract, { type: "EXECUTOR_RESULT", outcome: ciSettled.outcome, changedFiles: changedFilesAfterCiCorrection });
      record(ciScopeDecision.event, ciScopeDecision.humanMessage);
      if (ciScopeDecision.event.type !== "SCOPE_CLEAN") {
        return { runState: runStateRef.current, log };
      }
      continue pipeline;
    }
  }
}
