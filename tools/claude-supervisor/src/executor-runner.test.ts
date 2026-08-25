import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { observeExecutorProcess, type ObservableExecutorProcess } from "./executor-runner.js";

// A fake child process double -- real EventEmitters for stdout/stderr,
// same shape a real ChildProcessByStdio<null, Readable, Readable>
// presents. This is what makes observeExecutorProcess's real buffering/
// parsing logic testable without ever spawning a real OS process.
function createFakeChild(): { child: ObservableExecutorProcess; stdout: EventEmitter; stderr: EventEmitter } {
  const child = new EventEmitter() as ObservableExecutorProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  child.stdout = stdout as unknown as ObservableExecutorProcess["stdout"];
  child.stderr = stderr as unknown as ObservableExecutorProcess["stderr"];
  return { child, stdout, stderr };
}

describe("observeExecutorProcess", () => {
  it("parses a single complete line delivered in one data event", async () => {
    const { child, stdout } = createFakeChild();
    const promise = observeExecutorProcess(child);
    stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", session_id: "abc", is_error: false, api_error_status: null }) + "\n"));
    child.emit("close", 0);
    const outcome = await promise;
    expect(outcome.status).toBe("completed_success");
    expect(outcome.sessionId).toBe("abc");
  });

  // The real live smoke test delivered 12 real events across however
  // many actual OS-level chunks Node's pipe happened to buffer -- this
  // proves the buffering logic reassembles a line even when a single
  // JSON object arrives split across two `data` events.
  it("reassembles one JSON line split across multiple data chunks", async () => {
    const { child, stdout } = createFakeChild();
    const promise = observeExecutorProcess(child);
    const line = JSON.stringify({ type: "result", subtype: "success", session_id: "abc", is_error: false, api_error_status: null });
    stdout.emit("data", line.slice(0, 10));
    stdout.emit("data", line.slice(10) + "\n");
    child.emit("close", 0);
    const outcome = await promise;
    expect(outcome.status).toBe("completed_success");
  });

  it("handles multiple lines delivered in one data event", async () => {
    const { child, stdout } = createFakeChild();
    const promise = observeExecutorProcess(child);
    const line1 = JSON.stringify({ type: "system", subtype: "init", session_id: "abc", cwd: "/repo", permissionMode: "acceptEdits" });
    const line2 = JSON.stringify({ type: "result", subtype: "success", session_id: "abc", is_error: false, api_error_status: null });
    stdout.emit("data", `${line1}\n${line2}\n`);
    child.emit("close", 0);
    const outcome = await promise;
    expect(outcome.status).toBe("completed_success");
    expect(outcome.sessionId).toBe("abc");
  });

  it("flushes a trailing line with no terminating newline once the process closes", async () => {
    const { child, stdout } = createFakeChild();
    const promise = observeExecutorProcess(child);
    stdout.emit("data", JSON.stringify({ type: "result", subtype: "success", session_id: "abc", is_error: false, api_error_status: null }));
    child.emit("close", 0);
    const outcome = await promise;
    expect(outcome.status).toBe("completed_success");
  });

  // Test requirement: "successful launch parsing" against something
  // shaped exactly like the REAL captured live stream.
  it("reduces a realistic multi-line stream (init + noise + assistant + result) to completed_success", async () => {
    const { child, stdout } = createFakeChild();
    const promise = observeExecutorProcess(child);
    const lines = [
      { type: "system", subtype: "init", session_id: "real-id", cwd: "/repo", permissionMode: "acceptEdits" },
      { type: "system", subtype: "status", status: "requesting" },
      { type: "rate_limit_event", rate_limit_info: { status: "allowed" } },
      { type: "assistant", message: { content: [{ type: "text", text: "OK" }] }, session_id: "real-id" },
      { is_error: false, subtype: "success", session_id: "real-id", api_error_status: null, type: "result" },
    ];
    stdout.emit("data", lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    child.emit("close", 0);
    const outcome = await promise;
    expect(outcome.status).toBe("completed_success");
    expect(outcome.sessionId).toBe("real-id");
  });

  // Test requirement: "executor API interruption" -- the process closes
  // with no result event at all (the exact "API Error, response stopped
  // arriving" case this whole package exists for).
  it("reports incomplete when the process closes with no result event", async () => {
    const { child, stdout } = createFakeChild();
    const promise = observeExecutorProcess(child);
    stdout.emit("data", JSON.stringify({ type: "system", subtype: "init", session_id: "abc", cwd: "/repo", permissionMode: "acceptEdits" }) + "\n");
    child.emit("close", null);
    const outcome = await promise;
    expect(outcome.status).toBe("incomplete");
    expect(outcome.sessionId).toBe("abc");
  });

  // Test requirement: "stderr-only failure" -- the real binary crashed
  // before producing a single valid stdout line (this round's own first
  // failed attempt: "Error: When using --print, --output-format=
  // stream-json requires --verbose").
  it("reports incomplete with the real stderr text when the process produced zero stdout events", async () => {
    const { child, stderr } = createFakeChild();
    const promise = observeExecutorProcess(child);
    stderr.emit("data", "Error: When using --print, --output-format=stream-json requires --verbose\n");
    child.emit("close", 1);
    const outcome = await promise;
    expect(outcome.status).toBe("incomplete");
    expect(outcome.detail).toContain("requires --verbose");
  });

  // Test requirement: "non-zero exit".
  it("reports incomplete with the real non-zero exit code annotated", async () => {
    const { child } = createFakeChild();
    const promise = observeExecutorProcess(child);
    child.emit("close", 134);
    const outcome = await promise;
    expect(outcome.status).toBe("incomplete");
    expect(outcome.detail).toContain("non-zero code 134");
  });

  it("classifies a malformed trailing line as unparseable without crashing", async () => {
    const { child, stdout } = createFakeChild();
    const promise = observeExecutorProcess(child);
    stdout.emit("data", "{not valid json");
    child.emit("close", 0);
    const outcome = await promise;
    expect(outcome.status).toBe("incomplete");
  });
});
