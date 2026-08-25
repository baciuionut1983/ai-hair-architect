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
import { captureGitSnapshot } from "./git-inspect.js";
import { runActiveExecution, runPreflight } from "./orchestrator.js";
import { initialRunState, loadRunStateFromDisk, runStateFilePath, saveRunStateToDisk } from "./persistence.js";
import { createRealExecutorLauncher, resolveRealClaudeBinary } from "./real-executor-launcher.js";
import { validateTaskContract } from "./task-contract.js";

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
}

export function parseCliArgs(argv: readonly string[]): CliOptions | { error: string } {
  const taskIndex = argv.indexOf("--task");
  if (taskIndex === -1 || !argv[taskIndex + 1]) {
    return { error: "missing required --task <path-to-contract.json>" };
  }
  const cwdIndex = argv.indexOf("--cwd");
  const stateDirIndex = argv.indexOf("--state-dir");
  return {
    taskContractPath: argv[taskIndex + 1],
    dryRun: argv.includes("--dry-run"),
    active: argv.includes("--active"),
    cwd: cwdIndex !== -1 && argv[cwdIndex + 1] ? argv[cwdIndex + 1] : process.cwd(),
    stateDir: stateDirIndex !== -1 && argv[stateDirIndex + 1] ? argv[stateDirIndex + 1] : resolve(import.meta.dirname, "..", "state"),
  };
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if ("error" in options) {
    console.error(`[SUPERVISOR] ${options.error}`);
    process.exitCode = 1;
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
    const runState = existing.ok ? existing.state! : initialRunState(contract.taskId);

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

    const binaryPath = resolveRealClaudeBinary();
    if (binaryPath === null) {
      console.log(
        "[SUPERVISOR] ACTIVE mode: could not resolve a real Claude Code binary (checked CLAUDE_SUPERVISOR_CLAUDE_BINARY and the known install candidates). Escalating without launching anything.",
      );
      saveRunStateToDisk(statePath, { ...runState, state: "ESCALATED", updatedAt: new Date().toISOString(), lastAction: "could not resolve claude binary" });
      return;
    }

    const sessionId = randomUUID();
    console.log(`[SUPERVISOR] ACTIVE mode: launching executor session ${sessionId} for taskId=${contract.taskId}.`);
    const result = await runActiveExecution({
      contract,
      runState: { ...runState, state: "PREFLIGHT" },
      cwd: options.cwd,
      sessionId,
      launcher: createRealExecutorLauncher(binaryPath),
      captureChangedFiles: async (cwd) => (await captureGitSnapshot(cwd)).changedFiles,
      now: () => new Date().toISOString(),
    });
    console.log(`[SUPERVISOR] ACTIVE mode finished: taskId=${contract.taskId} finalState=${result.runState.state} lastAction=${result.runState.lastAction}`);
    saveRunStateToDisk(statePath, result.runState);
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
