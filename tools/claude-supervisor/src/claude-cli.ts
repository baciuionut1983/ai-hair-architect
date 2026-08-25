// Claude Code CLI integration -- argv construction is PURE and fully
// tested below; the actual process spawn (spawnExecutor at the bottom)
// is deliberately thin, UNTESTED glue (same "pure logic vs. browser/OS
// glue" split this whole project already uses everywhere else, e.g.
// silero-vad-shadow-runtime.ts vs. silero-vad-shadow-logic.ts) -- a real
// Claude Code child process cannot be meaningfully mocked without
// re-implementing the CLI itself, so this boundary is verified by a real
// smoke-test launch instead (see this round's own final report's "known
// limitations" and "exact next task to move DRY RUN -> ACTIVE").
//
// FACTS THIS MODULE IS BUILT FROM (verified directly against the
// INSTALLED binary during Phase 0's own audit -- `claude --help` on
// v2.1.241 -- not just generic/latest online docs, which can drift from
// what is actually installed):
//   - `claude` is NOT guaranteed to be on PATH for a spawned child
//     process even when it demonstrably IS installed (confirmed live on
//     this exact machine: installed at
//     `%APPDATA%\npm\claude.cmd`/`.ps1`/`claude`, but absent from PATH in
//     both the Bash-tool and PowerShell-tool shells used throughout this
//     session) -- resolveClaudeBinary below never assumes a bare `claude`
//     invocation will work.
//   - `--session-id <uuid>` lets the Supervisor PRE-ASSIGN a session id
//     before ever launching, removing the "discover the session id after
//     the fact" race entirely -- the Supervisor generates the UUID
//     itself and persists it (persistence.ts) BEFORE spawning.
//   - `-p/--print` + `--output-format stream-json` gives real-time,
//     newline-delimited JSON events on stdout -- this is NOT screen
//     scraping (this round's own task spec's explicit concern): it is
//     consuming an official, documented, structured protocol, the same
//     class of interface `claude agents --json` also exposes for
//     listing sessions.
//   - `-r/--resume <id>` resumes a specific session by its id.
//   - `--permission-mode acceptEdits` matches this project's own
//     existing, already-granted "autopilot" authorization (normal edits/
//     tests/commit/push without per-action confirmation; destructive
//     operations still require a human) -- never bypassPermissions,
//     which this module never selects on its own.
//   - `--bare` was deliberately NOT selected as a default here, even
//     though the CLI's own --help recommends it "for CI/scripts": --bare
//     also disables hooks, and a future ACTIVE-mode iteration of this
//     Supervisor that wants Stop/SessionEnd hook notifications (see this
//     round's own final report's "known limitations") would need them
//     enabled. v1's own primary detection mechanism (direct child-process
//     spawn + exit-code/stream inspection, see orchestrator.ts) does not
//     require hooks either way, so this is a forward-compatible choice,
//     not a functional requirement of v1 itself.
import { existsSync } from "node:fs";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export interface ResolveClaudeBinaryOptions {
  envOverride?: string;
  candidates: readonly string[];
  exists?: (path: string) => boolean;
}

// Resolution order: an explicit env override always wins (lets a human
// pin an exact install path without touching code); then a fixed list of
// plausible install locations, checked in order; `claude` bare is
// included LAST, not first, specifically because Phase 0's own audit
// proved it cannot be assumed to resolve correctly from every spawned
// shell context on this machine, even though it demonstrably IS
// installed.
export function resolveClaudeBinary(options: ResolveClaudeBinaryOptions): string | null {
  const exists = options.exists ?? existsSync;
  if (options.envOverride && exists(options.envOverride)) {
    return options.envOverride;
  }
  for (const candidate of options.candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

export interface LaunchArgsInput {
  sessionId: string;
  prompt: string;
  permissionMode: "acceptEdits" | "manual" | "plan";
  cwd: string;
}

// The FIRST launch of a task -- includes the full approved prompt
// verbatim (see task-contract.ts's own doc comment: the Supervisor never
// rewrites it).
export function buildLaunchArgs(input: LaunchArgsInput): string[] {
  return [
    "-p",
    input.prompt,
    "--session-id",
    input.sessionId,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    input.permissionMode,
    "--add-dir",
    input.cwd,
  ];
}

export interface ResumeArgsInput {
  sessionId: string;
  permissionMode: "acceptEdits" | "manual" | "plan";
  cwd: string;
  // The FIXED, non-negotiable continuation instruction -- see this
  // round's own task spec's own exact wording, reused verbatim rather
  // than re-paraphrased by the Supervisor itself (a paraphrase risks
  // silently narrowing or widening what "continue" means for this task).
}
const RESUME_INSTRUCTION =
  "Continuă exact din starea actuală. Verifică modificările deja existente și nu recrea munca finalizată. Continuă taskul aprobat.";

export function buildResumeArgs(input: ResumeArgsInput): string[] {
  return [
    "-p",
    RESUME_INSTRUCTION,
    "--resume",
    input.sessionId,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    input.permissionMode,
    "--add-dir",
    input.cwd,
  ];
}

export type ExecutorChildProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface SpawnedExecutor {
  process: ExecutorChildProcess;
  sessionId: string;
}

// Thin, deliberately un-mocked glue -- see this module's own top-level
// doc comment for why. The orchestrator attaches its own stdout
// line-reader (parsing stream-json events) and its own `exit`/`close`
// listener to `process` directly; this function's only job is
// resolving the binary and building a correctly-shaped child process.
//
// stdin is explicitly "ignore" (closed at spawn), never an open, empty
// pipe: v1.1 always drives the executor via `--input-format text` (the
// default) with the prompt passed through argv (`-p`), never via
// `--input-format stream-json` piped over stdin. Confirmed live during
// this round's own Phase 2 smoke test: an inherited-but-unwritten stdin
// pipe makes the real binary print "Warning: no stdin data received in
// 3s, proceeding without it" and stall for that full 3s on every single
// launch/resume -- "ignore" removes the open pipe entirely so the CLI
// sees closed stdin immediately and skips the wait.
export function spawnExecutor(binaryPath: string, args: readonly string[], cwd: string): SpawnedExecutor {
  const child = spawn(binaryPath, args, {
    cwd,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const sessionIdIndex = args.indexOf("--session-id");
  const resumeIndex = args.indexOf("--resume");
  const sessionId = sessionIdIndex >= 0 ? args[sessionIdIndex + 1] : resumeIndex >= 0 ? args[resumeIndex + 1] : "";
  return { process: child, sessionId };
}
