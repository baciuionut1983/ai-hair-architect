import { describe, expect, it } from "vitest";

import {
  isProceduralClaimReviewDecision,
  isProceduralClaimType,
  isSameProceduralReviewDecision,
  isValidProceduralReviewState,
  type ProceduralClaimReviewEntry,
} from "@/lib/professional-learning-procedural-review-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.4.b.1 -- pure
// tests, zero I/O, zero real Gemini calls.

function entry(overrides: Partial<ProceduralClaimReviewEntry> = {}): ProceduralClaimReviewEntry {
  return {
    claimId: "COMBING",
    claimType: "PROCEDURAL_PATTERN",
    decision: "PROFESSIONALLY_CONFIRMED",
    originalValue: { kind: "COMBING", occurrenceCount: 5 },
    originalProvenance: "INFERRED",
    reviewedByUserId: "user-1",
    reviewedAt: "2026-09-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("isProceduralClaimReviewDecision", () => {
  it("accepts all four recognized decisions", () => {
    for (const value of ["PROFESSIONALLY_CONFIRMED", "PROFESSIONALLY_CORRECTED", "PROFESSIONALLY_REJECTED", "PROFESSIONALLY_UNKNOWN"]) {
      expect(isProceduralClaimReviewDecision(value)).toBe(true);
    }
  });

  it("UNKNOWN is a distinct, recognized value -- never confused with rejection, absence, or emptiness", () => {
    expect(isProceduralClaimReviewDecision("PROFESSIONALLY_UNKNOWN")).toBe(true);
    expect("PROFESSIONALLY_UNKNOWN").not.toBe("PROFESSIONALLY_REJECTED");
    expect(isProceduralClaimReviewDecision(undefined)).toBe(false);
    expect(isProceduralClaimReviewDecision("")).toBe(false);
  });

  it("rejects unrecognized/malformed values", () => {
    for (const value of ["", "CONFIRMED", "NOT_REVIEWED", null, undefined, 42, false]) {
      expect(isProceduralClaimReviewDecision(value)).toBe(false);
    }
  });
});

describe("isProceduralClaimType", () => {
  it("accepts PROCEDURAL_PATTERN and rejects anything else", () => {
    expect(isProceduralClaimType("PROCEDURAL_PATTERN")).toBe(true);
    expect(isProceduralClaimType("SOMETHING_ELSE")).toBe(false);
  });
});

describe("isValidProceduralReviewState", () => {
  it("accepts a well-formed state with multiple claim entries", () => {
    const state = { claims: { COMBING: entry(), CUTTING_ACTION: entry({ claimId: "CUTTING_ACTION", decision: "PROFESSIONALLY_REJECTED" }) } };
    expect(isValidProceduralReviewState(state)).toBe(true);
  });

  it("accepts an empty claims map", () => {
    expect(isValidProceduralReviewState({ claims: {} })).toBe(true);
  });

  it("rejects null/non-object/malformed shapes", () => {
    expect(isValidProceduralReviewState(null)).toBe(false);
    expect(isValidProceduralReviewState("not an object")).toBe(false);
    expect(isValidProceduralReviewState({})).toBe(false);
  });

  it("rejects an entry with an invalid decision", () => {
    const state = { claims: { COMBING: { ...entry(), decision: "MADE_UP" } } };
    expect(isValidProceduralReviewState(state)).toBe(false);
  });

  it("rejects a PROFESSIONALLY_CORRECTED-shaped entry with a non-string correctedValue", () => {
    const state = { claims: { COMBING: { ...entry(), correctedValue: 123 } } };
    expect(isValidProceduralReviewState(state)).toBe(false);
  });

  it("rejects an entry whose originalProvenance is not exactly INFERRED", () => {
    const state = { claims: { COMBING: { ...entry(), originalProvenance: "OBSERVED" } } };
    expect(isValidProceduralReviewState(state)).toBe(false);
  });
});

describe("isSameProceduralReviewDecision", () => {
  it("treats two entries with identical authority content but different reviewedAt timestamps as the same decision", () => {
    const a = entry({ reviewedAt: "2026-09-18T00:00:00.000Z" });
    const b = entry({ reviewedAt: "2026-09-18T00:05:00.000Z" });
    expect(isSameProceduralReviewDecision(a, b)).toBe(true);
  });

  it("treats a different decision as NOT the same", () => {
    const a = entry({ decision: "PROFESSIONALLY_CONFIRMED" });
    const b = entry({ decision: "PROFESSIONALLY_REJECTED" });
    expect(isSameProceduralReviewDecision(a, b)).toBe(false);
  });

  it("treats a different correctedValue as NOT the same", () => {
    const a = entry({ decision: "PROFESSIONALLY_CORRECTED", correctedValue: "45 Interior" });
    const b = entry({ decision: "PROFESSIONALLY_CORRECTED", correctedValue: "One-Length" });
    expect(isSameProceduralReviewDecision(a, b)).toBe(false);
  });

  it("treats a different reviewer as NOT the same", () => {
    const a = entry({ reviewedByUserId: "user-1" });
    const b = entry({ reviewedByUserId: "user-2" });
    expect(isSameProceduralReviewDecision(a, b)).toBe(false);
  });
});
