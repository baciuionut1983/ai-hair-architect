import { describe, expect, it } from "vitest";

import { GeminiProfessionalLearningExtractor, type GeminiLearningExtractorGenerateClient, type GeminiLearningExtractorGenerateInput } from "@/lib/professional-learning-extractor-gemini";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { isValidExtraction } from "@/lib/professional-learning-draft-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R2 -- the real
// Gemini adapter's IMAGE/DIAGRAM path, tested with ZERO real network
// calls (a hand-built fake client, mirroring every prior real-adapter
// test in this repo). Proves the multimodal request construction,
// registry non-disclosure, and PROFESSIONAL_INPUT authority protection
// (grounded against the professional's own note, never the image)
// BEFORE the one authorized real multimodal call is ever made.

const registry = buildCanonicalCandidateSkillRegistry();

function fakeClient(response: unknown, capture?: (input: GeminiLearningExtractorGenerateInput) => void): GeminiLearningExtractorGenerateClient {
  return {
    async generateContent(input) {
      capture?.(input);
      input.onUsage?.({ promptTokenCount: 300, candidatesTokenCount: 150, totalTokenCount: 450 }, "fake-image-request-id");
      return JSON.stringify(response);
    },
  };
}

function imageEvidence(professionalNote?: string | null) {
  return { evidenceId: "evidence-image-1", evidenceType: "IMAGE", vertical: "hair", originalText: null, professionalNote };
}

const dummyImageMedia = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 4]), mimeType: "image/jpeg" };

describe("GeminiProfessionalLearningExtractor -- IMAGE/DIAGRAM path (Stage 8.5L4.R2, zero real network calls)", () => {
  it("sends the image as a base64 inlineData part alongside the image-specific prompt, and never sends the registry", async () => {
    let captured: GeminiLearningExtractorGenerateInput | undefined;
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "Shows an in-progress sectioning technique.",
      extractedFields: [{ field: "sectioning", value: "horizontal partings visible", source: "OBSERVED", confidence: 0.8, note: "" }],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "gemini-3.6-flash" }, fakeClient(canned, (input) => (captured = input)));

    const output = await extractor.extract({ evidence: imageEvidence(), evidenceReferences: {}, relevantRegistry: registry, imageMedia: dummyImageMedia });

    expect(captured?.imagePart).toEqual({ mimeType: "image/jpeg", data: dummyImageMedia.buffer.toString("base64") });
    for (const record of registry) {
      expect(captured?.prompt ?? "").not.toContain(record.name);
      expect(captured?.prompt ?? "").not.toContain(record.skillId);
    }
    expect(isValidExtraction(output.extraction)).toBe(true);
    expect(output.extraction.sectioning?.source).toBe("OBSERVED");
  });

  it("does not pre-answer the image -- the prompt never contains a description of what the image supposedly shows (Part 7)", async () => {
    let captured: GeminiLearningExtractorGenerateInput | undefined;
    const extractor = new GeminiProfessionalLearningExtractor(
      { apiKey: "key", model: "m" },
      fakeClient({ discernmentCategory: "INSUFFICIENT_EVIDENCE", discernmentReason: "x", extractedFields: [] }, (input) => (captured = input)),
    );
    await extractor.extract({ evidence: imageEvidence(), evidenceReferences: {}, relevantRegistry: registry, imageMedia: dummyImageMedia });

    expect(captured?.prompt).not.toMatch(/horizontal sectioning at 0/i);
    expect(captured?.prompt).toContain("Inspect it directly");
  });

  it("returns INSUFFICIENT_EVIDENCE with zero network calls when no image media was resolved", async () => {
    let called = false;
    const client: GeminiLearningExtractorGenerateClient = { async generateContent() { called = true; return "{}"; } };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, client);

    const output = await extractor.extract({ evidence: imageEvidence(), evidenceReferences: {}, relevantRegistry: registry });

    expect(called).toBe(false);
    expect(output.discernment.category).toBe("INSUFFICIENT_EVIDENCE");
    expect(output.extraction).toEqual({});
  });

  it("Part 8: a PROFESSIONAL_INPUT claim grounded in the SEPARATE professional note is kept as PROFESSIONAL_INPUT", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      extractedFields: [{ field: "guideType", value: "a travelling guide", source: "PROFESSIONAL_INPUT", confidence: 0.9, note: "" }],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extract({
      evidence: imageEvidence("This is a travelling guide."),
      evidenceReferences: {},
      relevantRegistry: registry,
      imageMedia: dummyImageMedia,
    });

    expect(output.extraction.guideType).toEqual({ value: "a travelling guide", source: "PROFESSIONAL_INPUT", confidence: 0.9 });
  });

  it("Part 8: the model's OWN visual guess can never self-promote to PROFESSIONAL_INPUT when no professional note exists at all", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      extractedFields: [{ field: "guideType", value: "a travelling guide", source: "PROFESSIONAL_INPUT", confidence: 0.9, note: "" }],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extract({ evidence: imageEvidence(null), evidenceReferences: {}, relevantRegistry: registry, imageMedia: dummyImageMedia });

    expect(output.extraction.guideType?.source).toBe("INFERRED");
  });

  it("Part 8: a PROFESSIONAL_INPUT claim NOT actually grounded in the supplied note is downgraded to INFERRED", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      extractedFields: [{ field: "elevation", value: "45 degrees", source: "PROFESSIONAL_INPUT", confidence: 0.9, note: "" }],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extract({
      evidence: imageEvidence("This is a travelling guide."),
      evidenceReferences: {},
      relevantRegistry: registry,
      imageMedia: dummyImageMedia,
    });

    expect(output.extraction.elevation?.source).toBe("INFERRED");
  });

  it("still matches a recognized technique name to the real registry from an image extraction", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      extractedFields: [{ field: "techniqueCandidate", value: "graduated cutting", source: "INFERRED", confidence: 0.6, note: "" }],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extract({ evidence: imageEvidence(), evidenceReferences: {}, relevantRegistry: registry, imageMedia: dummyImageMedia });

    expect(output.comparisonSkillIdHint).toBe("skill-cutting-graduated");
  });

  it("rejects an unrecognized discernmentCategory from the image path exactly like the text path", async () => {
    const extractor = new GeminiProfessionalLearningExtractor(
      { apiKey: "key", model: "m" },
      fakeClient({ discernmentCategory: "SOMETHING_INVENTED", discernmentReason: "x", extractedFields: [] }),
    );
    await expect(extractor.extract({ evidence: imageEvidence(), evidenceReferences: {}, relevantRegistry: registry, imageMedia: dummyImageMedia })).rejects.toThrow();
  });

  it("drops an invalid field/provenance from the image path rather than corrupting the whole extraction", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      extractedFields: [
        { field: "brandName", value: "SomeBrand", source: "OBSERVED", confidence: 0.9, note: "" },
        { field: "tool", value: "scissors", source: "OBSERVED", confidence: 0.9, note: "" },
      ],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extract({ evidence: imageEvidence(), evidenceReferences: {}, relevantRegistry: registry, imageMedia: dummyImageMedia });

    expect((output.extraction as Record<string, unknown>).brandName).toBeUndefined();
    expect(output.extraction.tool).toEqual({ value: "scissors", source: "OBSERVED", confidence: 0.9 });
  });
});
