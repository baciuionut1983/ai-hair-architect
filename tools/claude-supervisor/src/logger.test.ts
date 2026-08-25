import { describe, expect, it, vi } from "vitest";

import { formatLogEntry, logSupervisorEvent, redact } from "./logger.js";
import type { SupervisorLogEntry } from "./types.js";

function entry(overrides: Partial<SupervisorLogEntry> = {}): SupervisorLogEntry {
  return {
    taskId: "task-1",
    state: "EXECUTOR_RUNNING",
    executorSession: "11111111-1111-1111-1111-111111111111",
    action: "launched executor",
    result: "ok",
    timestamp: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("redact", () => {
  it("redacts an Anthropic-style API key", () => {
    expect(redact("using key sk-ant-abcdef1234567890")).toBe("using key [REDACTED]");
  });

  it("redacts a GitHub personal access token", () => {
    expect(redact("token=ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toContain("[REDACTED]");
  });

  it("redacts an AWS access key id", () => {
    expect(redact("AKIAABCDEFGHIJKLMNOP")).toBe("[REDACTED]");
  });

  it("redacts a Bearer authorization header value", () => {
    expect(redact("Authorization: Bearer abcdef123456.xyz789")).toContain("[REDACTED]");
  });

  it("redacts a generic key=value secret-shaped assignment", () => {
    expect(redact('DATABASE_PASSWORD="hunter2superSecret"')).toContain("[REDACTED]");
  });

  it("leaves genuinely non-secret text untouched", () => {
    const text = "3556 tests passed, 0 failed, commit abc1234 pushed to origin/master";
    expect(redact(text)).toBe(text);
  });
});

describe("formatLogEntry", () => {
  it("includes every required field in the [SUPERVISOR] line", () => {
    const line = formatLogEntry(entry());
    expect(line).toContain("[SUPERVISOR]");
    expect(line).toContain("taskId=task-1");
    expect(line).toContain("state=EXECUTOR_RUNNING");
    expect(line).toContain("executorSession=11111111-1111-1111-1111-111111111111");
    expect(line).toContain("action=launched executor");
    expect(line).toContain("result=ok");
  });

  it("shows 'none' for a null executor session rather than the literal string 'null'", () => {
    const line = formatLogEntry(entry({ executorSession: null }));
    expect(line).toContain("executorSession=none");
    expect(line).not.toContain("executorSession=null");
  });

  it("redacts a secret that leaked into the free-text action/result fields", () => {
    const line = formatLogEntry(entry({ action: "ran command with sk-ant-leakedsecret1234", result: "AKIAABCDEFGHIJKLMNOP found" }));
    expect(line).not.toContain("sk-ant-leakedsecret1234");
    expect(line).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(line).toContain("[REDACTED]");
  });
});

describe("logSupervisorEvent", () => {
  it("calls the injected sink exactly once with the formatted line, never console.log directly in a test", () => {
    const sink = vi.fn();
    logSupervisorEvent(entry(), sink);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toContain("[SUPERVISOR]");
  });
});
