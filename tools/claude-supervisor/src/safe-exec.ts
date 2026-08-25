// The Supervisor's OWN command execution boundary -- see this round's
// own task spec's SECURITY section: "Treat Claude output as UNTRUSTED
// INPUT... Do not execute arbitrary shell text emitted by Claude...
// Never implement: 'Claude says run <string> -> shell executes
// <string>'." This module is the single place in the whole package that
// spawns a real OS process, and it NEVER accepts a free-form command
// string from anywhere -- every call site passes a fixed program name
// plus a fixed argv ARRAY (never string-concatenated, never shell-
// interpolated), using `spawn` with `shell: false` (the Node default),
// which means even a malicious-looking argument value (e.g. a file path
// containing `; rm -rf /`) is passed to the child process as a single,
// literal argv entry -- never re-parsed by a shell.
//
// This module is intentionally the ONLY place allowed to call
// child_process.spawn in this whole package -- every other module
// (git-inspect.ts, claude-cli.ts, ci-watch.ts) goes through this one.
import { spawn } from "node:child_process";

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_TIMEOUT_MS = 120_000;

// program/args are ALWAYS literal, hardcoded call-site values (git,
// npx, npm, node, the resolved claude binary path) -- never derived from
// executor/task-contract free text. See COMMAND_REGISTRY below for the
// one place task-contract "requiredChecks" NAMES (e.g. "tsc") are
// resolved to a real argv array -- resolution happens through a fixed
// lookup table, never through string interpolation of the name itself.
export function execSafe(program: string, args: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: `${stderr}\nspawn_error: ${error.message}`, timedOut });
    });
  });
}

// The FIXED, human-auditable registry mapping a task contract's own
// requiredChecks NAME (a closed enum, see task-contract.ts's own
// validation) to the real program+argv that check runs -- resolved by
// exact-name lookup only, never by interpolating the name into a shell
// string. `cwd` for every entry is the Next.js app directory
// (web/), matching how every check in this repo has always been run
// throughout this whole project's history.
export interface CheckCommand {
  program: string;
  args: string[];
}

export function resolveCheckCommand(checkName: "tsc" | "eslint" | "vitest" | "build"): CheckCommand {
  switch (checkName) {
    case "tsc":
      return { program: "npx", args: ["tsc", "--noEmit", "-p", "tsconfig.json"] };
    case "eslint":
      return { program: "npx", args: ["eslint", "."] };
    case "vitest":
      return { program: "npx", args: ["vitest", "run"] };
    case "build":
      return { program: "npm", args: ["run", "build"] };
  }
}

// Read-only git inspection commands the Supervisor runs to verify the
// executor's own claims independently -- see git-inspect.ts for the
// parsing layer built on top of these.
export const GIT_STATUS_ARGS = ["status", "--short"] as const;
export const GIT_DIFF_STAT_ARGS = ["diff", "--stat"] as const;
export const GIT_DIFF_NAME_ONLY_ARGS = ["diff", "--name-only"] as const;
export const GIT_LOG_ONE_ARGS = ["log", "-1", "--format=%H"] as const;
export function gitRevParseArgs(ref: string): string[] {
  return ["rev-parse", ref];
}
