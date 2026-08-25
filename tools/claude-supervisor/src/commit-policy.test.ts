import { describe, expect, it } from "vitest";

import { buildCommitMessage, filterStageableFiles, isCommitAllowed, isPushAllowed } from "./commit-policy.js";
import { validateTaskContract } from "./task-contract.js";
import type { TaskContract } from "./types.js";

function contract(overrides: Partial<TaskContract> = {}): TaskContract {
  const result = validateTaskContract({
    taskId: "task-1",
    title: "Test task",
    approvedPrompt: "Do the thing.",
    scope: ["x"],
    protectedAreas: ["VAD"],
    requiredChecks: [],
    ...overrides,
  });
  if (!result.ok) throw new Error("invalid fixture");
  return result.contract;
}

describe("isCommitAllowed / isPushAllowed", () => {
  // Test requirement 13: commit denied without contract permission.
  it("denies commit when allowedOperations is absent", () => {
    expect(isCommitAllowed(contract())).toBe(false);
  });

  it("denies commit when allowedOperations exists but does not include 'commit'", () => {
    expect(isCommitAllowed(contract({ allowedOperations: ["push"] }))).toBe(false);
  });

  it("allows commit only when allowedOperations explicitly includes 'commit'", () => {
    expect(isCommitAllowed(contract({ allowedOperations: ["commit"] }))).toBe(true);
  });

  // Test requirement 14: push denied without permission.
  it("denies push when allowedOperations is absent", () => {
    expect(isPushAllowed(contract())).toBe(false);
  });

  it("allows push only when allowedOperations explicitly includes 'push'", () => {
    expect(isPushAllowed(contract({ allowedOperations: ["commit", "push"] }))).toBe(true);
  });
});

describe("buildCommitMessage", () => {
  it("includes the task title and taskId, deterministically", () => {
    const message = buildCommitMessage(contract({ title: "Fix the widget", taskId: "task-42" }));
    expect(message).toContain("Fix the widget");
    expect(message).toContain("task-42");
  });

  it("produces the identical message for the identical contract", () => {
    const a = buildCommitMessage(contract());
    const b = buildCommitMessage(contract());
    expect(a).toBe(b);
  });
});

describe("filterStageableFiles", () => {
  // Test requirement 11: .claude/ never staged.
  it("blocks .claude/ files", () => {
    const result = filterStageableFiles([".claude/settings.json", "tools/claude-supervisor/src/foo.ts"]);
    expect(result.blocked).toEqual([".claude/settings.json"]);
    expect(result.stageable).toEqual(["tools/claude-supervisor/src/foo.ts"]);
  });

  it("blocks Supervisor state/ files", () => {
    const result = filterStageableFiles(["tools/claude-supervisor/state/task-1.json"]);
    expect(result.blocked).toEqual(["tools/claude-supervisor/state/task-1.json"]);
  });

  it("blocks .env files", () => {
    const result = filterStageableFiles(["web/.env", "web/.env.local", "web/src/lib/foo.ts"]);
    expect(result.blocked).toEqual(["web/.env", "web/.env.local"]);
    expect(result.stageable).toEqual(["web/src/lib/foo.ts"]);
  });

  it("blocks anything under a secrets/ directory", () => {
    const result = filterStageableFiles(["config/secrets/api-key.json"]);
    expect(result.blocked).toEqual(["config/secrets/api-key.json"]);
  });

  it("stages ordinary source files normally", () => {
    const result = filterStageableFiles(["tools/claude-supervisor/src/foo.ts", "tools/claude-supervisor/src/foo.test.ts"]);
    expect(result.blocked).toEqual([]);
    expect(result.stageable).toEqual(["tools/claude-supervisor/src/foo.ts", "tools/claude-supervisor/src/foo.test.ts"]);
  });
});
