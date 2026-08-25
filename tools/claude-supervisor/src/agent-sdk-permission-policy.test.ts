import { describe, expect, it } from "vitest";

import { createExecutorCanUseTool, EXECUTOR_ALLOWED_TOOLS, EXECUTOR_DISALLOWED_TOOLS, EXECUTOR_PERMISSION_MODE } from "./agent-sdk-permission-policy.js";

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

describe("createExecutorCanUseTool", () => {
  it.each(["Read", "Write", "Edit"])("allows %s", async (toolName) => {
    const canUseTool = createExecutorCanUseTool();
    const result = await canUseTool(toolName, {}, fakeCanUseToolOptions());
    expect(result).toEqual({ behavior: "allow" });
  });

  it("denies Bash with a fixed, non-negotiable message", async () => {
    const canUseTool = createExecutorCanUseTool();
    const result = await canUseTool("Bash", { command: "rm -rf /" }, fakeCanUseToolOptions());
    expect(result?.behavior).toBe("deny");
    expect(result && "message" in result ? result.message : null).toContain("Bash");
  });

  // Fail-closed backstop: an unrecognized tool name (e.g. one a future
  // SDK version adds that this policy hasn't been updated for) must be
  // denied, never allowed by default.
  it("denies an entirely unrecognized future tool name", async () => {
    const canUseTool = createExecutorCanUseTool();
    const result = await canUseTool("SomeFutureTool", {}, fakeCanUseToolOptions());
    expect(result?.behavior).toBe("deny");
  });
});
