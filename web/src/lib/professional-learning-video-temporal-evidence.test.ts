import { describe, expect, it } from "vitest";

import { buildProfessionalLearningTemporalEvidence, isValidProfessionalLearningTemporalEvidence } from "@/lib/professional-learning-video-temporal-evidence";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.2 -- pure
// tests, zero I/O, zero real Gemini calls. Proves the exact provider
// contract (professional-learning-extractor.ts's
// temporalObservations/actionCandidates/notableEditsOrCuts) survives
// into the canonical, persistable shape without collapsing, fabricating,
// or reclassifying anything.

describe("buildProfessionalLearningTemporalEvidence", () => {
  it("preserves a single valid temporal observation with OBSERVED provenance", () => {
    const result = buildProfessionalLearningTemporalEvidence({
      temporalObservations: [{ timeStartSeconds: 0, timeEndSeconds: 5, observation: "comb passes through a section of hair" }],
    });
    expect(result).toEqual({
      observations: [{ timeStartSeconds: 0, timeEndSeconds: 5, observation: "comb passes through a section of hair", source: "OBSERVED" }],
      actions: [],
      editGaps: [],
    });
  });

  it("preserves MULTIPLE temporal observations without scalar collapse -- both survive, neither overwrites the other", () => {
    const result = buildProfessionalLearningTemporalEvidence({
      temporalObservations: [
        { timeStartSeconds: 0, timeEndSeconds: 5, observation: "comb passes through a section of hair" },
        { timeStartSeconds: 5, timeEndSeconds: 9, observation: "scissors visibly close near the ends" },
      ],
    });
    expect(result?.observations).toHaveLength(2);
    expect(result?.observations[0].observation).toBe("comb passes through a section of hair");
    expect(result?.observations[1].observation).toBe("scissors visibly close near the ends");
  });

  it("preserves action candidates with INFERRED provenance -- distinct from observation provenance", () => {
    const result = buildProfessionalLearningTemporalEvidence({
      actionCandidates: [{ timeStartSeconds: 5, timeEndSeconds: 9, kind: "CUTTING_ACTION" }],
    });
    expect(result?.actions).toEqual([{ timeStartSeconds: 5, timeEndSeconds: 9, kind: "CUTTING_ACTION", source: "INFERRED" }]);
  });

  it("no provider evidence ever becomes PROFESSIONAL_INPUT merely because it is persisted", () => {
    const result = buildProfessionalLearningTemporalEvidence({
      temporalObservations: [{ timeStartSeconds: 0, timeEndSeconds: 5, observation: "x" }],
      actionCandidates: [{ timeStartSeconds: 0, timeEndSeconds: 5, kind: "y" }],
      notableEditsOrCuts: [{ beforeTimeSeconds: 5, afterTimeSeconds: 6 }],
    });
    const sources = [...(result?.observations.map((o) => o.source) ?? []), ...(result?.actions.map((a) => a.source) ?? []), ...(result?.editGaps.map((g) => g.source) ?? [])];
    for (const source of sources) {
      expect(source).not.toBe("PROFESSIONAL_INPUT");
      expect(source).not.toBe("UNKNOWN");
    }
  });

  it("preserves notable edit gaps with OBSERVED provenance", () => {
    const result = buildProfessionalLearningTemporalEvidence({ notableEditsOrCuts: [{ beforeTimeSeconds: 9, afterTimeSeconds: 40 }] });
    expect(result?.editGaps).toEqual([{ beforeTimeSeconds: 9, afterTimeSeconds: 40, source: "OBSERVED" }]);
  });

  it("returns null (no fabrication) when none of the three fields are present -- e.g. TEXT/IMAGE evidence", () => {
    expect(buildProfessionalLearningTemporalEvidence({})).toBeNull();
  });

  it("temporal ordering within each array is deterministic -- preserves the provider's own order, never reshuffled", () => {
    const result = buildProfessionalLearningTemporalEvidence({
      temporalObservations: [
        { timeStartSeconds: 10, timeEndSeconds: 12, observation: "second in time, first in the array" },
        { timeStartSeconds: 0, timeEndSeconds: 2, observation: "first in time, second in the array" },
      ],
    });
    // Order is NOT re-sorted by time here -- the array order the
    // provider returned is preserved verbatim, exactly like
    // buildExtractionFromRawFields never reorders extractedFields.
    expect(result?.observations[0].observation).toBe("second in time, first in the array");
    expect(result?.observations[1].observation).toBe("first in time, second in the array");
  });

  it.each([
    ["missing timeEndSeconds", { timeStartSeconds: 0, observation: "x" }],
    ["end before start", { timeStartSeconds: 5, timeEndSeconds: 2, observation: "x" }],
    ["negative start", { timeStartSeconds: -1, timeEndSeconds: 2, observation: "x" }],
    ["empty observation text", { timeStartSeconds: 0, timeEndSeconds: 2, observation: "   " }],
    ["non-string observation", { timeStartSeconds: 0, timeEndSeconds: 2, observation: 123 }],
  ])("silently drops a malformed observation entry (%s) rather than fabricating or rejecting the whole draft", (_label, malformed) => {
    const result = buildProfessionalLearningTemporalEvidence({
      // @ts-expect-error -- intentionally malformed input, exactly what an untrusted provider response could contain.
      temporalObservations: [malformed, { timeStartSeconds: 20, timeEndSeconds: 22, observation: "a genuinely valid entry" }],
    });
    expect(result?.observations).toEqual([{ timeStartSeconds: 20, timeEndSeconds: 22, observation: "a genuinely valid entry", source: "OBSERVED" }]);
  });

  it("drops a malformed edit gap entry (after before after) rather than fabricating one", () => {
    const result = buildProfessionalLearningTemporalEvidence({
      notableEditsOrCuts: [
        { beforeTimeSeconds: 10, afterTimeSeconds: 5 },
        { beforeTimeSeconds: 9, afterTimeSeconds: 40 },
      ],
    });
    expect(result?.editGaps).toEqual([{ beforeTimeSeconds: 9, afterTimeSeconds: 40, source: "OBSERVED" }]);
  });

  it("never fabricates a value for missing/absent fields -- UNKNOWN/missing stays absent, not a guessed entry", () => {
    const result = buildProfessionalLearningTemporalEvidence({ temporalObservations: [{ timeStartSeconds: 0, timeEndSeconds: 5, observation: "only this one" }] });
    expect(result?.actions).toEqual([]);
    expect(result?.editGaps).toEqual([]);
  });

  it("bounds collection size per array rather than persisting an unbounded list", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ timeStartSeconds: i, timeEndSeconds: i + 1, observation: `observation ${i}` }));
    const result = buildProfessionalLearningTemporalEvidence({ temporalObservations: many });
    expect(result!.observations.length).toBeLessThanOrEqual(200);
  });
});

describe("isValidProfessionalLearningTemporalEvidence", () => {
  it("accepts a well-formed persisted value", () => {
    const value = { observations: [{ timeStartSeconds: 0, timeEndSeconds: 5, observation: "x", source: "OBSERVED" }], actions: [], editGaps: [] };
    expect(isValidProfessionalLearningTemporalEvidence(value)).toBe(true);
  });

  it("rejects a value with an invalid provenance for its array (never trusts a value verbatim)", () => {
    const value = { observations: [{ timeStartSeconds: 0, timeEndSeconds: 5, observation: "x", source: "PROFESSIONAL_INPUT" }], actions: [], editGaps: [] };
    expect(isValidProfessionalLearningTemporalEvidence(value)).toBe(false);
  });

  it("rejects null/non-object values", () => {
    expect(isValidProfessionalLearningTemporalEvidence(null)).toBe(false);
    expect(isValidProfessionalLearningTemporalEvidence("not an object")).toBe(false);
  });
});
