import { describe, expect, it } from "vitest";

import {
  isLegalDraftStatusTransition,
  isProfessionalLearningComparisonOutcome,
  isProfessionalLearningDiscernmentCategory,
  isProfessionalLearningDraftStatus,
  isProfessionalLearningProvenanceSource,
  isValidExtraction,
} from "./professional-learning-draft-validators";

describe("professional-learning-draft-validators", () => {
  it("accepts every declared draft status and rejects unknown ones", () => {
    for (const status of ["DRAFT", "READY_FOR_REVIEW", "APPROVED", "REJECTED", "SUPERSEDED"]) {
      expect(isProfessionalLearningDraftStatus(status)).toBe(true);
    }
    expect(isProfessionalLearningDraftStatus("ACTIVE")).toBe(false);
    expect(isProfessionalLearningDraftStatus("registry_activated")).toBe(false);
  });

  it("enforces a fail-closed status transition table", () => {
    expect(isLegalDraftStatusTransition("DRAFT", "READY_FOR_REVIEW")).toBe(true);
    expect(isLegalDraftStatusTransition("READY_FOR_REVIEW", "APPROVED")).toBe(true);
    expect(isLegalDraftStatusTransition("READY_FOR_REVIEW", "REJECTED")).toBe(true);
    expect(isLegalDraftStatusTransition("DRAFT", "APPROVED")).toBe(false);
    expect(isLegalDraftStatusTransition("APPROVED", "DRAFT")).toBe(false);
    expect(isLegalDraftStatusTransition("APPROVED", "READY_FOR_REVIEW")).toBe(false);
    expect(isLegalDraftStatusTransition("REJECTED", "APPROVED")).toBe(false);
    expect(isLegalDraftStatusTransition("SUPERSEDED", "DRAFT")).toBe(false);
    // The only legal exit from a terminal review outcome is being
    // superseded by a brand-new draft (a professional correction) --
    // never a resurrection back into the review flow.
    expect(isLegalDraftStatusTransition("APPROVED", "SUPERSEDED")).toBe(true);
    expect(isLegalDraftStatusTransition("REJECTED", "SUPERSEDED")).toBe(true);
  });

  it("accepts every declared discernment category and rejects an invented one", () => {
    expect(isProfessionalLearningDiscernmentCategory("PROFESSIONAL_TECHNIQUE")).toBe(true);
    expect(isProfessionalLearningDiscernmentCategory("IRRELEVANT")).toBe(true);
    expect(isProfessionalLearningDiscernmentCategory("INSUFFICIENT_EVIDENCE")).toBe(true);
    expect(isProfessionalLearningDiscernmentCategory("LOOK_OR_GOAL")).toBe(false);
  });

  it("accepts every declared comparison outcome and rejects an invented one", () => {
    expect(isProfessionalLearningComparisonOutcome("EVIDENCE_FOR_EXISTING")).toBe(true);
    expect(isProfessionalLearningComparisonOutcome("POSSIBLE_CONFLICT")).toBe(true);
    expect(isProfessionalLearningComparisonOutcome("AUTO_APPROVED")).toBe(false);
  });

  it("accepts OBSERVED/INFERRED/PROFESSIONAL_INPUT/UNKNOWN and the future-capable-only classes", () => {
    for (const source of ["OBSERVED", "INFERRED", "PROFESSIONAL_INPUT", "UNKNOWN", "EXTERNAL_RESEARCH", "MANUFACTURER_CLAIM", "TREND_SIGNAL"]) {
      expect(isProfessionalLearningProvenanceSource(source)).toBe(true);
    }
    expect(isProfessionalLearningProvenanceSource("AI_LEARNED")).toBe(false);
  });

  describe("isValidExtraction", () => {
    it("accepts an empty extraction (no fields observed at all)", () => {
      expect(isValidExtraction({})).toBe(true);
    });

    it("accepts a well-formed OBSERVED field", () => {
      expect(isValidExtraction({ elevation: { value: "90 degrees", source: "OBSERVED", confidence: 0.9 } })).toBe(true);
    });

    it("accepts an explicit UNKNOWN field with a null value", () => {
      expect(isValidExtraction({ overdirection: { value: null, source: "UNKNOWN" } })).toBe(true);
    });

    it("rejects an UNKNOWN field that smuggles a concrete value -- UNKNOWN must remain UNKNOWN", () => {
      expect(isValidExtraction({ overdirection: { value: "forward", source: "UNKNOWN" } })).toBe(false);
    });

    it("Stage 8.5L4.R1.1: rejects an UNKNOWN field carrying an empty string -- an empty string is not a valid disguise for UNKNOWN", () => {
      expect(isValidExtraction({ overdirection: { value: "", source: "UNKNOWN" } })).toBe(false);
    });

    it("Stage 8.5L4.R1.1: accepts UNKNOWN with value omitted entirely (undefined), treated identically to null", () => {
      expect(isValidExtraction({ overdirection: { source: "UNKNOWN" } })).toBe(true);
    });

    it("Stage 8.5L4.R2.2: accepts an UNKNOWN field carrying a preserved rawObservation string", () => {
      expect(isValidExtraction({ elevation: { value: null, source: "UNKNOWN", rawObservation: "Angled diagram lines were visible." } })).toBe(true);
    });

    it("Stage 8.5L4.R2.2: rejects a non-string rawObservation", () => {
      expect(isValidExtraction({ elevation: { value: null, source: "UNKNOWN", rawObservation: 123 } })).toBe(false);
    });

    it("rejects an unknown/invented field name", () => {
      expect(isValidExtraction({ hairColorTrend: { value: "balayage", source: "OBSERVED" } })).toBe(false);
    });

    it("rejects an invalid provenance source", () => {
      expect(isValidExtraction({ tool: { value: "shears", source: "AI_LEARNED" } })).toBe(false);
    });

    it("rejects a confidence value outside [0, 1]", () => {
      expect(isValidExtraction({ tool: { value: "shears", source: "OBSERVED", confidence: 1.5 } })).toBe(false);
      expect(isValidExtraction({ tool: { value: "shears", source: "OBSERVED", confidence: -0.1 } })).toBe(false);
    });

    it("rejects a non-object payload", () => {
      expect(isValidExtraction(null)).toBe(false);
      expect(isValidExtraction("technique")).toBe(false);
      expect(isValidExtraction([])).toBe(false);
    });
  });
});
