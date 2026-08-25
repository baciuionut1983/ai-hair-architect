import { describe, expect, it } from "vitest";

import { parseStreamJsonLine, reduceExecutorOutcome } from "./stream-events.js";

describe("parseStreamJsonLine", () => {
  it("returns null for a blank line", () => {
    expect(parseStreamJsonLine("")).toBeNull();
    expect(parseStreamJsonLine("   ")).toBeNull();
  });

  it("parses a result/success event", () => {
    const event = parseStreamJsonLine(JSON.stringify({ type: "result", subtype: "success", session_id: "abc-123" }));
    expect(event).toEqual({ kind: "result", success: true, subtype: "success", sessionId: "abc-123" });
  });

  it("parses a result event with a non-success subtype as success:false", () => {
    const event = parseStreamJsonLine(JSON.stringify({ type: "result", subtype: "error_max_turns", session_id: "abc-123" }));
    expect(event).toEqual({ kind: "result", success: false, subtype: "error_max_turns", sessionId: "abc-123" });
  });

  it("parses a system/api_retry event", () => {
    const event = parseStreamJsonLine(JSON.stringify({ type: "system", subtype: "api_retry", attempt: 1 }));
    expect(event?.kind).toBe("api_retry");
  });

  it("classifies an unrecognized-but-valid JSON object as 'other', never throwing", () => {
    const event = parseStreamJsonLine(JSON.stringify({ type: "assistant", text: "hello" }));
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
      { kind: "result", success: true, subtype: "success", sessionId: "abc-123" },
    ]);
    expect(outcome.status).toBe("completed_success");
    expect(outcome.sessionId).toBe("abc-123");
  });

  it("returns completed_error when the last result event is a real, reported failure -- not confused with incomplete", () => {
    const outcome = reduceExecutorOutcome([{ kind: "result", success: false, subtype: "error_max_turns", sessionId: "abc-123" }]);
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
      { kind: "result", success: true, subtype: "success", sessionId: "abc-123" },
    ]);
    expect(outcome.apiRetryCount).toBe(2);
  });

  it("uses the LAST result event when multiple somehow appear, never the first", () => {
    const outcome = reduceExecutorOutcome([
      { kind: "result", success: false, subtype: "error_max_turns", sessionId: "abc-123" },
      { kind: "result", success: true, subtype: "success", sessionId: "abc-123" },
    ]);
    expect(outcome.status).toBe("completed_success");
  });
});
