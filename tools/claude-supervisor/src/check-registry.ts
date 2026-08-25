// The closed, fixed registry of checks a task contract's requiredChecks
// may reference -- see this round's own task spec: "requiredChecks must
// NEVER become arbitrary shell strings... Each check name maps to a
// fixed cwd/executable/argv/timeout." Pure and zero-I/O: resolving a
// name to a real, runnable command (check-runner.ts) is a SEPARATE step
// so this module stays fully unit-testable without touching a
// filesystem or process.
//
// executables are never "npx"/"npm" -- both are .cmd shims on Windows,
// and Supervisor v1.1's own live smoke test proved (real EINVAL, not a
// guess) that Node's `spawn` with `shell: false` refuses to launch a
// .cmd file directly. Every check therefore runs via the real Node
// binary (`process.execPath`, always a genuine .exe) invoking the
// target tool's own real JS bin entry point directly -- the same fix
// already applied to claude.exe in real-executor-launcher.ts.
import { join } from "node:path";

export type CheckName =
  | "supervisor_test"
  | "supervisor_typecheck"
  | "supervisor_lint"
  | "supervisor_build"
  | "web_typecheck"
  | "web_lint"
  | "web_tests_relevant"
  | "web_tests_full"
  | "web_build";

// The only checks this round's own task actually RUNS -- see this
// module's own doc comment and the final report's "known limitations":
// the web_* entries are registered (so a future AI Hair Architect task's
// contract validates) but check-runner.ts's own real-execution path is
// only exercised end-to-end against the supervisor_* entries in this
// round. web_build in particular is a KNOWN-INCOMPLETE placeholder: the
// real `npm run build` for web/ runs a `prebuild` script first (see
// web/package.json), which this direct node+bin invocation does not
// replicate -- do not treat web_build as verified.
export const RUNNABLE_CHECK_NAMES: ReadonlySet<CheckName> = new Set(["supervisor_test", "supervisor_typecheck", "supervisor_lint", "supervisor_build"]);

export interface CheckDefinition {
  // Which real root directory this check's cwd resolves against --
  // resolution itself (turning this into an absolute path) happens in
  // resolveCheckExecution below, using roots the CALLER provides, so
  // this registry never hardcodes an absolute, machine-specific path.
  cwdBase: "supervisorRoot" | "repoRoot";
  cwdSuffix: string;
  // Path to the tool's real bin entry point, relative to the resolved
  // cwd's own node_modules -- e.g. "node_modules/typescript/bin/tsc".
  binRelativePath: string;
  args: readonly string[];
  timeoutMs: number;
}

export const CHECK_REGISTRY: Readonly<Record<CheckName, CheckDefinition>> = {
  supervisor_typecheck: { cwdBase: "supervisorRoot", cwdSuffix: "", binRelativePath: "node_modules/typescript/bin/tsc", args: ["--noEmit", "-p", "tsconfig.json"], timeoutMs: 60_000 },
  supervisor_lint: { cwdBase: "supervisorRoot", cwdSuffix: "", binRelativePath: "node_modules/eslint/bin/eslint.js", args: ["."], timeoutMs: 60_000 },
  supervisor_test: { cwdBase: "supervisorRoot", cwdSuffix: "", binRelativePath: "node_modules/vitest/vitest.mjs", args: ["run"], timeoutMs: 180_000 },
  // Mirrors this package's own `npm run build` script (`tsc -p
  // tsconfig.json`, no --noEmit) -- invoked directly rather than through
  // `npm run`, since `npm` is itself a .cmd shim on Windows.
  supervisor_build: { cwdBase: "supervisorRoot", cwdSuffix: "", binRelativePath: "node_modules/typescript/bin/tsc", args: ["-p", "tsconfig.json"], timeoutMs: 60_000 },
  web_typecheck: { cwdBase: "repoRoot", cwdSuffix: "web", binRelativePath: "node_modules/typescript/bin/tsc", args: ["--noEmit"], timeoutMs: 300_000 },
  web_lint: { cwdBase: "repoRoot", cwdSuffix: "web", binRelativePath: "node_modules/eslint/bin/eslint.js", args: ["."], timeoutMs: 300_000 },
  web_tests_relevant: { cwdBase: "repoRoot", cwdSuffix: "web", binRelativePath: "node_modules/vitest/vitest.mjs", args: ["run"], timeoutMs: 300_000 },
  web_tests_full: { cwdBase: "repoRoot", cwdSuffix: "web", binRelativePath: "node_modules/vitest/vitest.mjs", args: ["run"], timeoutMs: 600_000 },
  // UNVERIFIED placeholder -- see RUNNABLE_CHECK_NAMES's own doc comment.
  web_build: { cwdBase: "repoRoot", cwdSuffix: "web", binRelativePath: "node_modules/next/dist/bin/next", args: ["build"], timeoutMs: 600_000 },
};

export function isKnownCheckName(name: string): name is CheckName {
  return Object.prototype.hasOwnProperty.call(CHECK_REGISTRY, name);
}

export interface CheckRoots {
  supervisorRoot: string;
  repoRoot: string;
  nodeExecutable: string;
}

export interface ResolvedCheck {
  checkName: CheckName;
  cwd: string;
  program: string;
  args: string[];
  timeoutMs: number;
}

// Pure resolution: name + roots -> a concrete, runnable command. No
// filesystem access (does not verify the bin path actually exists) --
// that verification is check-runner.ts's own job, at the moment it
// actually spawns.
export function resolveCheckExecution(checkName: CheckName, roots: CheckRoots): ResolvedCheck {
  const def = CHECK_REGISTRY[checkName];
  const baseDir = def.cwdBase === "supervisorRoot" ? roots.supervisorRoot : roots.repoRoot;
  const cwd = def.cwdSuffix.length > 0 ? join(baseDir, def.cwdSuffix) : baseDir;
  const binPath = join(cwd, def.binRelativePath);
  return { checkName, cwd, program: roots.nodeExecutable, args: [binPath, ...def.args], timeoutMs: def.timeoutMs };
}
