import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { reduceSdkOutcome } from "./agent-sdk-events.js";

// Minimal fakes carrying only the fields reduceSdkOutcome actually
// reads -- see this module's own doc comment: no mocking library is
// used anywhere in this package's tests, and a full, every-required-
// field SDKSystemMessage/SDKResultMessage fake would be hundreds of
// lines of noise unrelated to what's under test here.
function fakeInit(sessionId: string): SDKMessage {
  return { type: "system", subtype: "init", session_id: sessionId } as unknown as SDKMessage;
}
function fakeApiRetry(sessionId: string): SDKMessage {
  return { type: "system", subtype: "api_retry", session_id: sessionId } as unknown as SDKMessage;
}
function fakePermissionDenied(sessionId: string, toolName: string): SDKMessage {
  return { type: "system", subtype: "permission_denied", session_id: sessionId, tool_name: toolName } as unknown as SDKMessage;
}
function fakeResult(sessionId: string, subtype: string, permissionDenialCount = 0): SDKMessage {
  return {
    type: "result",
    subtype,
    session_id: sessionId,
    permission_denials: Array.from({ length: permissionDenialCount }, () => ({ tool_name: "Bash", tool_use_id: "x", tool_input: {} })),
  } as unknown as SDKMessage;
}

describe("reduceSdkOutcome -- success", () => {
  it("maps a success result to completed_success / outcomeKind success", () => {
    const outcome = reduceSdkOutcome({ messages: [fakeInit("s1"), fakeResult("s1", "success")], transportError: null, wasCancelled: false });
    expect(outcome.status).toBe("completed_success");
    expect(outcome.outcomeKind).toBe("success");
    expect(outcome.sessionId).toBe("s1");
  });

  it("takes the result message's own session_id over an earlier init's, if they ever differ", () => {
    const outcome = reduceSdkOutcome({ messages: [fakeInit("s1"), fakeResult("s2", "success")], transportError: null, wasCancelled: false });
    expect(outcome.sessionId).toBe("s2");
  });

  it("counts api_retry messages", () => {
    const outcome = reduceSdkOutcome({ messages: [fakeInit("s1"), fakeApiRetry("s1"), fakeApiRetry("s1"), fakeResult("s1", "success")], transportError: null, wasCancelled: false });
    expect(outcome.apiRetryCount).toBe(2);
  });
});

describe("reduceSdkOutcome -- executor/tool error (a real result event, never confused with a dropped transport)", () => {
  it.each(["error_during_execution", "error_max_turns", "error_max_budget_usd", "error_max_structured_output_retries"])("maps result subtype %s to completed_error", (subtype) => {
    const outcome = reduceSdkOutcome({ messages: [fakeInit("s1"), fakeResult("s1", subtype)], transportError: null, wasCancelled: false });
    expect(outcome.status).toBe("completed_error");
    expect(outcome.outcomeKind).toBe("executor_error");
    expect(outcome.detail).toContain(subtype);
  });
});

describe("reduceSdkOutcome -- incomplete (no result message ever observed)", () => {
  it("maps a caught transport exception with no result to incomplete / transport_error, folding the exception text into detail", () => {
    const outcome = reduceSdkOutcome({ messages: [fakeInit("s1")], transportError: "socket hang up", wasCancelled: false });
    expect(outcome.status).toBe("incomplete");
    expect(outcome.outcomeKind).toBe("transport_error");
    expect(outcome.detail).toContain("socket hang up");
  });

  it("maps a stream that just ended with nothing else observed to incomplete / malformed", () => {
    const outcome = reduceSdkOutcome({ messages: [fakeInit("s1")], transportError: null, wasCancelled: false });
    expect(outcome.status).toBe("incomplete");
    expect(outcome.outcomeKind).toBe("malformed");
  });

  it("maps a run that only ever produced permission denials before dropping to incomplete / permission_denied_only", () => {
    const outcome = reduceSdkOutcome({ messages: [fakeInit("s1"), fakePermissionDenied("s1", "Bash")], transportError: null, wasCancelled: false });
    expect(outcome.status).toBe("incomplete");
    expect(outcome.outcomeKind).toBe("permission_denied_only");
    expect(outcome.permissionDenialCount).toBe(1);
  });

  it("maps a deliberate cancellation to incomplete / cancelled, taking priority over whatever else was observed", () => {
    const outcome = reduceSdkOutcome({ messages: [fakeInit("s1"), fakeResult("s1", "success")], transportError: null, wasCancelled: true });
    expect(outcome.status).toBe("incomplete");
    expect(outcome.outcomeKind).toBe("cancelled");
  });
});

describe("reduceSdkOutcome -- permission_denials visibility", () => {
  it("carries the result message's own permission_denials count through, for Phase 7 diagnostic visibility", () => {
    const outcome = reduceSdkOutcome({ messages: [fakeInit("s1"), fakeResult("s1", "success", 2)], transportError: null, wasCancelled: false });
    expect(outcome.permissionDenialCount).toBe(2);
  });
});
