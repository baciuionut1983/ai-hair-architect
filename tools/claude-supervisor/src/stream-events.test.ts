import { describe, expect, it } from "vitest";

import { combineExecutorResult, parseStreamJsonLine, reduceExecutorOutcome, verifySessionIdMatches } from "./stream-events.js";

// The REAL 12 lines captured during Supervisor v1.1's own Phase 2/3 live
// smoke test: `claude.exe -p "Respond with exactly OK and do nothing
// else." --session-id 00000000-0000-4000-8000-000000000001
// --output-format stream-json --verbose --include-partial-messages
// --permission-mode acceptEdits`, real exit code 0. Trimmed to the
// fields parseStreamJsonLine actually reads (the real `init` event also
// carries large tools/skills/agents arrays this parser never inspects --
// omitted here for readability, not because the real event lacked them).
const REAL_SESSION_ID = "00000000-0000-4000-8000-000000000001";
const REAL_INIT_LINE = JSON.stringify({
  type: "system",
  subtype: "init",
  cwd: "C:\\scratch\\supervisor-smoke",
  session_id: REAL_SESSION_ID,
  permissionMode: "acceptEdits",
  claude_code_version: "2.1.241",
});
const REAL_STATUS_LINE = JSON.stringify({ type: "system", subtype: "status", status: "requesting", session_id: REAL_SESSION_ID });
const REAL_RATE_LIMIT_LINE = JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed" }, session_id: REAL_SESSION_ID });
const REAL_PARTIAL_DELTA_LINE = JSON.stringify({
  type: "stream_event",
  event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "O" } },
  session_id: REAL_SESSION_ID,
});
const REAL_ASSISTANT_LINE = JSON.stringify({
  type: "assistant",
  message: { model: "claude-sonnet-5", role: "assistant", content: [{ type: "text", text: "OK" }] },
  session_id: REAL_SESSION_ID,
});
const REAL_RESULT_LINE = JSON.stringify({
  is_error: false,
  subtype: "success",
  session_id: REAL_SESSION_ID,
  api_error_status: null,
  result: "OK",
  type: "result",
  duration_ms: 4164,
});
const REAL_STREAM_LINES = [
  REAL_INIT_LINE,
  REAL_STATUS_LINE,
  REAL_RATE_LIMIT_LINE,
  REAL_PARTIAL_DELTA_LINE,
  REAL_ASSISTANT_LINE,
  REAL_PARTIAL_DELTA_LINE,
  REAL_RESULT_LINE,
];

describe("parseStreamJsonLine", () => {
  it("returns null for a blank line", () => {
    expect(parseStreamJsonLine("")).toBeNull();
    expect(parseStreamJsonLine("   ")).toBeNull();
  });

  it("parses a result/success event, including the real is_error/api_error_status fields", () => {
    const event = parseStreamJsonLine(JSON.stringify({ type: "result", subtype: "success", session_id: "abc-123", is_error: false, api_error_status: null }));
    expect(event).toEqual({ kind: "result", success: true, subtype: "success", sessionId: "abc-123", isError: false, apiErrorStatus: null });
  });

  it("parses a result event with a non-success subtype as success:false", () => {
    const event = parseStreamJsonLine(JSON.stringify({ type: "result", subtype: "error_max_turns", session_id: "abc-123", is_error: true, api_error_status: "overloaded" }));
    expect(event).toEqual({ kind: "result", success: false, subtype: "error_max_turns", sessionId: "abc-123", isError: true, apiErrorStatus: "overloaded" });
  });

  it("parses a system/api_retry event", () => {
    const event = parseStreamJsonLine(JSON.stringify({ type: "system", subtype: "api_retry", attempt: 1 }));
    expect(event?.kind).toBe("api_retry");
  });

  // Real event, real shape, confirmed via this round's own live smoke
  // test -- session_id/cwd/permissionMode let the Supervisor
  // independently confirm the child actually launched with the identity
  // it requested.
  it("parses the REAL system/init event shape observed live", () => {
    const event = parseStreamJsonLine(REAL_INIT_LINE);
    expect(event).toEqual({ kind: "init", sessionId: REAL_SESSION_ID, cwd: "C:\\scratch\\supervisor-smoke", permissionMode: "acceptEdits" });
  });

  it("parses the REAL assistant message event shape observed live, extracting text content", () => {
    const event = parseStreamJsonLine(REAL_ASSISTANT_LINE);
    expect(event).toEqual({ kind: "assistant_message", text: "OK", sessionId: REAL_SESSION_ID });
  });

  it("classifies the real system/status event as 'other' -- legitimate noise, not decision-relevant", () => {
    expect(parseStreamJsonLine(REAL_STATUS_LINE)?.kind).toBe("other");
  });

  it("classifies the real rate_limit_event as 'other' -- legitimate noise, not decision-relevant", () => {
    expect(parseStreamJsonLine(REAL_RATE_LIMIT_LINE)?.kind).toBe("other");
  });

  it("classifies a real partial stream_event delta as 'other' -- legitimate noise from --include-partial-messages", () => {
    expect(parseStreamJsonLine(REAL_PARTIAL_DELTA_LINE)?.kind).toBe("other");
  });

  it("classifies an unrecognized-but-valid JSON object as 'other', never throwing", () => {
    const event = parseStreamJsonLine(JSON.stringify({ type: "something_never_seen", text: "hello" }));
    expect(event?.kind).toBe("other");
  });

  it("classifies a malformed JSON line as 'unparseable', never throwing", () => {
    const event = parseStreamJsonLine("{not valid json");
    expect(event).toEqual({ kind: "unparseable", raw: "{not valid json" });
  });

  it("classifies a valid-JSON-but-non-object line (e.g. a bare number) as 'other'", () => {
    const event = parseStreamJsonLine("42");
    expect(event).toEqual({ kind: "other", raw: 42 });
  });
});

describe("reduceExecutorOutcome", () => {
  it("returns completed_success when the LAST result event has subtype success", () => {
    const outcome = reduceExecutorOutcome([
      { kind: "other", raw: {} },
      { kind: "result", success: true, subtype: "success", sessionId: "abc-123", isError: false, apiErrorStatus: null },
    ]);
    expect(outcome.status).toBe("completed_success");
    expect(outcome.sessionId).toBe("abc-123");
  });

  it("returns completed_error when the last result event is a real, reported failure -- not confused with incomplete", () => {
    const outcome = reduceExecutorOutcome([{ kind: "result", success: false, subtype: "error_max_turns", sessionId: "abc-123", isError: true, apiErrorStatus: null }]);
    expect(outcome.status).toBe("completed_error");
    expect(outcome.detail).toContain("error_max_turns");
  });

  // The core "API Error: the response stopped arriving" case this whole
  // package exists for: no result event was ever produced at all.
  it("returns incomplete when no result event was ever observed -- the exact transport-interruption case", () => {
    const outcome = reduceExecutorOutcome([
      { kind: "other", raw: {} },
      { kind: "api_retry", detail: "..." },
    ]);
    expect(outcome.status).toBe("incomplete");
  });

  it("returns incomplete for a genuinely empty event list", () => {
    expect(reduceExecutorOutcome([]).status).toBe("incomplete");
  });

  it("counts every api_retry event observed, for degrading-network diagnostics", () => {
    const outcome = reduceExecutorOutcome([
      { kind: "api_retry", detail: "1" },
      { kind: "api_retry", detail: "2" },
      { kind: "result", success: true, subtype: "success", sessionId: "abc-123", isError: false, apiErrorStatus: null },
    ]);
    expect(outcome.apiRetryCount).toBe(2);
  });

  it("uses the LAST result event when multiple somehow appear, never the first", () => {
    const outcome = reduceExecutorOutcome([
      { kind: "result", success: false, subtype: "error_max_turns", sessionId: "abc-123", isError: true, apiErrorStatus: null },
      { kind: "result", success: true, subtype: "success", sessionId: "abc-123", isError: false, apiErrorStatus: null },
    ]);
    expect(outcome.status).toBe("completed_success");
  });

  it("picks up the session id from an early init event even before any result event arrives", () => {
    const outcome = reduceExecutorOutcome([{ kind: "init", sessionId: "abc-123", cwd: "/repo", permissionMode: "acceptEdits" }]);
    expect(outcome.sessionId).toBe("abc-123");
    expect(outcome.status).toBe("incomplete");
  });

  // End-to-end proof against the REAL captured live stream, parsed line
  // by line exactly as orchestrator.ts's own executor-runner will.
  it("reduces the REAL captured live stream (12 real lines) to completed_success", () => {
    const events = REAL_STREAM_LINES.map((line) => parseStreamJsonLine(line)).filter((event) => event !== null);
    const outcome = reduceExecutorOutcome(events);
    expect(outcome.status).toBe("completed_success");
    expect(outcome.sessionId).toBe(REAL_SESSION_ID);
    expect(outcome.apiRetryCount).toBe(0);
  });
});

describe("combineExecutorResult", () => {
  it("leaves a completed_success outcome untouched -- exit code/stderr never override a real result event", () => {
    const events: Parameters<typeof reduceExecutorOutcome>[0] = [{ kind: "result", success: true, subtype: "success", sessionId: "abc", isError: false, apiErrorStatus: null }];
    const outcome = combineExecutorResult(events, { exitCode: 0, stderrText: "" });
    expect(outcome.status).toBe("completed_success");
  });

  // Test requirement: "stderr-only failure" -- the process crashed
  // before ever producing a single parseable stdout line.
  it("annotates an incomplete outcome with the real stderr text when zero events were observed", () => {
    const outcome = combineExecutorResult([], { exitCode: 1, stderrText: "Error: When using --print, --output-format=stream-json requires --verbose" });
    expect(outcome.status).toBe("incomplete");
    expect(outcome.detail).toContain("stderr-only failure");
    expect(outcome.detail).toContain("requires --verbose");
  });

  // Test requirement: "non-zero exit" correlated with an incomplete
  // stream verdict.
  it("annotates an incomplete outcome with a non-zero exit code", () => {
    const outcome = combineExecutorResult([{ kind: "other", raw: {} }], { exitCode: 137, stderrText: "" });
    expect(outcome.status).toBe("incomplete");
    expect(outcome.detail).toContain("non-zero code 137");
  });

  it("does not mention exit code when the process exited 0 but was still incomplete", () => {
    const outcome = combineExecutorResult([], { exitCode: 0, stderrText: "" });
    expect(outcome.detail).not.toContain("non-zero code");
    expect(outcome.detail).not.toContain("stderr-only");
  });
});

describe("verifySessionIdMatches", () => {
  it("confirms a match when the observed outcome's sessionId equals the expected one", () => {
    const outcome = reduceExecutorOutcome([{ kind: "result", success: true, subtype: "success", sessionId: "expected-id", isError: false, apiErrorStatus: null }]);
    expect(verifySessionIdMatches("expected-id", outcome)).toBe(true);
  });

  // Test requirement: "resume session mismatch" -- a resume that
  // silently produced a DIFFERENT session id must never be treated as a
  // successful resume of the requested session.
  it("flags a mismatch when the observed session id differs from what was requested", () => {
    const outcome = reduceExecutorOutcome([{ kind: "result", success: true, subtype: "success", sessionId: "some-other-id", isError: false, apiErrorStatus: null }]);
    expect(verifySessionIdMatches("expected-id", outcome)).toBe(false);
  });

  it("flags a mismatch when no session id was observed at all", () => {
    const outcome = reduceExecutorOutcome([]);
    expect(verifySessionIdMatches("expected-id", outcome)).toBe(false);
  });
});
