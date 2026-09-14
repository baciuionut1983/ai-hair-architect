import { describe, expect, it } from "vitest";

import { GeminiProfessionalLearningExtractor, type GeminiLearningExtractorGenerateClient, type GeminiLearningExtractorGenerateInput } from "@/lib/professional-learning-extractor-gemini";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R2 -- the
// bounded-window video extraction path, tested with ZERO real network
// calls. Mirrors professional-learning-extractor-gemini-video.test.ts's
// own fixture pattern. Proves: one upload is reusable across many
// windowed calls, videoMetadata offsets are sent correctly, the neutral
// windowed-clip clarification is present (never a technique/registry
// hint), and registry blindness is preserved exactly like the L5.R1 path.

const registry = buildCanonicalCandidateSkillRegistry();

function fakeClient(response: unknown, options?: { capture?: (input: GeminiLearningExtractorGenerateInput) => void; uploadCalls?: { count: number } }): GeminiLearningExtractorGenerateClient {
  return {
    async generateContent(input) {
      options?.capture?.(input);
      input.onUsage?.({ promptTokenCount: 400, candidatesTokenCount: 150, totalTokenCount: 550 }, "fake-window-request-id");
      return JSON.stringify(response);
    },
    async uploadVideoFile() {
      if (options?.uploadCalls) options.uploadCalls.count += 1;
      return { fileUri: "https://files.example/fake-long-video-1", mimeType: "video/mp4" };
    },
  };
}

const emptyVideoResponse = { discernmentCategory: "INSUFFICIENT_EVIDENCE", discernmentReason: "x", temporalObservations: [], actionCandidates: [], notableEditsOrCuts: [], extractedFields: [] };

describe("GeminiProfessionalLearningExtractor -- bounded-window video path (Stage 8.5L5.R2, zero real network calls)", () => {
  it("uploads exactly once and reuses the same fileUri across multiple windowed calls", async () => {
    const uploadCalls = { count: 0 };
    const client = fakeClient(emptyVideoResponse, { uploadCalls });
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, client);

    const uploaded = await extractor.uploadVideoForWindowedAnalysis({ buffer: Buffer.from([1, 2, 3, 4]), mimeType: "video/mp4" });
    expect(uploadCalls.count).toBe(1);

    await extractor.extractVideoWindow({ fileUri: uploaded.fileUri, mimeType: uploaded.mimeType, startOffsetSeconds: 0, endOffsetSeconds: 154, relevantRegistry: registry });
    await extractor.extractVideoWindow({ fileUri: uploaded.fileUri, mimeType: uploaded.mimeType, startOffsetSeconds: 114, endOffsetSeconds: 288, relevantRegistry: registry });

    // Still exactly one upload -- two extraction calls reused it.
    expect(uploadCalls.count).toBe(1);
  });

  it("sends the exact requested window offsets as videoPart.startOffsetSeconds/endOffsetSeconds", async () => {
    let captured: GeminiLearningExtractorGenerateInput | undefined;
    const client = fakeClient(emptyVideoResponse, { capture: (input) => (captured = input) });
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, client);

    await extractor.extractVideoWindow({ fileUri: "https://files.example/x", mimeType: "video/mp4", startOffsetSeconds: 114, endOffsetSeconds: 288, relevantRegistry: registry });

    expect(captured?.videoPart).toEqual({ mimeType: "video/mp4", fileUri: "https://files.example/x", startOffsetSeconds: 114, endOffsetSeconds: 288 });
  });

  it("the prompt contains the neutral windowed-clip clarification, never a technique/registry hint", async () => {
    let captured: GeminiLearningExtractorGenerateInput | undefined;
    const client = fakeClient(emptyVideoResponse, { capture: (input) => (captured = input) });
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, client);

    await extractor.extractVideoWindow({ fileUri: "https://files.example/x", mimeType: "video/mp4", startOffsetSeconds: 0, endOffsetSeconds: 154, relevantRegistry: registry });

    expect(captured?.prompt).toContain("BOUNDED EXCERPT OF A LONGER SOURCE VIDEO");
    expect(captured?.prompt).toContain("RELATIVE TO THIS CLIP");
    for (const record of registry) {
      expect(captured?.prompt ?? "").not.toContain(record.name);
      expect(captured?.prompt ?? "").not.toContain(record.skillId);
    }
    // NOTE: "guide" and "elevation"/"distribution" etc. legitimately
    // appear in the system instruction's own anti-labeling rule ("do not
    // use interpretive professional vocabulary... no elevation,
    // distribution, overdirection, guide, sectioning as labels") -- that
    // is a safety instruction, not priming, so it is deliberately NOT
    // checked here. What genuinely must never appear is a specific named
    // technique/haircut/registry entry.
    for (const forbidden of ["One-Length", "Graduated Cutting", "Slice-and-Slide", "Butterfly", "bob", "perimeter", "0 degrees"]) {
      expect((captured?.prompt ?? "").toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("a plain (non-windowed) extractFromVideo call via extract() never gets the windowed-clip clarification -- L5.R1 behavior unchanged", async () => {
    let captured: GeminiLearningExtractorGenerateInput | undefined;
    const client = fakeClient(emptyVideoResponse, { capture: (input) => (captured = input) });
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, client);

    await extractor.extract({
      evidence: { evidenceId: "e", evidenceType: "VIDEO", vertical: "hair", originalText: null },
      evidenceReferences: {},
      relevantRegistry: registry,
      videoMedia: { buffer: Buffer.from([1, 2, 3, 4]), mimeType: "video/mp4" },
    });

    expect(captured?.prompt).not.toContain("BOUNDED EXCERPT");
    expect(captured?.videoPart?.startOffsetSeconds).toBeUndefined();
  });

  it("still matches a recognized technique name from a windowed call to the real registry", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      temporalObservations: [],
      actionCandidates: [],
      notableEditsOrCuts: [],
      extractedFields: [{ field: "techniqueCandidate", value: "graduated cutting", source: "INFERRED", confidence: 0.6, note: "", timeStartSeconds: -1, timeEndSeconds: -1 }],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extractVideoWindow({ fileUri: "https://files.example/x", mimeType: "video/mp4", startOffsetSeconds: 0, endOffsetSeconds: 154, relevantRegistry: registry });

    expect(output.comparisonSkillIdHint).toBe("skill-cutting-graduated");
  });

  it("fails closed when the client does not implement upload, without ever calling generateContent", async () => {
    let generateCalled = false;
    const client: GeminiLearningExtractorGenerateClient = {
      async generateContent() {
        generateCalled = true;
        return "{}";
      },
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, client);

    await expect(extractor.uploadVideoForWindowedAnalysis({ buffer: Buffer.from([1]), mimeType: "video/mp4" })).rejects.toThrow();
    expect(generateCalled).toBe(false);
  });
});
