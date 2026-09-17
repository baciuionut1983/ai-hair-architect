import { describe, expect, it } from "vitest";

import {
  GEMINI_LEARNING_EXTRACTOR_VIDEO_MIN_TIMEOUT_MS,
  GeminiProfessionalLearningExtractor,
  type GeminiLearningExtractorGenerateClient,
  type GeminiLearningExtractorGenerateInput,
} from "@/lib/professional-learning-extractor-gemini";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { isValidExtraction } from "@/lib/professional-learning-draft-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R1 -- the real
// Gemini adapter's VIDEO path, tested with ZERO real network calls (a
// hand-built fake client, mirroring professional-learning-extractor-
// gemini-image.test.ts exactly). Proves the File API upload/videoPart
// transport, registry/technique non-disclosure (BLIND TEST RULE),
// PROFESSIONAL_INPUT authority protection, and segments/time-range
// interop with the Stage 8.5L4 placeholder shape -- all BEFORE the one
// authorized real video call is ever made.

const registry = buildCanonicalCandidateSkillRegistry();

function fakeClient(
  response: unknown,
  options?: { capture?: (input: GeminiLearningExtractorGenerateInput) => void; uploaded?: { fileUri: string; mimeType: string }; uploadCalls?: { count: number } },
): GeminiLearningExtractorGenerateClient {
  return {
    async generateContent(input) {
      options?.capture?.(input);
      input.onUsage?.({ promptTokenCount: 500, candidatesTokenCount: 200, totalTokenCount: 700 }, "fake-video-request-id");
      return JSON.stringify(response);
    },
    async uploadVideoFile() {
      if (options?.uploadCalls) options.uploadCalls.count += 1;
      return options?.uploaded ?? { fileUri: "https://generativelanguage.googleapis.com/files/fake-video-1", mimeType: "video/mp4" };
    },
  };
}

function videoEvidence(professionalNote?: string | null) {
  return { evidenceId: "evidence-video-1", evidenceType: "VIDEO", vertical: "hair", originalText: null, professionalNote };
}

const dummyVideoMedia = { buffer: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4]), mimeType: "video/mp4" };

describe("GeminiProfessionalLearningExtractor -- VIDEO path (Stage 8.5L5.R1, zero real network calls)", () => {
  it("uploads the video via the File API and sends a fileData videoPart referencing the uploaded file -- never the registry, never a technique name", async () => {
    let captured: GeminiLearningExtractorGenerateInput | undefined;
    const uploadCalls = { count: 0 };
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "Shows an in-progress cutting technique.",
      temporalObservations: [{ timeStartSeconds: 0, timeEndSeconds: 5, observation: "comb passes through a section of hair" }],
      actionCandidates: [{ timeStartSeconds: 5, timeEndSeconds: 10, kind: "CUTTING_ACTION" }],
      notableEditsOrCuts: [],
      extractedFields: [{ field: "sectioning", value: "horizontal partings visible", source: "OBSERVED", confidence: 0.8, note: "", timeStartSeconds: 0, timeEndSeconds: 5 }],
    };
    const extractor = new GeminiProfessionalLearningExtractor(
      { apiKey: "key", model: "gemini-3.6-flash" },
      fakeClient(canned, { capture: (input) => (captured = input), uploaded: { fileUri: "https://files.example/fake-video-1", mimeType: "video/mp4" }, uploadCalls }),
    );

    const output = await extractor.extract({ evidence: videoEvidence(), evidenceReferences: {}, relevantRegistry: registry, videoMedia: dummyVideoMedia });

    expect(uploadCalls.count).toBe(1);
    expect(captured?.videoPart).toEqual({ mimeType: "video/mp4", fileUri: "https://files.example/fake-video-1" });
    expect(captured?.imagePart).toBeUndefined();
    for (const record of registry) {
      expect(captured?.prompt ?? "").not.toContain(record.name);
      expect(captured?.prompt ?? "").not.toContain(record.skillId);
    }
    // BLIND TEST RULE (Section 1): no named technique ever appears in the
    // prompt sent to the provider.
    for (const forbidden of ["One-Length", "Graduated Cutting", "Slice-and-Slide", "Butterfly"]) {
      expect(captured?.prompt ?? "").not.toContain(forbidden);
    }
    expect(isValidExtraction(output.extraction)).toBe(true);
    expect(output.extraction.sectioning?.source).toBe("OBSERVED");
  });

  it("does not pre-answer the video -- the prompt never describes what the video supposedly shows, only instructs to watch it", async () => {
    let captured: GeminiLearningExtractorGenerateInput | undefined;
    const extractor = new GeminiProfessionalLearningExtractor(
      { apiKey: "key", model: "m" },
      fakeClient(
        { discernmentCategory: "INSUFFICIENT_EVIDENCE", discernmentReason: "x", temporalObservations: [], actionCandidates: [], notableEditsOrCuts: [], extractedFields: [] },
        { capture: (input) => (captured = input) },
      ),
    );
    await extractor.extract({ evidence: videoEvidence(), evidenceReferences: {}, relevantRegistry: registry, videoMedia: dummyVideoMedia });

    expect(captured?.prompt).not.toMatch(/graduated|one-length|slice-and-slide/i);
    expect(captured?.prompt).toContain("Watch and listen to it directly");
  });

  it("returns INSUFFICIENT_EVIDENCE with zero network/upload calls when no video media was resolved", async () => {
    let generateCalled = false;
    let uploadCalled = false;
    const client: GeminiLearningExtractorGenerateClient = {
      async generateContent() {
        generateCalled = true;
        return "{}";
      },
      async uploadVideoFile() {
        uploadCalled = true;
        return { fileUri: "x", mimeType: "video/mp4" };
      },
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, client);

    const output = await extractor.extract({ evidence: videoEvidence(), evidenceReferences: {}, relevantRegistry: registry });

    expect(generateCalled).toBe(false);
    expect(uploadCalled).toBe(false);
    expect(output.discernment.category).toBe("INSUFFICIENT_EVIDENCE");
    expect(output.extraction).toEqual({});
  });

  it("fails closed with a clear provider error when the client does not implement video upload", async () => {
    const client: GeminiLearningExtractorGenerateClient = { async generateContent() { return "{}"; } };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, client);

    await expect(extractor.extract({ evidence: videoEvidence(), evidenceReferences: {}, relevantRegistry: registry, videoMedia: dummyVideoMedia })).rejects.toThrow();
  });

  it("surfaces temporalObservations/actionCandidates/notableEditsOrCuts on the output, untouched", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      temporalObservations: [
        { timeStartSeconds: 0, timeEndSeconds: 5, observation: "comb passes through a section" },
        { timeStartSeconds: 5, timeEndSeconds: 9, observation: "scissors visibly close near the ends" },
      ],
      actionCandidates: [{ timeStartSeconds: 5, timeEndSeconds: 9, kind: "CUTTING_ACTION" }],
      notableEditsOrCuts: [{ beforeTimeSeconds: 9, afterTimeSeconds: 40 }],
      extractedFields: [],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extract({ evidence: videoEvidence(), evidenceReferences: {}, relevantRegistry: registry, videoMedia: dummyVideoMedia });

    expect(output.temporalObservations).toHaveLength(2);
    expect(output.actionCandidates).toEqual([{ timeStartSeconds: 5, timeEndSeconds: 9, kind: "CUTTING_ACTION" }]);
    expect(output.notableEditsOrCuts).toEqual([{ beforeTimeSeconds: 9, afterTimeSeconds: 40 }]);
  });

  it("attaches a real time range as `segments` (the existing Stage 8.5L4 shape), and omits it for the -1/-1 sentinel", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      temporalObservations: [],
      actionCandidates: [],
      notableEditsOrCuts: [],
      extractedFields: [
        { field: "sectioning", value: "horizontal partings visible", source: "OBSERVED", confidence: 0.8, note: "", timeStartSeconds: 2, timeEndSeconds: 7 },
        { field: "techniqueCandidate", value: "some cutting technique", source: "INFERRED", confidence: 0.5, note: "", timeStartSeconds: -1, timeEndSeconds: -1 },
      ],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extract({ evidence: videoEvidence(), evidenceReferences: {}, relevantRegistry: registry, videoMedia: dummyVideoMedia });

    expect(output.extraction.sectioning?.segments).toEqual([{ timeStartSeconds: 2, timeEndSeconds: 7, relevance: 1 }]);
    expect(output.extraction.techniqueCandidate?.segments).toBeUndefined();
  });

  it("Part 8 parity: a PROFESSIONAL_INPUT claim grounded in the SEPARATE professional note is kept as PROFESSIONAL_INPUT", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      temporalObservations: [],
      actionCandidates: [],
      notableEditsOrCuts: [],
      extractedFields: [{ field: "guideType", value: "a travelling guide", source: "PROFESSIONAL_INPUT", confidence: 0.9, note: "", timeStartSeconds: -1, timeEndSeconds: -1 }],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extract({
      evidence: videoEvidence("This is a travelling guide."),
      evidenceReferences: {},
      relevantRegistry: registry,
      videoMedia: dummyVideoMedia,
    });

    expect(output.extraction.guideType).toEqual({ value: "a travelling guide", source: "PROFESSIONAL_INPUT", confidence: 0.9 });
  });

  it("Part 8 parity: the model's OWN video reading can never self-promote to PROFESSIONAL_INPUT when no professional note exists", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      temporalObservations: [],
      actionCandidates: [],
      notableEditsOrCuts: [],
      extractedFields: [{ field: "guideType", value: "a travelling guide", source: "PROFESSIONAL_INPUT", confidence: 0.9, note: "", timeStartSeconds: -1, timeEndSeconds: -1 }],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extract({ evidence: videoEvidence(null), evidenceReferences: {}, relevantRegistry: registry, videoMedia: dummyVideoMedia });

    expect(output.extraction.guideType?.source).toBe("INFERRED");
  });

  it("still matches a recognized technique name to the real registry from a video extraction", async () => {
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      temporalObservations: [],
      actionCandidates: [],
      notableEditsOrCuts: [],
      extractedFields: [{ field: "techniqueCandidate", value: "graduated cutting", source: "INFERRED", confidence: 0.6, note: "", timeStartSeconds: -1, timeEndSeconds: -1 }],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned));

    const output = await extractor.extract({ evidence: videoEvidence(), evidenceReferences: {}, relevantRegistry: registry, videoMedia: dummyVideoMedia });

    expect(output.comparisonSkillIdHint).toBe("skill-cutting-graduated");
  });

  it("rejects a malformed video response (missing temporalObservations) rather than silently proceeding", async () => {
    const extractor = new GeminiProfessionalLearningExtractor(
      { apiKey: "key", model: "m" },
      fakeClient({ discernmentCategory: "PROFESSIONAL_TECHNIQUE", discernmentReason: "x", extractedFields: [] }),
    );
    await expect(extractor.extract({ evidence: videoEvidence(), evidenceReferences: {}, relevantRegistry: registry, videoMedia: dummyVideoMedia })).rejects.toThrow();
  });

  // T1.1 Issue #1, Fix 2 -- the SDK's own internal HTTP timeout for the
  // analyze call must actually receive the widened ~3-minute video
  // floor, not the shorter default/configured timeoutMs the extractor
  // was constructed with. Before this fix, generateContent's input never
  // carried a per-call override at all, so a real client would have
  // silently kept using the shorter construction-time value here.
  it("passes the widened ~180s video floor as generateContent's own effective timeoutMs when constructed with the (shorter) default", async () => {
    let captured: GeminiLearningExtractorGenerateInput | undefined;
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      temporalObservations: [],
      actionCandidates: [],
      notableEditsOrCuts: [],
      extractedFields: [],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "key", model: "m" }, fakeClient(canned, { capture: (input) => (captured = input) }));

    await extractor.extract({ evidence: videoEvidence(), evidenceReferences: {}, relevantRegistry: registry, videoMedia: dummyVideoMedia });

    expect(captured?.timeoutMs).toBe(GEMINI_LEARNING_EXTRACTOR_VIDEO_MIN_TIMEOUT_MS);
  });

  it("never clamps DOWN an explicitly configured timeout that is already longer than the video floor", async () => {
    let captured: GeminiLearningExtractorGenerateInput | undefined;
    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "test",
      temporalObservations: [],
      actionCandidates: [],
      notableEditsOrCuts: [],
      extractedFields: [],
    };
    const longerTimeoutMs = GEMINI_LEARNING_EXTRACTOR_VIDEO_MIN_TIMEOUT_MS + 60_000;
    const extractor = new GeminiProfessionalLearningExtractor(
      { apiKey: "key", model: "m", timeoutMs: longerTimeoutMs },
      fakeClient(canned, { capture: (input) => (captured = input) }),
    );

    await extractor.extract({ evidence: videoEvidence(), evidenceReferences: {}, relevantRegistry: registry, videoMedia: dummyVideoMedia });

    expect(captured?.timeoutMs).toBe(longerTimeoutMs);
  });
});
