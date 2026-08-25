import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initialRunState, loadRunStateFromDisk, runStateFilePath, saveRunStateToDisk, serializeRunState } from "./persistence.js";
import type { SupervisorRunState } from "./types.js";

describe("serializeRunState", () => {
  it("only ever includes the fixed, known-safe field set -- never an unexpected extra key", () => {
    const state = initialRunState("task-1", () => "2026-08-25T00:00:00.000Z");
    const json = JSON.parse(serializeRunState(state)) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(
      [
        "taskId",
        "state",
        "executorSessionId",
        "restartCount",
        "correctionCount",
        "recentCorrectionFingerprints",
        "lastKnownHeadSha",
        "lastDiffSummary",
        "createdAt",
        "updatedAt",
        "lastAction",
      ].sort(),
    );
  });

  // The explicit "never store secrets" contract -- even if a caller
  // somehow constructed a state object with an extra field (e.g. by
  // spreading in something it shouldn't have), serializeRunState's own
  // fixed allow-list means it can never reach disk.
  it("never persists a field outside the fixed allow-list, even if present on the input object", () => {
    const state = initialRunState("task-1") as SupervisorRunState & { apiKey?: string; secret?: string };
    state.apiKey = "sk-should-never-be-written";
    state.secret = "also-should-never-be-written";
    const json = serializeRunState(state);
    expect(json).not.toContain("sk-should-never-be-written");
    expect(json).not.toContain("also-should-never-be-written");
  });
});

describe("runStateFilePath", () => {
  it("builds a predictable path from stateDir and taskId", () => {
    expect(runStateFilePath("/tmp/state", "task-1")).toBe("/tmp/state/task-1.json");
  });

  it("sanitizes a taskId containing path-unsafe characters", () => {
    expect(runStateFilePath("/tmp/state", "task/../../etc")).toBe("/tmp/state/task_______etc.json");
  });
});

describe("saveRunStateToDisk / loadRunStateFromDisk round-trip", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "claude-supervisor-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes and reads back an identical state", () => {
    const path = runStateFilePath(dir, "task-1");
    const state = initialRunState("task-1", () => "2026-08-25T00:00:00.000Z");
    saveRunStateToDisk(path, state);

    const result = loadRunStateFromDisk(path);
    expect(result.ok).toBe(true);
    expect(result.state).toEqual(state);
  });

  it("creates the state directory if it does not exist yet", () => {
    const nestedPath = runStateFilePath(join(dir, "nested", "deeper"), "task-1");
    const state = initialRunState("task-1");
    expect(() => saveRunStateToDisk(nestedPath, state)).not.toThrow();
    expect(loadRunStateFromDisk(nestedPath).ok).toBe(true);
  });

  it("survives a 'supervisor restart' -- loading a state saved by a previous, separate process", () => {
    const path = runStateFilePath(dir, "task-1");
    const state = initialRunState("task-1", () => "2026-08-25T00:00:00.000Z");
    state.state = "EXECUTOR_RUNNING";
    state.executorSessionId = "11111111-1111-1111-1111-111111111111";
    state.restartCount = 1;
    saveRunStateToDisk(path, state);

    // Simulate a fresh process: no in-memory state at all, only the path.
    const recovered = loadRunStateFromDisk(path);
    expect(recovered.ok).toBe(true);
    expect(recovered.state?.state).toBe("EXECUTOR_RUNNING");
    expect(recovered.state?.executorSessionId).toBe("11111111-1111-1111-1111-111111111111");
    expect(recovered.state?.restartCount).toBe(1);
  });

  it("reports a clear failure reason for a missing file, never throwing", () => {
    const result = loadRunStateFromDisk(join(dir, "does-not-exist.json"));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("read_failed");
  });

  it("reports a clear failure reason for malformed JSON", () => {
    const path = join(dir, "broken.json");
    writeFileSync(path, "{not valid json", "utf8");
    const result = loadRunStateFromDisk(path);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("parse_failed");
  });

  it("reports a clear failure reason for a well-formed JSON object missing a required field", () => {
    const path = join(dir, "incomplete.json");
    writeFileSync(path, JSON.stringify({ taskId: "task-1" }), "utf8");
    const result = loadRunStateFromDisk(path);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("missing_field");
  });
});
