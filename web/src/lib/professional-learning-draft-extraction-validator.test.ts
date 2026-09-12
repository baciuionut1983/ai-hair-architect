import { describe, expect, it } from "vitest";

import { ProfessionalLearningExtractionValidationError, validateExtractorOutput } from "./professional-learning-draft-extraction-validator";
import type { ProfessionalLearningExtractorOutput } from "./professional-learning-extractor";

function baseOutput(overrides: Partial<ProfessionalLearningExtractorOutput> = {}): ProfessionalLearningExtractorOutput {
  return {
    discernment: { category: "PROFESSIONAL_TECHNIQUE", reason: "test" },
    extraction: { elevation: { value: "0 degrees natural fall", source: "OBSERVED" } },
    comparisonSkillIdHint: null,
    relatedSkillIdHints: [],
    ...overrides,
  };
}

describe("validateExtractorOutput (Part 21 strict validation, provider-agnostic)", () => {
  it("accepts a well-formed, textually-grounded extractor output unchanged", () => {
    const output = baseOutput();
    const result = validateExtractorOutput({ output, evidenceOriginalText: "No elevation, natural fall throughout." });
    expect(result).toBe(output);
  });

  it("rejects an invented discernment category", () => {
    const output = baseOutput({ discernment: { category: "AI_LEARNED_SOMETHING" as never, reason: "x" } });
    expect(() => validateExtractorOutput({ output, evidenceOriginalText: "text" })).toThrow(ProfessionalLearningExtractionValidationError);
  });

  it("rejects an extraction with an invented field name", () => {
    const output = baseOutput({ extraction: { trendScore: { value: 99, source: "OBSERVED" } } as never });
    expect(() => validateExtractorOutput({ output, evidenceOriginalText: "text" })).toThrowError(
      expect.objectContaining({ code: "INVALID_EXTRACTION_SHAPE" }),
    );
  });

  it("rejects an UNKNOWN field that smuggles a concrete value", () => {
    const output = baseOutput({ extraction: { overdirection: { value: "45 degrees", source: "UNKNOWN" } } });
    expect(() => validateExtractorOutput({ output, evidenceOriginalText: "text" })).toThrowError(
      expect.objectContaining({ code: "INVALID_EXTRACTION_SHAPE" }),
    );
  });

  it("rejects internally inconsistent skill hints (comparisonSkillIdHint not equal to relatedSkillIdHints[0])", () => {
    const output = baseOutput({ comparisonSkillIdHint: "skill-cutting-graduated", relatedSkillIdHints: ["skill-cutting-one-length-perimeter"] });
    expect(() => validateExtractorOutput({ output, evidenceOriginalText: "text" })).toThrowError(
      expect.objectContaining({ code: "INCONSISTENT_SKILL_HINTS" }),
    );
  });

  it("rejects a non-null relatedSkillIdHints with a null comparisonSkillIdHint", () => {
    const output = baseOutput({ comparisonSkillIdHint: null, relatedSkillIdHints: ["skill-cutting-graduated"] });
    expect(() => validateExtractorOutput({ output, evidenceOriginalText: "text" })).toThrowError(
      expect.objectContaining({ code: "INCONSISTENT_SKILL_HINTS" }),
    );
  });

  it("rejects a fabricated OBSERVED claim that shares no vocabulary with the evidence's own text -- this is the core anti-hallucination test", () => {
    const output = baseOutput({ extraction: { tool: { value: "razor comb technique", source: "OBSERVED" } } });
    expect(() => validateExtractorOutput({ output, evidenceOriginalText: "We use horizontal partings and natural fall, no elevation." })).toThrowError(
      expect.objectContaining({ code: "UNGROUNDED_OBSERVATION" }),
    );
  });

  it("does not reject an INFERRED claim for the same lack of grounding -- inference is explicitly allowed to go beyond literal text", () => {
    const output = baseOutput({ extraction: { guideType: { value: "razor comb technique", source: "INFERRED" } } });
    expect(() => validateExtractorOutput({ output, evidenceOriginalText: "We use horizontal partings." })).not.toThrow();
  });

  it("does not reject a PROFESSIONAL_INPUT claim for lack of textual grounding -- a professional's own stated correction is not required to already appear in prior text", () => {
    const output = baseOutput({ extraction: { fingerPosition: { value: "pointing downward", source: "PROFESSIONAL_INPUT" } } });
    expect(() => validateExtractorOutput({ output, evidenceOriginalText: "unrelated text" })).not.toThrow();
  });
});
