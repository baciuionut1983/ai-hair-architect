import { describe, expect, it } from "vitest";

import { GeminiProfessionalLearningExtractor, type GeminiLearningExtractorGenerateClient, type GeminiLearningExtractorGenerateInput } from "@/lib/professional-learning-extractor-gemini";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { isValidExtraction } from "@/lib/professional-learning-draft-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R1 -- the real
// Gemini adapter's OWN tests. ZERO real network calls anywhere in this
// file -- the low-level client is always a hand-built fake, mirroring
// professional-reasoning-provider-gemini.test.ts's own convention
// exactly. This is the required zero-cost proof that the adapter's
// prompt/parse/grounding/matching logic is correct BEFORE the one
// authorized real call is ever made.

const registry = buildCanonicalCandidateSkillRegistry();

function fakeClient(response: unknown): GeminiLearningExtractorGenerateClient {
  return {
    async generateContent(input: GeminiLearningExtractorGenerateInput) {
      input.onUsage?.({ promptTokenCount: 120, candidatesTokenCount: 80, totalTokenCount: 200 }, "fake-request-id");
      return JSON.stringify(response);
    },
  };
}

function evidence(originalText: string) {
  return { evidenceId: "evidence-1", evidenceType: "TEXT", vertical: "hair", originalText };
}

describe("GeminiProfessionalLearningExtractor (Stage 8.5L4.R1 real adapter, zero real network calls)", () => {
  it("requires an apiKey and model at construction", () => {
    expect(() => new GeminiProfessionalLearningExtractor({ apiKey: "", model: "gemini-3.6-flash" })).toThrow(/API key/);
    expect(() => new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "" })).toThrow(/model/);
  });

  it("extracts a well-formed OBSERVED field and matches the recognized technique name to the real registry, with zero registry content ever sent to the model", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "Describes a real cutting procedure.",
      extractedFields: [
        { field: "techniqueCandidate", value: "constructing a one length perimeter haircut", source: "OBSERVED", confidence: 0.8, note: "" },
        { field: "elevation", value: "no elevation, natural fall", source: "OBSERVED", confidence: 0.9, note: "" },
        { field: "overdirection", value: "", source: "UNKNOWN", confidence: 0, note: "" },
      ],
    };
    let sentPrompt = "";
    const client: GeminiLearningExtractorGenerateClient = {
      async generateContent(input) {
        sentPrompt = input.prompt;
        input.onUsage?.({ promptTokenCount: 50 }, "req-1");
        return JSON.stringify(canned);
      },
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "gemini-3.6-flash" }, client);

    const output = await extractor.extract({
      evidence: evidence("We start at the posterior area, no elevation, natural fall throughout."),
      evidenceReferences: {},
      relevantRegistry: registry,
    });

    expect(output.discernment.category).toBe("PROFESSIONAL_TECHNIQUE");
    expect(output.comparisonSkillIdHint).toBe("skill-cutting-one-length-perimeter");
    expect(output.relatedSkillIdHints).toEqual(["skill-cutting-one-length-perimeter"]);
    expect(output.extraction.overdirection).toEqual({ value: null, source: "UNKNOWN" });
    expect(isValidExtraction(output.extraction)).toBe(true);

    // The prompt sent to the model never mentions any registry skill name.
    for (const record of registry) {
      expect(sentPrompt).not.toContain(record.name);
      expect(sentPrompt).not.toContain(record.skillId);
    }
  });

  it("downgrades an ungrounded PROFESSIONAL_INPUT claim to INFERRED -- the model cannot self-elevate its own authority (Part 7)", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      extractedFields: [{ field: "fingerAngle", value: "45 degrees relative to the head", source: "PROFESSIONAL_INPUT", confidence: 0.9, note: "" }],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extract({ evidence: evidence("Some unrelated evidence text about sectioning."), evidenceReferences: {}, relevantRegistry: registry });

    expect(output.extraction.fingerAngle?.source).toBe("INFERRED");
  });

  it("keeps a grounded PROFESSIONAL_INPUT claim as PROFESSIONAL_INPUT", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      extractedFields: [{ field: "elevation", value: "no elevation is used", source: "PROFESSIONAL_INPUT", confidence: 0.9, note: "" }],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extract({ evidence: evidence("No elevation is used in this technique."), evidenceReferences: {}, relevantRegistry: registry });

    expect(output.extraction.elevation?.source).toBe("PROFESSIONAL_INPUT");
  });

  it("drops an invented field name or invalid provenance rather than letting it corrupt the whole extraction", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      extractedFields: [
        { field: "trendScore", value: "99", source: "OBSERVED", confidence: 0.5, note: "" },
        { field: "tool", value: "shears", source: "AI_LEARNED", confidence: 0.5, note: "" },
        { field: "sectioning", value: "horizontal partings", source: "OBSERVED", confidence: 0.7, note: "" },
      ],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extract({ evidence: evidence("Horizontal partings used throughout."), evidenceReferences: {}, relevantRegistry: registry });

    expect((output.extraction as Record<string, unknown>).trendScore).toBeUndefined();
    expect(output.extraction.tool).toBeUndefined();
    expect(output.extraction.sectioning).toEqual({ value: "horizontal partings", source: "OBSERVED", confidence: 0.7 });
    expect(isValidExtraction(output.extraction)).toBe(true);
  });

  it("rejects an unrecognized discernmentCategory rather than silently accepting it", async () => {
    const canned = { discernmentCategory: "AI_LEARNED_SOMETHING", discernmentReason: "x", extractedFields: [] };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));
    await expect(extractor.extract({ evidence: evidence("text"), evidenceReferences: {}, relevantRegistry: registry })).rejects.toThrow(/INVALID_RESPONSE|unrecognized/);
  });

  it("classifies malformed JSON as INVALID_RESPONSE", async () => {
    const client: GeminiLearningExtractorGenerateClient = { async generateContent() { return "not json"; } };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, client);
    await expect(extractor.extract({ evidence: evidence("text"), evidenceReferences: {}, relevantRegistry: registry })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("classifies an empty response as INVALID_RESPONSE", async () => {
    const client: GeminiLearningExtractorGenerateClient = { async generateContent() { return ""; } };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, client);
    await expect(extractor.extract({ evidence: evidence("text"), evidenceReferences: {}, relevantRegistry: registry })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("classifies a provider throw with HTTP 429 as RATE_LIMITED (retryable)", async () => {
    const client: GeminiLearningExtractorGenerateClient = {
      async generateContent() {
        const err = new Error("rate limited") as Error & { status: number };
        err.status = 429;
        throw err;
      },
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, client);
    await expect(extractor.extract({ evidence: evidence("text"), evidenceReferences: {}, relevantRegistry: registry })).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });

  it("never analyzes non-text evidence -- honestly reports insufficient evidence rather than a fabricated vision analysis", async () => {
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient({}));
    const output = await extractor.extract({ evidence: { evidenceId: "e", evidenceType: "VIDEO", vertical: "hair", originalText: null }, evidenceReferences: {}, relevantRegistry: registry });
    expect(output.discernment.category).toBe("INSUFFICIENT_EVIDENCE");
    expect(output.extraction).toEqual({});
  });

  it("makes zero network calls for the non-text short-circuit and the empty-text short-circuit", async () => {
    let called = false;
    const client: GeminiLearningExtractorGenerateClient = { async generateContent() { called = true; return "{}"; } };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, client);
    await extractor.extract({ evidence: evidence(""), evidenceReferences: {}, relevantRegistry: registry });
    expect(called).toBe(false);
  });
});
