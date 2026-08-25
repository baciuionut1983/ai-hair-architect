// Parsing for Claude Code's `--output-format stream-json` protocol --
// newline-delimited JSON, one event object per line.
//
// UPDATE (Supervisor v1.1, Phase 2/3 live smoke test): the schema below
// was CONFIRMED against a real live stream -- a real `claude.exe -p
// "Respond with exactly OK and do nothing else." --session-id <uuid>
// --output-format stream-json --verbose --include-partial-messages
// --permission-mode acceptEdits` launch, real exit code 0, 12 real
// stdout lines captured and inspected line by line. Real event types
// observed, in order: `system`/`init` (once, first line -- carries
// session_id/cwd/permissionMode, letting the Supervisor independently
// verify the child actually launched with the requested identity rather
// than trusting its own argv), `system`/`status`, `rate_limit_event`,
// several `stream_event`-wrapped partial deltas (from
// --include-partial-messages -- message_start/content_block_*/
// message_delta/message_stop), one `assistant` (the full final message),
// and exactly one `result` (always last). The PRE-EXISTING "result" logic
// below (`obj.type === "result"`, `subtype === "success"`,
// `session_id`) was verified CORRECT as originally written -- the real
// event matched the guessed shape exactly. `system`/status,
// `rate_limit_event`, and the partial `stream_event` deltas are real,
// legitimate, high-frequency noise that carries no information this
// Supervisor's decision-making needs; they correctly fall through to
// "other" below, same as before, and are NOT enumerated further --
// enumerating them would be schema-tracking for its own sake, not a
// need any decide-next-action.ts logic has.
//
// Every function below remains DELIBERATELY lenient: an unrecognized or
// malformed line degrades to "other"/"unparseable" rather than throwing,
// so a still-unobserved real event shape can never crash the Supervisor
// -- it can only make outcome detection less precise, which
// orchestrator.ts's own process-exit-code check (a completely
// independent, structurally guaranteed signal) backs up regardless.
export type ParsedStreamEvent =
  | { kind: "init"; sessionId: string | null; cwd: string | null; permissionMode: string | null }
  | { kind: "assistant_message"; text: string; sessionId: string | null }
  | { kind: "result"; success: boolean; subtype: string | null; sessionId: string | null; isError: boolean | null; apiErrorStatus: string | null }
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

  if (obj.type === "system" && obj.subtype === "init") {
    return {
      kind: "init",
      sessionId: typeof obj.session_id === "string" ? obj.session_id : null,
      cwd: typeof obj.cwd === "string" ? obj.cwd : null,
      permissionMode: typeof obj.permissionMode === "string" ? obj.permissionMode : null,
    };
  }

  if (obj.type === "assistant" && typeof obj.message === "object" && obj.message !== null) {
    const message = obj.message as Record<string, unknown>;
    const content = Array.isArray(message.content) ? message.content : [];
    const text = content
      .filter((block): block is { type: string; text: string } => typeof block === "object" && block !== null && (block as Record<string, unknown>).type === "text")
      .map((block) => block.text)
      .join("");
    return {
      kind: "assistant_message",
      text,
      sessionId: typeof obj.session_id === "string" ? obj.session_id : null,
    };
  }

  if (obj.type === "result") {
    const subtype = typeof obj.subtype === "string" ? obj.subtype : null;
    return {
      kind: "result",
      success: subtype === "success",
      subtype,
      sessionId: typeof obj.session_id === "string" ? obj.session_id : null,
      isError: typeof obj.is_error === "boolean" ? obj.is_error : null,
      apiErrorStatus: typeof obj.api_error_status === "string" ? obj.api_error_status : null,
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
    // `init` arrives first in a real stream and already carries the
    // session id the child actually launched with (an independent
    // confirmation the Supervisor can check against the id it requested
    // -- see claude-cli.ts's own --session-id pre-assignment); `result`
    // arrives last and repeats the same id in every real launch observed
    // so far, so it is allowed to overwrite with the same value, never a
    // different one, unless a future real stream proves otherwise.
    if (event.kind === "init" && event.sessionId) sessionId = event.sessionId;
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

export interface ProcessExitInfo {
  exitCode: number | null;
  stderrText: string;
}

// Combines the stream-based verdict with the two INDEPENDENT, structurally
// guaranteed signals the OS itself provides (exit code, stderr) -- see
// claude-cli.ts's own top-level doc comment: reduceExecutorOutcome alone
// can only ever say "incomplete" when no result event arrived, but it has
// no way to say WHY. This function never changes the underlying success/
// error/incomplete verdict (that remains ENTIRELY the stream's own,
// per reduceExecutorOutcome's own contract) -- it only enriches the
// "incomplete" case's `detail` with the two other signals, covering the
// real failure shapes a live process can produce: a crash before
// producing any stdout at all (stderr-only failure, zero events), and a
// non-zero exit that stream parsing alone would otherwise render
// indistinguishable from "the transport simply stopped".
export function combineExecutorResult(events: readonly ParsedStreamEvent[], exitInfo: ProcessExitInfo): ExecutorOutcome {
  const outcome = reduceExecutorOutcome(events);
  if (outcome.status !== "incomplete") return outcome;

  const details: string[] = [outcome.detail];
  if (events.length === 0 && exitInfo.stderrText.trim().length > 0) {
    details.push(`stderr-only failure: ${exitInfo.stderrText.trim().slice(0, 500)}`);
  }
  if (exitInfo.exitCode !== null && exitInfo.exitCode !== 0) {
    details.push(`process exited with non-zero code ${exitInfo.exitCode}`);
  }
  if (details.length === 1) return outcome;
  return { ...outcome, detail: details.join("; ") };
}

// A resume is only meaningful if the CLI actually continued the SAME
// session it was asked to -- see this round's own task spec's Phase 4:
// "Verify... same logical session is continued... no new uncontrolled
// executor/session is created." If the observed outcome's own sessionId
// (from a real `init`/`result` event, never from argv the Supervisor
// itself constructed) differs from the id the Supervisor asked to
// resume, that is a real, independent red flag -- silently proceeding
// as if the resume succeeded would be exactly the kind of blind trust
// this whole package's TECHNICAL REVIEWER role exists to prevent.
export function verifySessionIdMatches(expectedSessionId: string, outcome: ExecutorOutcome): boolean {
  return outcome.sessionId !== null && outcome.sessionId === expectedSessionId;
}
