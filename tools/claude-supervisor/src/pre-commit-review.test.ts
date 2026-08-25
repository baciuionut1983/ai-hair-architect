import { describe, expect, it } from "vitest";

import { runPreCommitReview, type PreCommitReviewInput } from "./pre-commit-review.js";
import { validateTaskContract } from "./task-contract.js";
import type { TaskContract } from "./types.js";

function contract(overrides: Partial<TaskContract> = {}): TaskContract {
  const result = validateTaskContract({
    taskId: "task-1",
    title: "Test task",
    approvedPrompt: "Do the thing.",
    scope: ["x"],
    protectedAreas: ["VAD", "billing"],
    requiredChecks: [],
    ...overrides,
  });
  if (!result.ok) throw new Error("invalid fixture");
  return result.contract;
}

function baseInput(overrides: Partial<PreCommitReviewInput> = {}): PreCommitReviewInput {
  const c = contract();
  return {
    contractAtLaunch: c,
    contractNow: c,
    expectedHeadSha: "abc123",
    actualHeadSha: "abc123",
    changedFiles: ["tools/claude-supervisor/src/foo.ts"],
    statusLines: [" M tools/claude-supervisor/src/foo.ts", "?? .claude/"],
    allowedUntrackedPrefixes: [".claude"],
    checksAllPassed: true,
    ...overrides,
  };
}

describe("runPreCommitReview", () => {
  it("passes every condition for a clean, fully-compliant run", () => {
    const record = runPreCommitReview(baseInput(), () => "2026-08-25T00:00:00.000Z");
    expect(record.ok).toBe(true);
    expect(record.conditions.every((c) => c.passed)).toBe(true);
    expect(record.timestamp).toBe("2026-08-25T00:00:00.000Z");
  });

  it("fails when the contract changed mid-run", () => {
    const c1 = contract();
    const c2 = contract({ approvedPrompt: "Do something completely different." });
    const record = runPreCommitReview(baseInput({ contractAtLaunch: c1, contractNow: c2 }), () => "t");
    expect(record.ok).toBe(false);
    expect(record.conditions.find((cnd) => cnd.name === "contract_unchanged")?.passed).toBe(false);
  });

  it("fails when HEAD does not match the expected sha (e.g. an unexpected commit already happened)", () => {
    const record = runPreCommitReview(baseInput({ expectedHeadSha: "abc123", actualHeadSha: "def456" }), () => "t");
    expect(record.ok).toBe(false);
    expect(record.conditions.find((c) => c.name === "head_matches_expected")?.passed).toBe(false);
  });

  // Test requirement 10: protected file never staged (caught here, at
  // pre-commit review, as the final defense-in-depth gate).
  it("fails when a Level 2 protected area was touched", () => {
    const record = runPreCommitReview(baseInput({ changedFiles: ["web/src/components/consultation/voice-activity-logic.ts"] }), () => "t");
    expect(record.ok).toBe(false);
    expect(record.conditions.find((c) => c.name === "no_protected_files_touched")?.passed).toBe(false);
  });

  it("fails on no_level3_files_touched for a billing file, distinct from the generic protected-area condition", () => {
    const record = runPreCommitReview(baseInput({ changedFiles: ["web/src/lib/billing-repository.ts"] }), () => "t");
    expect(record.conditions.find((c) => c.name === "no_level3_files_touched")?.passed).toBe(false);
  });

  it("fails when required checks did not all pass", () => {
    const record = runPreCommitReview(baseInput({ checksAllPassed: false }), () => "t");
    expect(record.ok).toBe(false);
    expect(record.conditions.find((c) => c.name === "required_checks_all_passed")?.passed).toBe(false);
  });

  it("fails on an unexpected untracked file outside the allow-list", () => {
    const record = runPreCommitReview(baseInput({ statusLines: ["?? some-stray-file.txt", "?? .claude/"] }), () => "t");
    expect(record.ok).toBe(false);
    expect(record.conditions.find((c) => c.name === "no_unexpected_untracked_files")?.passed).toBe(false);
  });

  it("never flags the allow-listed .claude/ prefix as an unexpected untracked file", () => {
    const record = runPreCommitReview(baseInput({ statusLines: ["?? .claude/"] }), () => "t");
    expect(record.conditions.find((c) => c.name === "no_unexpected_untracked_files")?.passed).toBe(true);
  });

  // Test requirement (Phase 3): ".claude/ untouched".
  it("fails claude_dir_untouched if .claude/ shows as MODIFIED (tracked), not just untracked", () => {
    const record = runPreCommitReview(baseInput({ statusLines: [" M .claude/settings.json"] }), () => "t");
    expect(record.conditions.find((c) => c.name === "claude_dir_untouched")?.passed).toBe(false);
  });
});
