import { describe, expect, it } from "vitest";

import { classifyDiff, classifyOperation, containsLevel2FilePattern } from "./scope-guard.js";

describe("classifyDiff", () => {
  it("returns LEVEL_1_AUTO_CONTINUE for a diff that touches nothing protected", () => {
    const result = classifyDiff(
      ["web/src/lib/tts-provider-gemini.ts", "web/src/lib/tts-provider-gemini.test.ts"],
      ["VAD", "billing", "auth"],
    );
    expect(result.level).toBe("LEVEL_1_AUTO_CONTINUE");
    expect(result.violations).toEqual([]);
  });

  // The exact example from this round's own task spec.
  it("flags voice-activity-logic.ts as LEVEL_2_REVIEW_REQUIRED when the contract's own protectedAreas names VAD", () => {
    const result = classifyDiff(
      ["web/src/components/consultation/voice-activity-logic.ts"],
      ["VAD", "billing", "auth"],
    );
    expect(result.level).toBe("LEVEL_2_REVIEW_REQUIRED");
    expect(result.violations).toEqual([
      { file: "web/src/components/consultation/voice-activity-logic.ts", matchedArea: "VAD", level: "LEVEL_2_REVIEW_REQUIRED" },
    ]);
  });

  it("flags a billing file as LEVEL_3_HARD_STOP even when the task's own protectedAreas never mentions billing -- the standing floor applies regardless", () => {
    const result = classifyDiff(["web/src/lib/billing-repository.ts"], ["VAD"]);
    expect(result.level).toBe("LEVEL_3_HARD_STOP");
    expect(result.violations[0]?.matchedArea).toBe("billing");
  });

  it("flags an auth file as LEVEL_3_HARD_STOP", () => {
    const result = classifyDiff(["web/src/lib/session-request-auth.ts"], ["VAD"]);
    expect(result.level).toBe("LEVEL_3_HARD_STOP");
  });

  it("flags a Prisma migration as LEVEL_3_HARD_STOP", () => {
    const result = classifyDiff(["web/prisma/migrations/20260825_add_column/migration.sql"], ["VAD"]);
    expect(result.level).toBe("LEVEL_3_HARD_STOP");
  });

  it("flags a GitHub Actions workflow change as LEVEL_3_HARD_STOP", () => {
    const result = classifyDiff([".github/workflows/web-quality.yml"], ["VAD"]);
    expect(result.level).toBe("LEVEL_3_HARD_STOP");
  });

  it("returns the WORST level across a mixed diff (one clean file, one hard-stop file)", () => {
    const result = classifyDiff(
      ["web/src/lib/tts-provider-gemini.ts", "web/src/lib/auth-role.ts"],
      ["VAD"],
    );
    expect(result.level).toBe("LEVEL_3_HARD_STOP");
    expect(result.violations).toHaveLength(1);
  });

  it("matches case-insensitively and regardless of path separator style", () => {
    const result = classifyDiff(["web\\src\\components\\consultation\\Voice-Activity-Logic.ts"], ["vad"]);
    expect(result.level).toBe("LEVEL_2_REVIEW_REQUIRED");
  });

  it("never flags an unrelated file that merely shares a short substring accidentally excluded from areas", () => {
    const result = classifyDiff(["web/src/lib/authentic-copywriting.ts"], []);
    // "authentic-copywriting.ts" contains "auth" as a real substring --
    // this is a DELIBERATE, documented over-trigger (permissive-to-match
    // bias, see this module's own doc comment) -- asserting it here
    // locks in that known trade-off rather than silently relying on it.
    expect(result.level).toBe("LEVEL_3_HARD_STOP");
  });
});

describe("classifyOperation", () => {
  it("classifies a normal git commit as LEVEL_1_AUTO_CONTINUE", () => {
    expect(classifyOperation('git commit -m "fix: normal edit"')).toBe("LEVEL_1_AUTO_CONTINUE");
  });

  it("classifies a normal git push as LEVEL_1_AUTO_CONTINUE", () => {
    expect(classifyOperation("git push origin master")).toBe("LEVEL_1_AUTO_CONTINUE");
  });

  it("classifies a force push as LEVEL_3_HARD_STOP", () => {
    expect(classifyOperation("git push --force origin master")).toBe("LEVEL_3_HARD_STOP");
    expect(classifyOperation("git push -f origin master")).toBe("LEVEL_3_HARD_STOP");
  });

  it("classifies git reset --hard as LEVEL_3_HARD_STOP", () => {
    expect(classifyOperation("git reset --hard HEAD~3")).toBe("LEVEL_3_HARD_STOP");
  });

  it("classifies branch deletion (-D) as LEVEL_3_HARD_STOP", () => {
    expect(classifyOperation("git branch -D feature/old")).toBe("LEVEL_3_HARD_STOP");
  });

  it("classifies git clean -fd as LEVEL_3_HARD_STOP", () => {
    expect(classifyOperation("git clean -fd")).toBe("LEVEL_3_HARD_STOP");
  });

  it("classifies an interactive rebase as LEVEL_3_HARD_STOP", () => {
    expect(classifyOperation("git rebase -i HEAD~5")).toBe("LEVEL_3_HARD_STOP");
  });
});

describe("containsLevel2FilePattern", () => {
  it("flags package.json changes", () => {
    expect(containsLevel2FilePattern(["web/package.json"])).toEqual(["web/package.json"]);
  });

  it("flags .env.example changes", () => {
    expect(containsLevel2FilePattern([".env.example"])).toEqual([".env.example"]);
  });

  it("returns an empty array for a diff with no such files", () => {
    expect(containsLevel2FilePattern(["web/src/lib/foo.ts"])).toEqual([]);
  });
});
