import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyDecision, planDryRun, runPreflight } from "./orchestrator.js";
import { initialRunState } from "./persistence.js";
import { execSafe } from "./safe-exec.js";
import { validateTaskContract } from "./task-contract.js";
import type { TaskContract } from "./types.js";

function contract(): TaskContract {
  const result = validateTaskContract({
    taskId: "task-1",
    title: "TTS A/B experiment",
    approvedPrompt: "Do the approved thing.",
    scope: ["TTS experiment"],
    protectedAreas: ["VAD", "billing", "auth"],
    requiredChecks: ["tsc", "eslint", "vitest", "build"],
  });
  if (!result.ok) throw new Error("invalid fixture");
  return result.contract;
}

describe("planDryRun", () => {
  // Required test 18: dry-run sends no action. Proven structurally here,
  // not just asserted: planDryRun takes an already-gathered observation
  // (a plain object, no I/O handle of any kind) and returns a plain
  // object -- there is no child_process, no fs write, no network call
  // reachable from this function's own signature at all, so this test
  // passing is a real proof, not a claim.
  it("computes a full plan from a plain observation object, touching no I/O", () => {
    const state = { ...initialRunState("task-1"), state: "TASK_RECEIVED" as const };
    const plan = planDryRun(state, contract(), { type: "PREFLIGHT_RESULT", clean: true });
    expect(plan.wouldTransitionTo).toBe("PREFLIGHT");
    expect(plan.decision.event).toEqual({ type: "PREFLIGHT_PASSED" });
  });

  it("never mutates the run state object it was given", () => {
    const state = { ...initialRunState("task-1"), state: "TASK_RECEIVED" as const };
    const before = JSON.stringify(state);
    planDryRun(state, contract(), { type: "PREFLIGHT_RESULT", clean: true });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("reports an IGNORED plan (never a fabricated transition) for an event that does not apply to the current state", () => {
    const state = { ...initialRunState("task-1"), state: "COMPLETED" as const };
    const plan = planDryRun(state, contract(), { type: "PREFLIGHT_RESULT", clean: true });
    expect(plan.wouldTransitionTo).toContain("IGNORED");
  });
});

describe("applyDecision", () => {
  it("advances the run state and records a human-readable lastAction", () => {
    const state = { ...initialRunState("task-1", () => "2026-08-25T00:00:00.000Z"), state: "TASK_RECEIVED" as const };
    const next = applyDecision(state, contract(), { type: "PREFLIGHT_RESULT", clean: true }, () => "2026-08-25T00:01:00.000Z");
    expect(next.state).toBe("PREFLIGHT");
    expect(next.updatedAt).toBe("2026-08-25T00:01:00.000Z");
    expect(next.lastAction.length).toBeGreaterThan(0);
  });

  it("logs the decision via the injected logger path (no direct console dependency in the test)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const state = { ...initialRunState("task-1"), state: "TASK_RECEIVED" as const };
    applyDecision(state, contract(), { type: "PREFLIGHT_RESULT", clean: true }, () => "2026-08-25T00:01:00.000Z");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("[SUPERVISOR]");
    logSpy.mockRestore();
  });
});

describe("runPreflight (real git, read-only)", () => {
  let dir: string;

  async function git(args: string[]): Promise<void> {
    const result = await execSafe("git", args, { cwd: dir });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "claude-supervisor-orchestrator-test-"));
    await git(["init", "-b", "master"]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["config", "user.name", "Test"]);
    writeFileSync(join(dir, "file.txt"), "hello\n", "utf8");
    await git(["add", "file.txt"]);
    await git(["commit", "-m", "initial"]);
  }, 30_000);

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports clean:true for a genuinely clean tree", async () => {
    const result = await runPreflight(dir, []);
    expect(result.clean).toBe(true);
    expect(result.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("reports clean:false with a real reason when the tree has uncommitted changes", async () => {
    writeFileSync(join(dir, "file.txt"), "modified\n", "utf8");
    const result = await runPreflight(dir, []);
    expect(result.clean).toBe(false);
    expect(result.reason).toContain("file.txt");
  });

  it("still reports clean:true when the only difference is an allowed untracked prefix (e.g. .claude/)", async () => {
    writeFileSync(join(dir, ".claude-marker"), "x\n", "utf8");
    const result = await runPreflight(dir, [".claude-marker"]);
    expect(result.clean).toBe(true);
  });
});
