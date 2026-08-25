// Thin glue that actually runs one resolved check (check-registry.ts's
// own pure resolution) via safe-exec.ts's execSafe -- captures exit
// code, duration, and a BOUNDED stdout/stderr summary. "Do not persist
// huge logs" (this round's own task spec) is enforced here, once, so no
// caller ever has to remember to truncate before logging/persisting.
import { execSafe, type ExecResult } from "./safe-exec.js";
import type { CheckName, ResolvedCheck } from "./check-registry.js";

const MAX_SUMMARY_CHARS = 4_000;

// Keeps the END of the output (the most recent, usually most relevant
// lines -- e.g. tsc's actual error list appears after any preamble) --
// never silently keeps the start and drops the actual failure detail.
export function truncateSummary(text: string, maxChars: number = MAX_SUMMARY_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const omitted = trimmed.length - maxChars;
  return `...[truncated ${omitted} earlier chars]...\n${trimmed.slice(trimmed.length - maxChars)}`;
}

export interface CheckExecutionResult {
  check: CheckName;
  passed: boolean;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  summary: string;
}

export type ExecImpl = (program: string, args: readonly string[], options: { cwd?: string; timeoutMs?: number }) => Promise<ExecResult>;

export async function runResolvedCheck(resolved: ResolvedCheck, execImpl: ExecImpl = execSafe): Promise<CheckExecutionResult> {
  const start = Date.now();
  const result = await execImpl(resolved.program, resolved.args, { cwd: resolved.cwd, timeoutMs: resolved.timeoutMs });
  const durationMs = Date.now() - start;
  const passed = result.exitCode === 0 && !result.timedOut;
  const combined = [result.stdout, result.stderr].filter((s) => s.length > 0).join("\n");
  return {
    check: resolved.checkName,
    passed,
    exitCode: result.exitCode,
    durationMs,
    timedOut: result.timedOut,
    summary: truncateSummary(combined),
  };
}
