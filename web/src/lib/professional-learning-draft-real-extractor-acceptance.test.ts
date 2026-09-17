import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { processEvidenceIntoDraft } from "@/lib/professional-learning-draft-service";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { GeminiProfessionalLearningExtractor, type GeminiLearningExtractorGenerateClient } from "@/lib/professional-learning-extractor-gemini";
import { saveImageFile, deleteImageFile } from "@/lib/image-storage";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.1 -- proves the
// REAL extractor class (not the mock) flows correctly through the REAL,
// unmodified processEvidenceIntoDraft pipeline and into a REAL
// ProfessionalLearningDraft row, against real Postgres. ZERO real network
// calls: the Gemini SDK client itself is a hand-built fake (the SAME
// convention professional-learning-extractor-gemini.test.ts's own
// fakeClient already uses) -- extractor.extract() runs its full real
// prompt-build/parse/validate/registry-match logic, only the actual HTTP
// call is replaced. Mirrors professional-learning-draft-acceptance.test.ts's
// own real-DB fixture discipline exactly (same createOwner/textInput
// helpers, same afterEach cleanup).
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();
const localVideoPaths = new Set<string>();
const registry = buildCanonicalCandidateSkillRegistry();
const FAKE_MP4_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 1, 2, 3, 4]);

function fakeGeminiClient(cannedJson: unknown): GeminiLearningExtractorGenerateClient {
  return {
    async generateContent() {
      return JSON.stringify(cannedJson);
    },
  };
}

function fakeGeminiVideoClient(cannedJson: unknown): GeminiLearningExtractorGenerateClient {
  return {
    async generateContent() {
      return JSON.stringify(cannedJson);
    },
    async uploadVideoFile() {
      return { fileUri: "https://files.example/fake-video-1", mimeType: "video/mp4" };
    },
  };
}

suite("Stage 8.5T1.1 -- real Gemini extractor class through the real draft pipeline (zero real network calls)", () => {
  afterEach(async () => {
    for (const path of localVideoPaths) {
      await deleteImageFile(path).catch(() => undefined);
    }
    localVideoPaths.clear();
    const ownerUserIds = [...owners];
    await prisma.professionalLearningDraft.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("a real provider success produces a real, persisted draft through the existing, unmodified pipeline", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createLearningEvidence(
      ownerUserId,
      textInput("We start in the posterior area, natural fall, no elevation, strand by strand, the previous cut strand remains visible as the guide."),
    );

    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "Describes a real cutting procedure.",
      extractedFields: [
        { field: "elevation", value: "no elevation, natural fall", source: "OBSERVED", confidence: 0.9, note: "" },
        { field: "professionalRationale", value: "likely intended to preserve perimeter weight", source: "INFERRED", confidence: 0.4, note: "" },
        { field: "overdirection", value: "", source: "UNKNOWN", confidence: 0, note: "" },
      ],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "fake-test-key-never-a-real-secret", model: "gemini-3.6-flash" }, fakeGeminiClient(canned));

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") throw new Error("expected created");
    expect(outcome.draft.extractorVersion).toBe("gemini-real-v1:gemini-3.6-flash");

    // Provenance survives integration EXACTLY as the (fake) provider
    // reported it -- never upgraded, never downgraded, never rewritten.
    expect(outcome.draft.extraction.elevation).toMatchObject({ value: "no elevation, natural fall", source: "OBSERVED" });
    expect(outcome.draft.extraction.professionalRationale).toMatchObject({ source: "INFERRED" });
    expect(outcome.draft.extraction.professionalRationale?.source).not.toBe("OBSERVED"); // INFERRED never silently upgraded
    expect(outcome.draft.extraction.overdirection).toEqual({ value: null, source: "UNKNOWN" });

    // No AI-generated claim in this test (no professional note supplied)
    // is ever labeled PROFESSIONAL_INPUT.
    for (const field of Object.values(outcome.draft.extraction)) {
      expect(field?.source).not.toBe("PROFESSIONAL_INPUT");
    }

    // The draft round-trips from the real DB unchanged.
    const persisted = await prisma.professionalLearningDraft.findUnique({ where: { id: outcome.draft.id } });
    expect(persisted?.extractorVersion).toBe("gemini-real-v1:gemini-3.6-flash");

    // Zero active-knowledge mutation occurred merely because a real
    // extraction + draft creation happened.
    const skillRows = await prisma.professionalSkillDefinition.count();
    expect(skillRows).toBe(0);
  });

  // T1.2 -- TEMPORAL OBSERVATION PRESERVATION. Proves the full path the
  // real production draft actually takes: real VIDEO evidence -> real
  // GeminiProfessionalLearningExtractor -> processEvidenceIntoDraft ->
  // real Postgres, with temporal evidence now surviving all the way to
  // the persisted, reloadable draft record instead of being discarded.
  it("a real VIDEO provider success preserves temporal observations/actions/edit-gaps into the persisted draft, alongside the unchanged scalar extraction", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const assetId = randomUUID();
    const storagePath = await saveImageFile(ownerUserId, assetId, "video.mp4", FAKE_MP4_BYTES);
    localVideoPaths.add(storagePath);
    await prisma.videoAsset.create({
      data: { id: assetId, ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: FAKE_MP4_BYTES.length, storagePath, storageBackend: null, origin: "uploaded_source" },
    });
    const evidence = await createLearningEvidence(ownerUserId, videoInput(assetId));

    const canned = {
      discernmentCategory: "PROFESSIONAL_TECHNIQUE",
      discernmentReason: "Shows an in-progress cutting technique.",
      temporalObservations: [
        { timeStartSeconds: 0, timeEndSeconds: 5, observation: "comb passes through a section of hair" },
        { timeStartSeconds: 5, timeEndSeconds: 9, observation: "scissors visibly close near the ends" },
      ],
      actionCandidates: [{ timeStartSeconds: 5, timeEndSeconds: 9, kind: "CUTTING_ACTION" }],
      notableEditsOrCuts: [{ beforeTimeSeconds: 9, afterTimeSeconds: 40 }],
      extractedFields: [{ field: "tool", value: "comb", source: "OBSERVED", confidence: 0.8, note: "" }],
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "fake-test-key-never-a-real-secret", model: "gemini-3.6-flash" }, fakeGeminiVideoClient(canned));

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") throw new Error("expected created");

    // The existing scalar extraction is completely unchanged/unaffected.
    expect(outcome.draft.extraction.tool).toMatchObject({ value: "comb", source: "OBSERVED" });

    // Temporal evidence is a SEPARATE, additional layer -- never
    // flattened into `extraction`, never dropped.
    expect(outcome.draft.temporalEvidence).toEqual({
      observations: [
        { timeStartSeconds: 0, timeEndSeconds: 5, observation: "comb passes through a section of hair", source: "OBSERVED" },
        { timeStartSeconds: 5, timeEndSeconds: 9, observation: "scissors visibly close near the ends", source: "OBSERVED" },
      ],
      actions: [{ timeStartSeconds: 5, timeEndSeconds: 9, kind: "CUTTING_ACTION", source: "INFERRED" }],
      editGaps: [{ beforeTimeSeconds: 9, afterTimeSeconds: 40, source: "OBSERVED" }],
    });

    // Round-trips from real Postgres, not just the in-memory return value.
    const reloaded = await prisma.professionalLearningDraft.findUnique({ where: { id: outcome.draft.id } });
    expect(reloaded?.temporalEvidence).toEqual(outcome.draft.temporalEvidence);

    // Zero active-knowledge mutation, exactly as before this stage.
    expect(await prisma.professionalSkillDefinition.count()).toBe(0);
  });

  it("a real provider failure fails honestly -- no draft is created, never a fabricated success", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createLearningEvidence(ownerUserId, textInput("Graduated cutting provider-failure test example with sectioning and elevation."));

    const failingClient: GeminiLearningExtractorGenerateClient = {
      async generateContent() {
        throw Object.assign(new Error("simulated network failure"), { status: 503 });
      },
    };
    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: "fake-test-key-never-a-real-secret", model: "gemini-3.6-flash" }, failingClient);

    await expect(processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry })).rejects.toMatchObject({ code: "PROVIDER_ERROR" });

    const count = await prisma.professionalLearningDraft.count({ where: { sourceEvidenceId: evidence.id } });
    expect(count).toBe(0);
  });
});

function textInput(originalText: string) {
  return {
    evidenceType: "TEXT" as const,
    vertical: "hair_cutting",
    originalText,
    provenance: { channel: "typed" },
    rightsClassification: "USER_OWNED_OR_AUTHORIZED" as const,
  };
}

function videoInput(videoAssetId: string) {
  return {
    evidenceType: "VIDEO" as const,
    vertical: "hair_cutting",
    videoAssetId,
    provenance: { channel: "upload" },
    rightsClassification: "USER_OWNED_OR_AUTHORIZED" as const,
  };
}

async function createOwner() {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@learning-draft-real-extractor.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  return { ownerUserId };
}

async function createOwnerAndClient() {
  const { ownerUserId } = await createOwner();
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "T1.2 Temporal Evidence Acceptance Client" } });
  return { ownerUserId, clientId };
}
