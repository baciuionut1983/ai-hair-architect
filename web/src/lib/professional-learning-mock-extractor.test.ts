import { describe, expect, it } from "vitest";

import { mockProfessionalLearningExtractor, MOCK_EXTRACTOR_VERSION } from "./professional-learning-mock-extractor";
import { buildCanonicalCandidateSkillRegistry } from "./professional-brain-skill-templates";
import { isValidExtraction } from "./professional-learning-draft-validators";

const registry = buildCanonicalCandidateSkillRegistry();

function evidence(originalText: string, evidenceType: string = "TEXT") {
  return { evidenceId: "evidence-id", evidenceType, vertical: "hair", originalText };
}

describe("mockProfessionalLearningExtractor (Stage 8.5L4 mock/deterministic placeholder)", () => {
  it("exposes a stable extractorVersion", () => {
    expect(mockProfessionalLearningExtractor.extractorVersion).toBe(MOCK_EXTRACTOR_VERSION);
    expect(MOCK_EXTRACTOR_VERSION).toBe("mock-deterministic-v1");
  });

  it("makes zero provider/network calls -- purely synchronous string matching (Part 30)", async () => {
    const before = Date.now();
    await mockProfessionalLearningExtractor.extract({ evidence: evidence("Construct One-Length Perimeter, posterior, natural fall."), evidenceReferences: {}, relevantRegistry: registry });
    expect(Date.now() - before).toBeLessThan(50);
  });

  it("Part 23 fixture: One-Length evidence produces a valid extraction supporting the existing skill", async () => {
    const text =
      "We start in the posterior area and establish the contour that carries the length authority. " +
      "Sectioning uses horizontal partings, natural fall, no elevation. Progression is strand by strand, " +
      "and the previous cut strand remains visible as the guide for continuation on this One-Length Perimeter. " +
      "The sides connect to the posterior guide. We verify symmetry and continuous line, then recheck dry, natural fall.";

    const result = await mockProfessionalLearningExtractor.extract({ evidence: evidence(text), evidenceReferences: {}, relevantRegistry: registry });

    expect(result.discernment.category).toBe("PROFESSIONAL_TECHNIQUE");
    expect(result.comparisonSkillIdHint).toBe("skill-cutting-one-length-perimeter");
    expect(result.relatedSkillIdHints).toEqual(["skill-cutting-one-length-perimeter"]);
    expect(isValidExtraction(result.extraction)).toBe(true);
    expect(result.extraction.positioning?.source).toBe("OBSERVED");
    expect(result.extraction.sectioning?.source).toBe("OBSERVED");
    expect(result.extraction.elevation?.value).toBe("0 degrees (natural fall)");
    expect(result.extraction.guideType?.source).toBe("OBSERVED");
    expect(result.extraction.crossCheck?.source).toBe("OBSERVED");
    // Nothing invented for a field with no textual basis.
    expect(result.extraction.fingerAngle).toBeUndefined();
  });

  it("Part 24 fixture: a deliberate contradiction mentions both Slice-and-Slide and pure One-Length", async () => {
    const text = "Use Slice-and-Slide across a pure One-Length structure as the normal finishing method.";

    const result = await mockProfessionalLearningExtractor.extract({ evidence: evidence(text), evidenceReferences: {}, relevantRegistry: registry });

    expect(result.relatedSkillIdHints).toEqual(["skill-cutting-slice-and-slide-refinement", "skill-cutting-one-length-perimeter"]);
    expect(result.comparisonSkillIdHint).toBe("skill-cutting-slice-and-slide-refinement");
    expect(result.discernment.category).toBe("PROFESSIONAL_RULE");
    expect(isValidExtraction(result.extraction)).toBe(true);
  });

  it("Part 25 fixture: insufficient evidence with no geometry/technique produces INSUFFICIENT_EVIDENCE and an empty extraction", async () => {
    const result = await mockProfessionalLearningExtractor.extract({ evidence: evidence("Make the haircut softer."), evidenceReferences: {}, relevantRegistry: registry });

    expect(result.discernment.category).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.extraction).toEqual({});
    expect(result.comparisonSkillIdHint).toBeNull();
    expect(result.relatedSkillIdHints).toEqual([]);
  });

  it("Part 26 fixture: Butterfly haircut resolves to RESULT_REFERENCE with no skill hint", async () => {
    const result = await mockProfessionalLearningExtractor.extract({ evidence: evidence("Butterfly haircut."), evidenceReferences: {}, relevantRegistry: registry });

    expect(result.discernment.category).toBe("RESULT_REFERENCE");
    expect(result.comparisonSkillIdHint).toBeNull();
    expect(result.relatedSkillIdHints).toEqual([]);
    expect(isValidExtraction(result.extraction)).toBe(true);
  });

  it("never analyzes non-text evidence -- honestly reports insufficient evidence rather than fabricating an image/video analysis", async () => {
    const result = await mockProfessionalLearningExtractor.extract({
      evidence: evidence(null as unknown as string, "VIDEO"),
      evidenceReferences: { videoAssetId: "some-video-asset-id" },
      relevantRegistry: registry,
    });

    expect(result.discernment.category).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.extraction).toEqual({});
  });

  it("every produced extraction is structurally valid per isValidExtraction, for every fixture above", async () => {
    const texts = [
      "posterior, horizontal partings, natural fall, no elevation, strand by strand, previous cut strand, one-length, symmetry, recheck",
      "Use Slice-and-Slide across a pure One-Length structure.",
      "Make the haircut softer.",
      "Butterfly haircut.",
    ];
    for (const text of texts) {
      const result = await mockProfessionalLearningExtractor.extract({ evidence: evidence(text), evidenceReferences: {}, relevantRegistry: registry });
      expect(isValidExtraction(result.extraction)).toBe(true);
    }
  });
});
