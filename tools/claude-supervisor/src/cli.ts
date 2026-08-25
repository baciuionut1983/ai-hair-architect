#!/usr/bin/env node
// Supervisor v1 -- CLI entrypoint. Deliberately thin, deliberately
// under-tested relative to every pure module it wires together (same
// convention as this whole package's own README-equivalent, the final
// report, documents for claude-cli.ts's own spawn boundary) -- this file
// parses argv, loads a task contract, runs the (always-safe, read-only)
// preflight, and then either PRINTS a dry-run plan or refuses to proceed
// into ACTIVE mode until a live smoke test has validated the executor-
// spawn path end to end (see this round's own final report's "exact next
// task to move DRY RUN -> ACTIVE").
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { acquireLock, releaseLock } from "./lock.js";
import { containsClaudeDirSegment } from "./clean-path-guard.js";
import { captureGitSnapshot, verifyHeadMatchesOrigin } from "./git-inspect.js";
import { runActiveExecution, runPreflight, runQualityGatesAndCommitPush } from "./orchestrator.js";
import type { ExecutorLauncher } from "./orchestrator.js";
import { initialRunState, loadRunStateFromDisk, runStateFilePath, saveRunStateToDisk } from "./persistence.js";
import { createAgentSdkExecutorLauncher } from "./agent-sdk-executor-launcher.js";
import { createRealExecutorLauncher, resolveRealClaudeBinary } from "./real-executor-launcher.js";
import { selectExecutorTransport } from "./executor-transport-selection.js";
import { validateTaskContract } from "./task-contract.js";
import { reconcileOnRestart } from "./restart-recovery.js";
import { resolveCheckExecution } from "./check-registry.js";
import { runResolvedCheck } from "./check-runner.js";
import { stageAndCommit } from "./commit-runner.js";
import { safePushOriginMaster, verifyPushPreconditions as realVerifyPushPreconditions } from "./push-runner.js";
import { deriveOwnerRepoFromGit, pollUntilComplete } from "./ci-watch.js";
import { execSafe } from "./safe-exec.js";
import { transition } from "./state-machine.js";
import type { SupervisorState } from "./types.js";

// Untracked directories/files this Supervisor must NEVER treat as a
// dirty working tree -- see git-inspect.ts's own doc comment and this
// project's own established convention (every VAD/voice phase in this
// repo's real history preflight-checked this exact exception).
const ALLOWED_UNTRACKED_PREFIXES = [".claude"];

interface CliOptions {
  taskContractPath: string;
  dryRun: boolean;
  // Test requirement 9 ("active flag required"): ACTIVE mode is refused
  // by default (see main() below) unless this explicit opt-in flag is
  // present -- there is no way to reach ACTIVE mode merely by omitting
  // --dry-run.
  active: boolean;
  cwd: string;
  stateDir: string;
  // Phase 10: the ONLY human-production-validation completion mechanism
  // -- a closed, taskId-only argument, never a free-form command. When
  // present, main() does nothing else (no contract load, no executor,
  // no checks/commit/push) except apply the one, fixed
  // PRODUCTION_VALIDATED transition to that exact task's persisted
  // state.
  approveProductionTaskId: string | null;
}

export function parseCliArgs(argv: readonly string[]): CliOptions | { error: string } {
  const cwdIndex = argv.indexOf("--cwd");
  const stateDirIndex = argv.indexOf("--state-dir");
  const approveIndex = argv.indexOf("--approve-production");
  const cwd = cwdIndex !== -1 && argv[cwdIndex + 1] ? argv[cwdIndex + 1] : process.cwd();
  const stateDir = stateDirIndex !== -1 && argv[stateDirIndex + 1] ? argv[stateDirIndex + 1] : resolve(import.meta.dirname, "..", "state");

  if (approveIndex !== -1) {
    if (!argv[approveIndex + 1]) {
      return { error: "--approve-production requires a taskId argument" };
    }
    return { taskContractPath: "", dryRun: false, active: false, cwd, stateDir, approveProductionTaskId: argv[approveIndex + 1] };
  }

  const taskIndex = argv.indexOf("--task");
  if (taskIndex === -1 || !argv[taskIndex + 1]) {
    return { error: "missing required --task <path-to-contract.json> (or --approve-production <taskId>)" };
  }
  return {
    taskContractPath: argv[taskIndex + 1],
    dryRun: argv.includes("--dry-run"),
    active: argv.includes("--active"),
    cwd,
    stateDir,
    approveProductionTaskId: null,
  };
}

// Phase 10's own closed completion mechanism -- loads ONLY the
// persisted run state for this exact taskId and applies the ONE fixed
// PRODUCTION_VALIDATED transition (WAITING_FOR_HUMAN -> COMPLETED).
// Never touches the task contract, never launches anything, never
// accepts any text beyond the taskId itself.
function runApproveProduction(taskId: string, stateDir: string): void {
  const statePath = runStateFilePath(stateDir, taskId);
  const existing = loadRunStateFromDisk(statePath);
  if (!existing.ok || !existing.state) {
    console.error(`[SUPERVISOR] --approve-production: no persisted state found for taskId=${taskId} (${existing.reason ?? "not found"}).`);
    process.exitCode = 1;
    return;
  }
  const runState = existing.state;
  if (runState.state !== "WAITING_FOR_HUMAN") {
    console.error(`[SUPERVISOR] --approve-production: taskId=${taskId} is in state ${runState.state}, not WAITING_FOR_HUMAN -- refusing.`);
    process.exitCode = 1;
    return;
  }
  const result = transition(runState.state, { type: "PRODUCTION_VALIDATED" });
  const nextState: SupervisorState = result.ok ? result.next : runState.state;
  const now = new Date().toISOString();
  saveRunStateToDisk(statePath, { ...runState, state: nextState, updatedAt: now, lastAction: "human confirmed real production validation via --approve-production" });
  console.log(`[SUPERVISOR] taskId=${taskId} state=${nextState} action=PRODUCTION_VALIDATED result=human-approved production validation.`);
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if ("error" in options) {
    console.error(`[SUPERVISOR] ${options.error}`);
    process.exitCode = 1;
    return;
  }

  if (options.approveProductionTaskId !== null) {
    runApproveProduction(options.approveProductionTaskId, options.stateDir);
    return;
  }

  const raw = JSON.parse(readFileSync(options.taskContractPath, "utf8"));
  const validation = validateTaskContract(raw);
  if (!validation.ok) {
    console.error(`[SUPERVISOR] invalid task contract: ${validation.reason}`);
    process.exitCode = 1;
    return;
  }
  const contract = validation.contract;

  const lockPath = resolve(options.stateDir, "repo.lock");
  const lockResult = acquireLock(lockPath, contract.taskId);
  if (!lockResult.ok) {
    console.error(
      `[SUPERVISOR] refusing to start: another Supervisor/executor already holds the lock for this worktree (pid=${lockResult.holder?.pid ?? "unknown"}).`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    const statePath = runStateFilePath(options.stateDir, contract.taskId);
    const existing = loadRunStateFromDisk(statePath);
    let runState = existing.ok ? existing.state! : initialRunState(contract.taskId);

    // Phase 9 -- "On restart: inspect reality first. Never assume
    // persisted state is truth." Only relevant once a run has actually
    // recorded a commit (see restart-recovery.ts's own doc comment for
    // why earlier states are always trivially safe); a terminal state
    // (COMPLETED/ESCALATED/HARD_STOP) needs no reconciliation either --
    // it is already done, one way or another.
    if (runState.lastKnownHeadSha !== null && !["COMPLETED", "ESCALATED", "HARD_STOP"].includes(runState.state)) {
      const snapshot = await captureGitSnapshot(options.cwd);
      const reconciliation = reconcileOnRestart(runState, { headSha: snapshot.headSha, originMasterSha: snapshot.originMasterSha });
      if (reconciliation.action === "ESCALATE") {
        console.log(`[SUPERVISOR] restart reconciliation ESCALATED for taskId=${contract.taskId}: ${reconciliation.reason}`);
        saveRunStateToDisk(statePath, { ...runState, state: "ESCALATED", updatedAt: new Date().toISOString(), lastAction: `restart reconciliation: ${reconciliation.reason}` });
        return;
      }
      if (reconciliation.action === "TRUST_AND_ADVANCE") {
        console.log(`[SUPERVISOR] restart reconciliation ADVANCED taskId=${contract.taskId}: ${reconciliation.reason}`);
      }
      runState = reconciliation.reconciledState;
    }

    console.log(`[SUPERVISOR] taskId=${contract.taskId} state=${runState.state} mode=${options.dryRun ? "DRY_RUN" : "ACTIVE"}`);

    const preflight = await runPreflight(options.cwd, ALLOWED_UNTRACKED_PREFIXES);
    console.log(
      `[SUPERVISOR] preflight: clean=${preflight.clean} headSha=${preflight.headSha}${preflight.reason ? ` reason=${preflight.reason}` : ""}`,
    );

    if (options.dryRun) {
      console.log("[SUPERVISOR] DRY RUN: no executor will be launched, no commit/push will be verified or performed, no state will be persisted.");
      console.log(
        `[SUPERVISOR] DRY RUN plan: would ${preflight.clean ? "proceed to PREFLIGHT_PASSED and launch the executor with the approved prompt" : "PREFLIGHT_FAILED and escalate without ever launching the executor"}.`,
      );
      return;
    }

    // ACTIVE mode requires the explicit --active flag (test requirement
    // 9) -- omitting --dry-run alone is never enough. This is the
    // default-refusal path: no executor is started, no lock action
    // beyond this run's own is taken.
    if (!options.active) {
      console.log(
        "[SUPERVISOR] refusing ACTIVE mode: pass --active explicitly to launch a real executor (default is refusal, not launch). No executor was started.",
      );
      saveRunStateToDisk(statePath, runState);
      return;
    }

    if (!preflight.clean) {
      console.log("[SUPERVISOR] ACTIVE mode: preflight failed -- never launching an executor against an unclean working tree. Escalating.");
      saveRunStateToDisk(statePath, { ...runState, state: "ESCALATED", updatedAt: new Date().toISOString(), lastAction: `preflight failed: ${preflight.reason ?? "unknown"}` });
      return;
    }

    // v1.3.1: clean-path precondition, fail-closed. This round's own
    // live clean-path isolation validation found that Claude Code's
    // built-in "sensitive file" Write/Edit classifier fires
    // nondeterministically whenever cwd sits under a ".claude" ancestor
    // segment (exactly this repo's own canonical checkout location), and
    // that the identical real create/edit/read/resume-edit cycle
    // succeeds cleanly once that segment is absent. Never launching a
    // real executor against a cwd known to trigger this, regardless of
    // which transport is selected below -- see clean-path-guard.ts.
    if (containsClaudeDirSegment(options.cwd)) {
      console.log(
        `[SUPERVISOR] ACTIVE mode: refusing to launch -- cwd (${options.cwd}) contains a ".claude" path segment, which this round's own live testing confirmed causes nondeterministic Write/Edit denials. Re-run from a clean path (e.g. a git worktree outside any .claude ancestor directory) instead. Escalating without launching anything.`,
      );
      saveRunStateToDisk(statePath, { ...runState, state: "ESCALATED", updatedAt: new Date().toISOString(), lastAction: `refused to launch: cwd contains a .claude path segment (${options.cwd})` });
      return;
    }

    // v1.3: transport selection is explicit and fail-closed -- default
    // is the Agent SDK transport (this round's own migration target);
    // the legacy claude -p CLI transport is reachable only via the exact
    // CLAUDE_SUPERVISOR_TRANSPORT=cli-legacy opt-in, never automatically,
    // and never as a silent fallback in either direction (see this
    // round's own approved plan, "Legacy CLI transport").
    const transportSelection = selectExecutorTransport(process.env);
    let launcher: ExecutorLauncher;
    if (transportSelection.transport === "cli-legacy") {
      console.log("[SUPERVISOR] ACTIVE mode: CLAUDE_SUPERVISOR_TRANSPORT=cli-legacy -- using the legacy claude -p CLI transport (explicit opt-in, not the default).");
      const binaryPath = resolveRealClaudeBinary();
      if (binaryPath === null) {
        console.log(
          "[SUPERVISOR] ACTIVE mode: could not resolve a real Claude Code binary (checked CLAUDE_SUPERVISOR_CLAUDE_BINARY and the known install candidates). Escalating without launching anything.",
        );
        saveRunStateToDisk(statePath, { ...runState, state: "ESCALATED", updatedAt: new Date().toISOString(), lastAction: "could not resolve claude binary" });
        return;
      }
      launcher = createRealExecutorLauncher(binaryPath);
    } else {
      launcher = createAgentSdkExecutorLauncher();
    }

    const sessionId = randomUUID();
    const now = (): string => new Date().toISOString();
    // v1.3 fix: captureGitSnapshot's own changedFiles now includes newly-
    // created (untracked) files, not just tracked-file diffs (see
    // git-inspect.ts's own doc comment). Without this filter, .claude/'s
    // own perpetually-untracked, never-git-tracked contents (this
    // project's established, expected state -- see
    // ALLOWED_UNTRACKED_PREFIXES above) would show up as "changed" on
    // EVERY run and trip a Level 2 scope violation against .claude/ in
    // protectedAreas, even though the executor never touched it. This
    // applies the exact same, already-established exclusion used
    // everywhere else in this file -- never a new, separate rule.
    const captureChangedFiles = async (cwd: string): Promise<readonly string[]> =>
      (await captureGitSnapshot(cwd)).changedFiles.filter((path) => !ALLOWED_UNTRACKED_PREFIXES.some((prefix) => path.startsWith(prefix)));

    console.log(`[SUPERVISOR] ACTIVE mode: launching executor session ${sessionId} for taskId=${contract.taskId}.`);
    const launchResult = await runActiveExecution({
      contract,
      runState: { ...runState, state: "PREFLIGHT" },
      cwd: options.cwd,
      sessionId,
      launcher,
      captureChangedFiles,
      now,
    });

    let finalResult = launchResult;
    if (launchResult.runState.state === "CHECKS_RUNNING") {
      // v1.2: scope was clean -- continue through required checks,
      // pre-commit review, commit, push, and CI watch. The supervisor's
      // OWN package root (for supervisor_* checks) is always this file's
      // own installed location, never the executor's --cwd.
      const supervisorRoot = resolve(import.meta.dirname, "..");
      const expectedRemote = await deriveOwnerRepoFromGit(options.cwd, execSafe);
      const qualityGatesResult = await runQualityGatesAndCommitPush({
        contract,
        contractAtLaunch: contract,
        runState: launchResult.runState,
        cwd: options.cwd,
        sessionId,
        launcher,
        expectedHeadSha: preflight.headSha,
        captureChangedFiles,
        captureStatusLines: async (cwd) => (await captureGitSnapshot(cwd)).statusLines,
        captureHeadSha: async (cwd) => (await captureGitSnapshot(cwd)).headSha,
        verifyPushed: verifyHeadMatchesOrigin,
        runCheck: async (checkName, cwd) =>
          runResolvedCheck(resolveCheckExecution(checkName, { supervisorRoot, repoRoot: cwd, nodeExecutable: process.execPath })),
        commit: (cwd, files, message) => stageAndCommit(cwd, files, message),
        verifyPushPreconditions: (cwd) => {
          if (expectedRemote === null) return Promise.resolve({ ok: false, reason: "could not derive the expected owner/repo from the real git remote" });
          return realVerifyPushPreconditions(cwd, expectedRemote);
        },
        executePush: (cwd) => safePushOriginMaster(cwd),
        deriveOwnerRepo: (cwd) => deriveOwnerRepoFromGit(cwd, execSafe),
        pollCi: (owner, repo, sha) => pollUntilComplete(owner, repo, sha),
        allowedUntrackedPrefixes: ALLOWED_UNTRACKED_PREFIXES,
        now,
      });
      finalResult = { runState: qualityGatesResult.runState, log: [...launchResult.log, ...qualityGatesResult.log] };
      if (qualityGatesResult.productionValidationRequest) {
        console.log(`[SUPERVISOR] PRODUCTION VALIDATION REQUIRED for taskId=${contract.taskId}:`);
        console.log(JSON.stringify(qualityGatesResult.productionValidationRequest, null, 2));
        console.log(`[SUPERVISOR] Once verified for real, run: node dist/cli.js --approve-production ${contract.taskId} --state-dir ${options.stateDir}`);
      }
    }

    console.log(`[SUPERVISOR] ACTIVE mode finished: taskId=${contract.taskId} finalState=${finalResult.runState.state} lastAction=${finalResult.runState.lastAction}`);
    saveRunStateToDisk(statePath, finalResult.runState);
  } finally {
    releaseLock(lockPath);
  }
}

// Only runs main() when this file is executed directly as a script
// (`node dist/cli.js ...` / the package's own `bin` entry) -- NEVER on
// import. Without this guard, cli.test.ts's own `import { parseCliArgs }
// from "./cli"` would trigger a real, unwanted execution of main() (argv
// parsing against the TEST RUNNER's own argv, a real git preflight, a
// real lock acquisition) as a side effect of merely loading the module
// for its one pure export -- exactly the kind of accidental action a
// Supervisor's own test suite must never risk.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(`[SUPERVISOR] fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
