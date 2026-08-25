// Thin, deliberately un-mocked glue wiring claude-cli.ts (argv + spawn)
// and executor-runner.ts (stream observation) into the ExecutorLauncher
// shape orchestrator.ts's runActiveExecution expects. See claude-cli.ts's
// own top-level doc comment for why the spawn boundary itself is not
// unit-tested here -- both of this module's own dependencies already
// carry their own full test coverage (claude-cli.test.ts,
// executor-runner.test.ts), and orchestrator.test.ts exercises the
// decision loop this feeds via a FAKE launcher, so the only untested
// surface is the two one-line bodies below that call the real spawn.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { RESUME_INSTRUCTION, buildLaunchArgs, buildResumeArgs, resolveClaudeBinary, spawnExecutor } from "./claude-cli.js";
import { observeExecutorProcess } from "./executor-runner.js";
import type { ExecutorLauncher } from "./orchestrator.js";
import type { ExecutorOutcome } from "./stream-events.js";

// Real install-location candidates, verified LIVE during Supervisor
// v1.1's own Phase 0/1 audit on the actual development machine: the npm
// global shims (`claude`/`claude.cmd`/`claude.ps1`) all ultimately exec
// this exact `.exe`, which -- unlike the shims -- Node's `child_process.
// spawn` can launch directly with `shell: false` (see claude-cli.ts's
// own doc comment: spawning a `.cmd` file with `shell: false` throws
// EINVAL on modern Node, a real, live-confirmed finding from this
// round's own smoke test, not a hypothetical). The Unix path below is a
// best-effort convention (`npm root -g`'s typical global layout) that
// was NOT independently verified on any real Unix machine in this
// round's audit -- this whole package's own environment (Phase 0) is
// Windows/PowerShell only so far.
export function defaultClaudeBinaryCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = [];
  if (env.APPDATA) {
    candidates.push(join(env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
  }
  candidates.push("/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude");
  return candidates;
}

export function resolveRealClaudeBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveClaudeBinary({
    envOverride: env.CLAUDE_SUPERVISOR_CLAUDE_BINARY,
    candidates: defaultClaudeBinaryCandidates(env),
    exists: existsSync,
  });
}

export type PermissionMode = "acceptEdits" | "manual" | "plan";

// `acceptEdits` is this function's own default -- matches this project's
// own already-granted "autopilot" authorization (normal edits/tests/
// commit/push without per-action confirmation; destructive operations
// still require a human, enforced entirely at the scope-guard/state-
// machine layer, never by asking the CLI itself for less access than it
// would otherwise have). Never defaults to bypassPermissions.
export function createRealExecutorLauncher(binaryPath: string, permissionMode: PermissionMode = "acceptEdits"): ExecutorLauncher {
  return {
    launch(sessionId: string, prompt: string, cwd: string): Promise<ExecutorOutcome> {
      const args = buildLaunchArgs({ sessionId, prompt, permissionMode, cwd });
      const { process: child } = spawnExecutor(binaryPath, args, cwd);
      return observeExecutorProcess(child);
    },
    resume(sessionId: string, cwd: string, prompt: string = RESUME_INSTRUCTION): Promise<ExecutorOutcome> {
      const args = buildResumeArgs({ sessionId, prompt, permissionMode, cwd });
      const { process: child } = spawnExecutor(binaryPath, args, cwd);
      return observeExecutorProcess(child);
    },
  };
}
