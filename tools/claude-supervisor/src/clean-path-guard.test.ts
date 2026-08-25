import { describe, expect, it } from "vitest";

import { containsClaudeDirSegment } from "./clean-path-guard.js";

describe("containsClaudeDirSegment", () => {
  it("detects the exact real canonical-repo case that caused nondeterministic sensitive-file denials this round", () => {
    expect(containsClaudeDirSegment("C:\\Users\\hp\\.claude\\projects\\ai-hair-architect")).toBe(true);
  });

  it("detects it with forward slashes too", () => {
    expect(containsClaudeDirSegment("C:/Users/hp/.claude/projects/ai-hair-architect")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(containsClaudeDirSegment("C:\\Users\\hp\\.CLAUDE\\projects\\ai-hair-architect")).toBe(true);
  });

  it("returns false for the clean-path case this round validated", () => {
    expect(containsClaudeDirSegment("C:\\Projects\\ai-hair-architect")).toBe(false);
  });

  // Must never false-positive on a name that merely CONTAINS "claude" as
  // a substring -- only an exact ".claude" path segment counts.
  it("does not false-positive on a directory name that merely contains 'claude'", () => {
    expect(containsClaudeDirSegment("C:\\Projects\\claude-supervisor-fork")).toBe(false);
    expect(containsClaudeDirSegment("C:\\Projects\\my-claude-tools\\ai-hair-architect")).toBe(false);
  });

  it("returns false for a path with no .claude segment at all", () => {
    expect(containsClaudeDirSegment("C:\\Projects\\ai-hair-architect\\tools\\claude-supervisor")).toBe(false);
  });
});
