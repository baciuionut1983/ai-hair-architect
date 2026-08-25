import { describe, expect, it } from "vitest";

import { buildCorrectionPrompt, computeFailureFingerprint, decideCorrectionAction, isRepeatedFailure } from "./correction-loop.js";

describe("buildCorrectionPrompt", () => {
  it("includes the failed check name and the failure output verbatim (within bound)", () => {
    const prompt = buildCorrectionPrompt({ checkOrCiName: "supervisor_typecheck", boundedFailureOutput: "src/foo.ts(3,1): error TS2304" });
    expect(prompt).toContain("supervisor_typecheck");
    expect(prompt).toContain("TS2304");
  });

  it("instructs the executor to stay within approved scope and never expand it", () => {
    const prompt = buildCorrectionPrompt({ checkOrCiName: "x", boundedFailureOutput: "y" });
    expect(prompt).toContain("Do not modify any protected area");
    expect(prompt).toContain("Do not expand scope");
  });

  it("bounds very long failure output rather than embedding it unbounded in the prompt", () => {
    const long = "z".repeat(10_000) + "REAL_TAIL";
    const prompt = buildCorrectionPrompt({ checkOrCiName: "x", boundedFailureOutput: long });
    expect(prompt.length).toBeLessThan(3_000);
    expect(prompt).toContain("REAL_TAIL");
  });

  it("produces the identical prompt across repeated calls with the same input -- deterministic, not regenerated text", () => {
    const a = buildCorrectionPrompt({ checkOrCiName: "x", boundedFailureOutput: "y" });
    const b = buildCorrectionPrompt({ checkOrCiName: "x", boundedFailureOutput: "y" });
    expect(a).toBe(b);
  });
});

describe("decideCorrectionAction", () => {
  // Test requirement 5: correction loop success (reuses the restart
  // bound -- under it, RESTART).
  it("allows a correction attempt while under the bound", () => {
    expect(decideCorrectionAction(0).action).toBe("RESTART");
    expect(decideCorrectionAction(2).action).toBe("RESTART");
  });

  // Test requirement 6: correction loop exhaustion.
  it("escalates once the bound (3) is reached", () => {
    expect(decideCorrectionAction(3).action).toBe("ESCALATE");
  });
});

describe("computeFailureFingerprint / isRepeatedFailure", () => {
  it("produces identical fingerprints for the same check+output, even with different whitespace", () => {
    const a = computeFailureFingerprint("supervisor_test", "3 tests   failed\n\n");
    const b = computeFailureFingerprint("supervisor_test", "3   tests failed");
    expect(a).toBe(b);
  });

  it("produces different fingerprints for a genuinely different failure", () => {
    const a = computeFailureFingerprint("supervisor_test", "3 tests failed");
    const b = computeFailureFingerprint("supervisor_test", "5 tests failed");
    expect(a).not.toBe(b);
  });

  // Test requirement 7: repeated failure fingerprint escalates.
  it("detects 3 consecutive identical fingerprints as a repeated (no-progress) failure", () => {
    const fp = computeFailureFingerprint("supervisor_test", "same failure every time");
    expect(isRepeatedFailure([fp, fp, fp])).toBe(true);
  });

  it("does not flag a genuinely changing sequence of fingerprints", () => {
    const fp1 = computeFailureFingerprint("supervisor_test", "failure A");
    const fp2 = computeFailureFingerprint("supervisor_test", "failure B");
    const fp3 = computeFailureFingerprint("supervisor_test", "failure C");
    expect(isRepeatedFailure([fp1, fp2, fp3])).toBe(false);
  });

  it("does not flag fewer than the bound's worth of history", () => {
    const fp = computeFailureFingerprint("supervisor_test", "same failure");
    expect(isRepeatedFailure([fp, fp])).toBe(false);
  });
});
