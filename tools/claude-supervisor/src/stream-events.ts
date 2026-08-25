// Parsing for Claude Code's `--output-format stream-json` protocol --
// newline-delimited JSON, one event object per line. See this module's
// own HONESTY NOTE below: the exact event shape was confirmed to EXIST
// (the CLI flag itself, verified live against the installed v2.1.241
// binary's own --help) but its precise field-level schema was NOT
// independently confirmed against a real, live stream in this round's
// own audit (doing so would require spawning a real, billed Claude Code
// session purely to inspect its output shape, which Phase 0's own "audit
// first, zero implementation" instruction weighed against doing here).
// Every function below is therefore DELIBERATELY lenient: an unrecognized
// or malformed line degrades to an "unknown" event rather than throwing,
// so a schema detail this module guessed wrong about can never crash the
// Supervisor -- it can only ever make outcome detection less precise,
// which orchestrator.ts's own process-exit-code check (a completely
// independent, structurally guaranteed signal, see claude-cli.ts) backs
// up regardless. CONFIRMING THIS PARSER AGAINST A REAL LIVE STREAM is the
// explicit FIRST recommended step before this module is relied upon
// alone in ACTIVE mode -- see this round's own final report's "known
// limitations".
export type ParsedStreamEvent =
  | { kind: "result"; success: boolean; subtype: string | null; sessionId: string | null }
  | { kind: "api_retry"; detail: string }
  | { kind: "other"; raw: unknown }
  | { kind: "unparseable"; raw: string };

export function parseStreamJsonLine(line: string): ParsedStreamEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "unparseable", raw: trimmed };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "other", raw: parsed };
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.type === "result") {
    const subtype = typeof obj.subtype === "string" ? obj.subtype : null;
    return {
      kind: "result",
      success: subtype === "success",
      subtype,
      sessionId: typeof obj.session_id === "string" ? obj.session_id : null,
    };
  }

  if (obj.type === "system" && obj.subtype === "api_retry") {
    return { kind: "api_retry", detail: JSON.stringify(obj) };
  }

  return { kind: "other", raw: parsed };
}

export interface ExecutorOutcome {
  status: "completed_success" | "completed_error" | "incomplete";
  detail: string;
  sessionId: string | null;
  apiRetryCount: number;
}

// Reduces a full sequence of parsed events (everything observed on
// stdout for one launch/resume attempt) to a single verdict. A `result`
// event with subtype "success" is the ONLY way to reach
// "completed_success" -- its absence (the process exited without one,
// e.g. because the transport dropped mid-response) is "incomplete", by
// construction, never confused with a clean failure the executor itself
// reported (that would BE a `result` event, just with a non-"success"
// subtype -- "completed_error").
export function reduceExecutorOutcome(events: readonly ParsedStreamEvent[]): ExecutorOutcome {
  let apiRetryCount = 0;
  let sessionId: string | null = null;

  for (const event of events) {
    if (event.kind === "api_retry") apiRetryCount += 1;
    if (event.kind === "result" && event.sessionId) sessionId = event.sessionId;
  }

  const lastResult = [...events].reverse().find((event): event is Extract<ParsedStreamEvent, { kind: "result" }> => event.kind === "result");

  if (!lastResult) {
    return { status: "incomplete", detail: "no result event observed before the process ended", sessionId, apiRetryCount };
  }
  if (lastResult.success) {
    return { status: "completed_success", detail: "result event with subtype success", sessionId, apiRetryCount };
  }
  return { status: "completed_error", detail: `result event with subtype ${lastResult.subtype ?? "unknown"}`, sessionId, apiRetryCount };
}
