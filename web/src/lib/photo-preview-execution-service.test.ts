import { randomUUID } from "crypto";

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { saveImageFile } from "@/lib/image-storage";
import { prisma } from "@/lib/prisma";
import { createPhotoPreviewGeneration, findPhotoPreviewGenerationForOwner } from "@/lib/photo-preview-generation-repository";
import { claimPhotoPreviewGenerationForExecution, markPhotoPreviewGenerationFailed } from "@/lib/photo-preview-execution-repository";
import { executePhotoPreviewGeneration } from "@/lib/photo-preview-execution-service";
import type { PhotoPreviewProvider } from "@/lib/photo-preview-provider";
import { confirmDraftMap, createDraftFromConfirmedProposal, type TechnicalVisualMapRecord } from "@/lib/technical-visual-map-repository";
import { confirmProposal, createProposalForOwner } from "@/lib/proposal-repository";
import { confirmSpatialBinding, createDraftSpatialBinding, type TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";

// Real AI Photo Preview, Stage 2 -- the FULL orchestrator, tested against
// real Postgres for state + real local-disk storage for output, but with
// an EXPLICITLY INJECTED fake provider in every single test (task
// §37/§38's own hard acceptance condition -- see the dedicated
// "network safety" describe block below, which asserts this structurally,
// not just by convention). `env: {}` is passed everywhere the default
// (real) provider construction path would otherwise be reached, so even a
// bug in a test's own DI would fail closed to "disabled", never a real call.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

// The orchestrator genuinely persists "generated" bytes through the real
// processImageForStorage/sharp pipeline (photo-preview-output-storage.ts)
// -- a placeholder ASCII string would (correctly) fail there as an
// unsupported image format. A real, valid, tiny PNG is generated once and
// cached.
let cachedRealPngBuffer: Buffer | null = null;
async function realPngBuffer(): Promise<Buffer> {
  if (!cachedRealPngBuffer) {
    cachedRealPngBuffer = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 100, g: 120, b: 140 } } }).png().toBuffer();
  }
  return cachedRealPngBuffer;
}

// Plain objects, cast to the abstract PhotoPreviewProvider shape -- these
// test doubles only need to satisfy what the execution service actually
// calls at runtime (.generate/.name/.modelVersion), not the full abstract
// class's protected createProviderError helper.
function fakeSuccessProvider(overrides: Partial<Awaited<ReturnType<PhotoPreviewProvider["generate"]>>> = {}): PhotoPreviewProvider {
  return {
    name: "fake",
    modelVersion: "fake-1.0",
    generate: vi.fn().mockImplementation(async () => ({
      imageBuffer: await realPngBuffer(),
      mimeType: "image/png",
      providerRequestId: "fake-request-1",
      usage: { imageCount: 1, inputTokens: 100, outputTokens: 200 },
      ...overrides,
    })),
  } as unknown as PhotoPreviewProvider;
}

function fakeFailingProvider(code: string, retryable: boolean): PhotoPreviewProvider {
  const error = Object.assign(new Error(`fake failure: ${code}`), { code, retryable });
  return { name: "fake", modelVersion: "fake-1.0", generate: vi.fn().mockRejectedValue(error) } as unknown as PhotoPreviewProvider;
}

const enabledEnv = { PHOTO_PREVIEW_PROVIDER: "gemini", PHOTO_PREVIEW_API_KEY: "test-key", PHOTO_PREVIEW_MODEL: "gemini-3.1-flash-image" };

suite("photo-preview-execution-service (real AI Photo Preview, Stage 2 orchestrator)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.aiUsageEvent.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.photoPreviewGeneration.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.technicalVisualMapSpatialBinding.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.technicalVisualMap.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.analysisProposal.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.analysis.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("20. PROCESSING -> COMPLETED on a valid provider output, persisted through the real durable storage path", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const usageEvents: unknown[] = [];

    const result = await executePhotoPreviewGeneration(generation.id, ownerUserId, {
      env: enabledEnv,
      createProvider: () => fakeSuccessProvider(),
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    expect(result.outcome).toBe("completed");
    if (result.outcome !== "completed") throw new Error("expected completed");
    expect(result.generation.status).toBe("COMPLETED");
    expect(result.generation.generatedImageAssetId).toBeTruthy();

    // 31/32. Generated asset is distinct from the source asset, and is
    // clearly provenance-tagged -- never silently becomes source evidence.
    const generatedAsset = await prisma.imageAsset.findUniqueOrThrow({ where: { id: result.generation.generatedImageAssetId as string } });
    expect(generatedAsset.id).not.toBe(generation.sourceImageAssetId);
    expect(generatedAsset.origin).toBe("ai_generated");
    expect(generatedAsset.ownerUserId).toBe(ownerUserId);
    expect(generatedAsset.clientId).toBe(clientId);

    // 39. successful generation metered exactly once, correct attribution.
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      ownerUserId,
      clientId,
      feature: "photo_preview",
      modality: "IMAGE_GENERATION",
      correlationId: generation.id,
      attemptNumber: 1,
      provider: "gemini",
      model: "gemini-3.1-flash-image",
      outcome: "SUCCEEDED",
      usage: { imageCount: 1, inputTokens: 100, outputTokens: 200 },
    });
  });

  it("21. PROCESSING -> FAILED on a provider refusal, metered as a failed attempt", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const usageEvents: unknown[] = [];

    const result = await executePhotoPreviewGeneration(generation.id, ownerUserId, {
      env: enabledEnv,
      createProvider: () => fakeFailingProvider("MODERATION_REFUSED", false),
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    expect(result).toEqual({ outcome: "failed", code: "PROVIDER_REFUSED" });
    const row = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("FAILED");
    expect(row.errorCode).toBe("PHOTO_PREVIEW_PROVIDER_REFUSED");
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({ outcome: "FAILED", errorCategory: "PROVIDER_REFUSED" });
  });

  it("22/26. PROCESSING -> requeued (REQUESTED) on a retryable timeout with budget remaining", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);

    const result = await executePhotoPreviewGeneration(generation.id, ownerUserId, {
      env: enabledEnv,
      createProvider: () => fakeFailingProvider("TIMEOUT", true),
    });

    expect(result).toEqual({ outcome: "requeued_for_retry", code: "PROVIDER_TIMEOUT" });
    const row = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("REQUESTED");
  });

  it("22. PROCESSING -> FAILED on a malformed provider response", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);

    const result = await executePhotoPreviewGeneration(generation.id, ownerUserId, {
      env: enabledEnv,
      createProvider: () => fakeFailingProvider("INVALID_RESPONSE", true),
    });

    // Retryable classification, but this is the FIRST attempt (budget
    // remains) -- requeued, matching the same policy as any other
    // retryable failure; a SECOND occurrence would exhaust the cap (see
    // the execution-repository's own attempt-cap test).
    expect(result).toEqual({ outcome: "requeued_for_retry", code: "PROVIDER_INVALID_RESPONSE" });
  });

  it("23. provider success + storage failure -> FAILED, never COMPLETED, and the successful provider attempt is still metered", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const usageEvents: unknown[] = [];

    const result = await executePhotoPreviewGeneration(generation.id, ownerUserId, {
      env: enabledEnv,
      createProvider: () => fakeSuccessProvider(),
      persistGeneratedImage: async () => {
        throw new Error("simulated storage failure");
      },
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    expect(result).toEqual({ outcome: "failed", code: "STORAGE_FAILED" });
    const row = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("FAILED");
    expect(row.errorCode).toBe("PHOTO_PREVIEW_STORAGE_FAILED");
    expect(row.generatedImageAssetId).toBeNull(); // 18: never becomes COMPLETED
    // 40. the real provider attempt is still metered as SUCCEEDED, even
    // though the overall generation ultimately failed downstream -- the
    // fact that Gemini was genuinely called and produced output must never
    // be lost.
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({ outcome: "SUCCEEDED" });
  });

  it("24. source unavailable -> FAILED without any provider call, never metered", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    await prisma.imageAsset.update({ where: { id: generation.sourceImageAssetId }, data: { deletedAt: new Date() } });

    const provider = fakeSuccessProvider();
    const usageEvents: unknown[] = [];
    const result = await executePhotoPreviewGeneration(generation.id, ownerUserId, {
      env: enabledEnv,
      createProvider: () => provider,
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    expect(result).toEqual({ outcome: "failed", code: "SOURCE_UNAVAILABLE" });
    expect(provider.generate).not.toHaveBeenCalled();
    // 41. no provider call -> no usage event at all (never a fake/fabricated one).
    expect(usageEvents).toHaveLength(0);
    const row = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("FAILED");
    expect(row.errorCode).toBe("PHOTO_PREVIEW_SOURCE_UNAVAILABLE");
  });

  it("25. disabled configuration -> reported as failed, WITHOUT any provider call and WITHOUT ever touching the row (still REQUESTED, safely retriable once fixed)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const provider = fakeSuccessProvider();

    const result = await executePhotoPreviewGeneration(generation.id, ownerUserId, {
      env: {}, // PHOTO_PREVIEW_PROVIDER unset -- disabled by default
      createProvider: () => provider,
    });

    expect(result).toEqual({ outcome: "failed", code: "PROCESSING_DISABLED" });
    expect(provider.generate).not.toHaveBeenCalled();
    const row = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("REQUESTED"); // untouched -- never spent a claim/attempt
    expect(row.attemptCount).toBe(0);
  });

  it("25. an invalid configuration (missing model) also fails closed without a provider call", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const provider = fakeSuccessProvider();

    const result = await executePhotoPreviewGeneration(generation.id, ownerUserId, {
      env: { PHOTO_PREVIEW_PROVIDER: "gemini", PHOTO_PREVIEW_API_KEY: "k" }, // missing model
      createProvider: () => provider,
    });

    expect(result).toEqual({ outcome: "failed", code: "PROVIDER_CONFIGURATION_INVALID" });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("19/CLAIM_CONFLICT: exactly one provider call under a real concurrent execution race", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const provider = fakeSuccessProvider();

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        executePhotoPreviewGeneration(generation.id, ownerUserId, { env: enabledEnv, createProvider: () => provider }),
      ),
    );

    expect(provider.generate).toHaveBeenCalledTimes(1);
    const completed = results.filter((r) => r.outcome === "completed");
    expect(completed.length).toBe(1);
    const conflicted = results.filter((r) => r.outcome === "failed" && r.code === "CLAIM_CONFLICT");
    expect(conflicted.length).toBe(3);
  });

  it("a generation whose attempt budget is already exhausted (terminally FAILED) cannot be executed again", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    // Spend every attempt via the real repository directly. Once the last
    // retryable failure has no budget left, markPhotoPreviewGenerationFailed
    // itself transitions the row to terminal FAILED (never back to
    // REQUESTED) -- so a further claim sees a non-REQUESTED status and is
    // rejected as NOT_ELIGIBLE, which the orchestrator reports as
    // CLAIM_CONFLICT. (MAX_ATTEMPTS_EXCEEDED is claimPhotoPreviewGeneration
    // ForExecution's own defensive-in-depth branch for a REQUESTED row
    // whose attemptCount is somehow already at the cap -- covered directly,
    // against a raw manually-set row, in photo-preview-execution-repository
    // .test.ts's own "28." test; that state is not reachable through this
    // normal exhaustion flow, since markPhotoPreviewGenerationFailed never
    // re-queues past the cap.)
    for (;;) {
      const claim = await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId);
      if (claim.outcome !== "claimed") break;
      await markPhotoPreviewGenerationFailed(generation.id, ownerUserId, { errorCode: "PHOTO_PREVIEW_PROVIDER_TIMEOUT", retryable: true });
    }
    const spent = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(spent.status).toBe("FAILED");

    const result = await executePhotoPreviewGeneration(generation.id, ownerUserId, { env: enabledEnv, createProvider: () => fakeSuccessProvider() });
    expect(result).toEqual({ outcome: "failed", code: "CLAIM_CONFLICT" });
  });

  it("29. the historical sealed request is never mutated by execution", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const before = JSON.stringify(generation.sealedRequest);

    await executePhotoPreviewGeneration(generation.id, ownerUserId, { env: enabledEnv, createProvider: () => fakeSuccessProvider() });

    const after = await findPhotoPreviewGenerationForOwner(ownerUserId, generation.id);
    expect(JSON.stringify(after?.sealedRequest)).toBe(before);
  });

  it("30. supersession of the parent map AFTER the generation was created does not block or mutate execution of the already-sealed request", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { map, binding, analysisId } = await createConfirmedChainWithAnalysis(ownerUserId, clientId);
    const outcome = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");

    // A newer map version is confirmed for the same proposal, superseding
    // the one this generation was sealed against.
    const proposalId = map.analysisProposalId;
    const mapB = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposalId);
    await confirmDraftMap(ownerUserId, mapB.id, map.id);
    void analysisId;

    const result = await executePhotoPreviewGeneration(outcome.record.id, ownerUserId, { env: enabledEnv, createProvider: () => fakeSuccessProvider() });
    expect(result.outcome).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // Stage 5 -- observability (task §17): every real execution attempt must
  // be reconstructable from Railway logs by generation id, without needing
  // a raw API key, prompt, or image byte to leak into that log line.
  // -------------------------------------------------------------------------

  describe("observability (Stage 5, task #17)", () => {
    it("logs a PHOTO_PREVIEW_EXECUTION line on success with the generation id, owner id, outcome, and a real latency -- no secret/prompt/image data", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const generation = await createGeneration(ownerUserId, clientId);
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

      try {
        await executePhotoPreviewGeneration(generation.id, ownerUserId, {
          env: enabledEnv,
          createProvider: () => fakeSuccessProvider(),
          recordAiUsageEvent: async () => undefined,
        });

        const executionLines = consoleLogSpy.mock.calls
          .map((call) => call[0] as string)
          .filter((line) => typeof line === "string" && line.includes("PHOTO_PREVIEW_EXECUTION"));
        expect(executionLines).toHaveLength(1);

        const logged = JSON.parse(executionLines[0]);
        expect(logged).toMatchObject({ gate: "PHOTO_PREVIEW_EXECUTION", generationId: generation.id, ownerUserId, outcome: "completed" });
        expect(typeof logged.totalLatencyMs).toBe("number");
        expect(logged.totalLatencyMs).toBeGreaterThanOrEqual(0);

        // Never a raw secret, prompt, or image byte in this log line.
        expect(executionLines[0]).not.toContain(enabledEnv.PHOTO_PREVIEW_API_KEY);
        expect(logged.instruction).toBeUndefined();
        expect(logged.imageBuffer).toBeUndefined();
        expect(logged.sealedRequest).toBeUndefined();
      } finally {
        consoleLogSpy.mockRestore();
      }
    });

    it("logs a PHOTO_PREVIEW_EXECUTION line via console.error on a terminal failure, including the safe failure code", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const generation = await createGeneration(ownerUserId, clientId);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        // MODERATION_REFUSED is non-retryable -- guarantees a terminal
        // "failed" outcome (not "requeued_for_retry") in a single call.
        await executePhotoPreviewGeneration(generation.id, ownerUserId, {
          env: enabledEnv,
          createProvider: () => fakeFailingProvider("MODERATION_REFUSED", false),
          recordAiUsageEvent: async () => undefined,
        });

        const executionLines = consoleErrorSpy.mock.calls
          .map((call) => call[0] as string)
          .filter((line) => typeof line === "string" && line.includes("PHOTO_PREVIEW_EXECUTION"));
        expect(executionLines).toHaveLength(1);

        const logged = JSON.parse(executionLines[0]);
        expect(logged).toMatchObject({ gate: "PHOTO_PREVIEW_EXECUTION", generationId: generation.id, ownerUserId, outcome: "failed", code: "PROVIDER_REFUSED" });
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Stage 5 -- real, two-real-owner cross-owner execution proof (task
  // #18/#32). A DIFFERENT real owner's id can never execute (or spend a
  // real provider call against) a generation it does not own.
  // -------------------------------------------------------------------------

  it("Stage 5: a real generation cannot be executed by a different real owner -- no provider call, no row mutation, no metering", async () => {
    const { ownerUserId: ownerA } = await createOwnerAndClient();
    const { ownerUserId: ownerB, clientId: clientB } = await createOwnerAndClient();
    const generationB = await createGeneration(ownerB, clientB);

    const provider = fakeSuccessProvider();
    const usageEvents: unknown[] = [];

    const result = await executePhotoPreviewGeneration(generationB.id, ownerA, {
      env: enabledEnv,
      createProvider: () => provider,
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    expect(result).toEqual({ outcome: "failed", code: "GENERATION_NOT_FOUND" });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(usageEvents).toHaveLength(0);

    // The real row, still owned by Owner B, was never touched.
    const row = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generationB.id } });
    expect(row.status).toBe("REQUESTED");
    expect(row.ownerUserId).toBe(ownerB);

    // Sanity: Owner B can genuinely execute their own real generation.
    const ownedResult = await executePhotoPreviewGeneration(generationB.id, ownerB, {
      env: enabledEnv,
      createProvider: () => fakeSuccessProvider(),
      recordAiUsageEvent: async () => undefined,
    });
    expect(ownedResult.outcome).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // 30/38. Network safety -- a hard acceptance condition (task §38): every
  // test above already injects a fake provider; this block additionally
  // proves the DEFAULT construction path fails closed rather than reaching
  // a real network client when configuration is absent, which is the
  // actual guarantee that protects any test that forgets to inject one.
  // -------------------------------------------------------------------------

  describe("network safety", () => {
    it("with no PHOTO_PREVIEW_* environment configured, execution never even attempts to construct a real provider", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const generation = await createGeneration(ownerUserId, clientId);

      // No createProvider override, no env override -- exercises the REAL
      // default dependency wiring. Regardless, this process's own real
      // environment (this repo's .env / CI) never sets PHOTO_PREVIEW_API_KEY,
      // so this must resolve to "disabled" and return before any provider
      // construction is reached.
      const result = await executePhotoPreviewGeneration(generation.id, ownerUserId, { env: {} });
      expect(result).toEqual({ outcome: "failed", code: "PROCESSING_DISABLED" });
    });
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@photo-preview-execution-service.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Photo Preview Execution Service Client" } });
  return { ownerUserId, clientId };
}

async function createAnalysis(ownerUserId: string, clientId: string) {
  return createAnalysisForOwner(ownerUserId, clientId, {
    goal: "refresh", hairType: "medium", density: "medium", porosity: "low", phase: "ready", clarificationRound: 0,
    confidenceScore: 0.87, uncertaintyReasons: [], followUpQuestions: [], recommendations: ["Document the service."],
    safetyNotes: ["Perform a strand test."],
  });
}

function cuttingPayload(overrides: Partial<TechnicalCutPlan> = {}): TechnicalCutPlan {
  return {
    structuralTechnique: "graduation", cuttingTechnique: "slice_cutting", texturizingTechnique: "point_cutting",
    sectioning: "diagonal_back", elevation: "45_deg_graduation", distribution: "overdirected_back", guideline: "stationary",
    cuttingSteps: [{ stepNumber: 1, zone: "nape", action: "Establish the guideline", elevationAngle: "45_deg_graduation", toolRequired: "shears" }],
    stylistExplanation: "x", clientExplanation: "x", professionalReason: "x",
    warnings: [], contraindications: [], assumptions: [], missingData: [], confidence: 0.9,
    stylistValidationDisclaimer: "x", version: "1.0.0-m8",
    ...overrides,
  };
}

function evidenceSnapshot() {
  return {
    observations: { hairType: "medium", density: "medium", porosity: "low", hairCondition: "virgin_healthy", hairTexture: "wavy", hairLength: "long", growthPattern: null, faceShape: "oval", headShape: "flat_occipital" },
    derivedSafety: { safetyNotes: [], contraindications: [] },
  };
}

async function confirmedProposal(ownerUserId: string, clientId: string, analysisId: string) {
  const draft = await createProposalForOwner(ownerUserId, clientId, analysisId, "cutting", cuttingPayload(), evidenceSnapshot(), "1.0.0-m8");
  const confirmed = await confirmProposal(ownerUserId, draft.id, ownerUserId, null);
  if (!confirmed) throw new Error("expected confirmed proposal");
  return confirmed;
}

async function createConfirmedMap(ownerUserId: string, clientId: string): Promise<{ map: TechnicalVisualMapRecord; analysisId: string }> {
  const analysis = await createAnalysis(ownerUserId, clientId);
  const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
  const draftMap = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
  const confirmed = await confirmDraftMap(ownerUserId, draftMap.id, null);
  if (!confirmed) throw new Error("expected confirmed map");
  return { map: confirmed, analysisId: analysis.id };
}

// The executor genuinely READS the source image's bytes (unlike the other
// two test files in this domain, which only ever reference the row) --
// a "pending"/no-backing-file row would legitimately, correctly fail with
// SOURCE_UNAVAILABLE. A real, valid, tiny JPEG is written through the same
// saveImageFile() local-disk path production falls back to in dev/test.
async function createImageAsset(ownerUserId: string, clientId: string) {
  const id = randomUUID();
  const buffer = await sharp({ create: { width: 1080, height: 1440, channels: 3, background: { r: 200, g: 180, b: 160 } } })
    .jpeg()
    .toBuffer();
  const asset = await prisma.imageAsset.create({
    data: { id, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: buffer.length, ownerUserId, clientId, storagePath: "pending", width: 1080, height: 1440 },
  });
  const storagePath = await saveImageFile(ownerUserId, id, asset.fileName, buffer);
  return prisma.imageAsset.update({ where: { id }, data: { storagePath } });
}

async function createConfirmedChainWithAnalysis(
  ownerUserId: string,
  clientId: string,
): Promise<{ map: TechnicalVisualMapRecord; binding: TechnicalVisualMapSpatialBindingRecord; analysisId: string }> {
  const { map, analysisId } = await createConfirmedMap(ownerUserId, clientId);
  const asset = await createImageAsset(ownerUserId, clientId);
  const draftBinding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
  const binding = await confirmSpatialBinding(ownerUserId, draftBinding.id, null);
  if (!binding) throw new Error("expected confirmed spatial binding");
  return { map, binding, analysisId };
}

async function createGeneration(ownerUserId: string, clientId: string) {
  const { binding } = await createConfirmedChainWithAnalysis(ownerUserId, clientId);
  const outcome = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");
  return outcome.record;
}
