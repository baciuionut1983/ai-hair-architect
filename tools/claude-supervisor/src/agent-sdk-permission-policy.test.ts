import { describe, expect, it } from "vitest";

import { createExecutorCanUseTool, EXECUTOR_ALLOWED_TOOLS, EXECUTOR_DISALLOWED_TOOLS, EXECUTOR_PERMISSION_MODE, isPathWithinCwd } from "./agent-sdk-permission-policy.js";

const FAKE_CWD = "C:\\repo";

function fakeCanUseToolOptions(): Parameters<ReturnType<typeof createExecutorCanUseTool>>[2] {
  return { signal: new AbortController().signal, toolUseID: "tool-use-1", requestId: "request-1" };
}

describe("EXECUTOR_ALLOWED_TOOLS / EXECUTOR_DISALLOWED_TOOLS / EXECUTOR_PERMISSION_MODE", () => {
  it("is exactly Read, Write, Edit -- the literal Phase 3 minimum, confirmed with the user (no Glob/Grep/Bash)", () => {
    expect(EXECUTOR_ALLOWED_TOOLS).toEqual(["Read", "Write", "Edit"]);
  });

  it("explicitly disallows Bash, WebFetch, WebSearch, Task, and NotebookEdit", () => {
    expect(EXECUTOR_DISALLOWED_TOOLS).toEqual(["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit"]);
  });

  it("never uses acceptEdits or bypassPermissions -- always default", () => {
    expect(EXECUTOR_PERMISSION_MODE).toBe("default");
  });
});

// v1.3.1: a real, live clean-path isolation test proved cwd itself gives
// zero filesystem containment (an out-of-cwd Read/Edit succeeded with no
// denial), and that resolving the tool's own file_path against cwd here
// DOES provide real containment (the same out-of-cwd Read/Edit was
// blocked once this check existed, while an in-cwd edit still worked
// normally). These tests pin that exact behavior.
describe("isPathWithinCwd", () => {
  it("accepts the cwd itself", () => {
    expect(isPathWithinCwd(FAKE_CWD, "C:\\repo")).toBe(true);
  });

  it("accepts an absolute path nested inside cwd", () => {
    expect(isPathWithinCwd(FAKE_CWD, "C:\\repo\\tools\\claude-supervisor\\fixtures\\marker.txt")).toBe(true);
  });

  it("accepts a relative path (resolved against cwd)", () => {
    expect(isPathWithinCwd(FAKE_CWD, "tools\\claude-supervisor\\fixtures\\marker.txt")).toBe(true);
  });

  it("rejects an absolute path outside cwd, even a sibling directory with a similar name", () => {
    expect(isPathWithinCwd(FAKE_CWD, "C:\\repo-other\\marker.txt")).toBe(false);
    expect(isPathWithinCwd(FAKE_CWD, "C:\\elsewhere\\marker.txt")).toBe(false);
  });

  it("rejects a relative path that escapes cwd via ..", () => {
    expect(isPathWithinCwd(FAKE_CWD, "..\\outside-fixture.txt")).toBe(false);
  });

  it("is case-insensitive, matching Windows path semantics", () => {
    expect(isPathWithinCwd(FAKE_CWD, "c:\\REPO\\Tools\\Marker.txt")).toBe(true);
  });
});

describe("createExecutorCanUseTool", () => {
  it.each(["Read", "Write", "Edit"])("allows %s when file_path resolves inside cwd", async (toolName) => {
    const canUseTool = createExecutorCanUseTool(FAKE_CWD);
    const result = await canUseTool(toolName, { file_path: "C:\\repo\\src\\thing.ts" }, fakeCanUseToolOptions());
    expect(result).toEqual({ behavior: "allow" });
  });

  // The exact real scenario this round's own live test reproduced: a
  // controlled out-of-cwd Read/Edit attempt must be denied, never
  // silently allowed just because the tool name itself is in the
  // allowed set.
  it.each(["Read", "Write", "Edit"])("denies %s when file_path resolves outside cwd", async (toolName) => {
    const canUseTool = createExecutorCanUseTool(FAKE_CWD);
    const result = await canUseTool(toolName, { file_path: "C:\\completely\\different\\place.txt" }, fakeCanUseToolOptions());
    expect(result?.behavior).toBe("deny");
    expect(result && "message" in result ? result.message : null).toContain("outside the approved working directory");
  });

  it.each(["Read", "Write", "Edit"])("fail-closed denies %s when file_path is missing", async (toolName) => {
    const canUseTool = createExecutorCanUseTool(FAKE_CWD);
    const result = await canUseTool(toolName, {}, fakeCanUseToolOptions());
    expect(result?.behavior).toBe("deny");
  });

  it.each(["Read", "Write", "Edit"])("fail-closed denies %s when file_path is not a string", async (toolName) => {
    const canUseTool = createExecutorCanUseTool(FAKE_CWD);
    const result = await canUseTool(toolName, { file_path: 12345 }, fakeCanUseToolOptions());
    expect(result?.behavior).toBe("deny");
  });

  it("denies Bash with a fixed, non-negotiable message, regardless of any file_path supplied", async () => {
    const canUseTool = createExecutorCanUseTool(FAKE_CWD);
    const result = await canUseTool("Bash", { command: "rm -rf /" }, fakeCanUseToolOptions());
    expect(result?.behavior).toBe("deny");
    expect(result && "message" in result ? result.message : null).toContain("Bash");
  });

  // Fail-closed backstop: an unrecognized tool name (e.g. one a future
  // SDK version adds that this policy hasn't been updated for) must be
  // denied, never allowed by default.
  it("denies an entirely unrecognized future tool name", async () => {
    const canUseTool = createExecutorCanUseTool(FAKE_CWD);
    const result = await canUseTool("SomeFutureTool", {}, fakeCanUseToolOptions());
    expect(result?.behavior).toBe("deny");
  });
});
