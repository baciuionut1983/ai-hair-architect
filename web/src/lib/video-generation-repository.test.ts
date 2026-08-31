import { randomUUID } from "crypto";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { saveImageFile } from "@/lib/image-storage";
import { prisma } from "@/lib/prisma";
import { createPhotoPreviewGeneration, type PhotoPreviewGenerationRecord } from "@/lib/photo-preview-generation-repository";
import { executePhotoPreviewGeneration } from "@/lib/photo-preview-execution-service";
import type { PhotoPreviewProvider } from "@/lib/photo-preview-provider";
import { confirmDraftMap, createDraftFromConfirmedProposal, type TechnicalVisualMapRecord } from "@/lib/technical-visual-map-repository";
import { confirmProposal, createProposalForOwner } from "@/lib/proposal-repository";
import { confirmSpatialBinding, createDraftSpatialBinding, type TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";
import { isSealedVideoDemonstrationRequest } from "@/lib/video-generation-contracts";
import {
  buildVideoDemonstrationUsageEventInput,
  createVideoDemonstrationGeneration,
  createVideoDemonstrationGenerationVariation,
  findVideoDemonstrationGenerationForOwner,
  listVideoDemonstrationGenerationsForPhotoPreview,
  VideoDemonstrationGenerationDependencyError,
  VideoDemonstrationGenerationValidationError,
} from "@/lib/video-generation-repository";

// Real AI Video Demonstration, Stage 1 -- real Postgres, no mocks. Mirrors
// photo-preview-generation-repository.test.ts's own fixture conventions,
// extended one level: every fixture here needs a genuinely COMPLETED
// PhotoPreviewGeneration (Video's own authority gate requirement), built by
// running the real Photo Preview execution orchestrator with an injected
// fake provider -- never a hand-rolled shortcut row that skips Photo
// Preview's own real authority/execution logic.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

let cachedRealPngBuffer: Buffer | null = null;
async function realPngBuffer(): Promise<Buffer> {
  if (!cachedRealPngBuffer) {
    cachedRealPngBuffer = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 100, g: 120, b: 140 } } }).png().toBuffer();
  }
  return cachedRealPngBuffer;
}

function fakeSuccessProvider(): PhotoPreviewProvider {
  return {
    name: "fake",
    modelVersion: "fake-1.0",
    generate: async () => ({
      imageBuffer: await realPngBuffer(),
      mimeType: "image/png",
      providerRequestId: "fake-request-1",
      usage: { imageCount: 1 },
    }),
  } as unknown as PhotoPreviewProvider;
}

const enabledPhotoPreviewEnv = { PHOTO_PREVIEW_PROVIDER: "gemini", PHOTO_PREVIEW_API_KEY: "test-key", PHOTO_PREVIEW_MODEL: "gemini-3.1-flash-image" };

suite("video-generation-repository (real AI Video Demonstration, Stage 1 domain layer)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.videoDemonstrationGeneration.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
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

  // -------------------------------------------------------------------------
  // Authority gate -- happy path
  // -------------------------------------------------------------------------

  it("creates a REQUESTED video generation from a COMPLETED Photo Preview, with the full authority-chain snapshot copied verbatim", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { photoPreview, map, binding } = await createCompletedPhotoPreview(ownerUserId, clientId);

    const outcome = await createVideoDemonstrationGeneration(ownerUserId, clientId, photoPreview.id, "google", "veo-3.1-lite-generate-preview");

    expect(outcome.created).toBe(true);
    expect(outcome.record).toMatchObject({
      ownerUserId,
      clientId,
      photoPreviewGenerationId: photoPreview.id,
      analysisProposalId: photoPreview.analysisProposalId,
      technicalVisualMapId: map.id,
      mapVersion: map.mapVersion,
      spatialBindingId: binding.id,
      spatialVersion: binding.spatialVersion,
      sourceGeneratedImageAssetId: photoPreview.generatedImageAssetId,
      provider: "google",
      model: "veo-3.1-lite-generate-preview",
      variationIndex: 0,
      status: "REQUESTED",
      attemptCount: 0,
      providerOperationId: null,
      generatedVideoAssetId: null,
      errorCode: null,
    });
    expect(isSealedVideoDemonstrationRequest(outcome.record.sealedRequest)).toBe(true);

    const reread = await findVideoDemonstrationGenerationForOwner(ownerUserId, outcome.record.id);
    expect(reread).toEqual(outcome.record);
  });

  it("is idempotent: a second create call for the exact same (owner, client, photoPreview, provider, model) resolves the existing row instead of creating a new one", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { photoPreview } = await createCompletedPhotoPreview(ownerUserId, clientId);

    const first = await createVideoDemonstrationGeneration(ownerUserId, clientId, photoPreview.id, "google", "veo-3.1-lite-generate-preview");
    const second = await createVideoDemonstrationGeneration(ownerUserId, clientId, photoPreview.id, "google", "veo-3.1-lite-generate-preview");

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);

    const all = await listVideoDemonstrationGenerationsForPhotoPreview(ownerUserId, clientId, photoPreview.id);
    expect(all).toHaveLength(1);
  });

  it("createVideoDemonstrationGenerationVariation always creates a new row with an incrementing variationIndex", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { photoPreview } = await createCompletedPhotoPreview(ownerUserId, clientId);

    const v0 = await createVideoDemonstrationGeneration(ownerUserId, clientId, photoPreview.id, "google", "veo-3.1-lite-generate-preview");
    const v1 = await createVideoDemonstrationGenerationVariation(ownerUserId, clientId, photoPreview.id, "google", "veo-3.1-lite-generate-preview");
    const v2 = await createVideoDemonstrationGenerationVariation(ownerUserId, clientId, photoPreview.id, "google", "veo-3.1-lite-generate-preview");

    expect([v0.record.variationIndex, v1.record.variationIndex, v2.record.variationIndex]).toEqual([0, 1, 2]);
    expect(new Set([v0.record.id, v1.record.id, v2.record.id]).size).toBe(3);
    expect(v0.created && v1.created && v2.created).toBe(true);

    const all = await listVideoDemonstrationGenerationsForPhotoPreview(ownerUserId, clientId, photoPreview.id);
    expect(all).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // Authority gate -- rejections, re-verified server-side, never trusting a
  // browser-supplied id
  // -------------------------------------------------------------------------

  it("rejects a nonexistent photoPreviewGenerationId", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    await expect(createVideoDemonstrationGeneration(ownerUserId, clientId, randomUUID(), "google", "veo-3.1-lite-generate-preview")).rejects.toThrow(
      VideoDemonstrationGenerationDependencyError,
    );
  });

  it("rejects a Photo Preview that belongs to a different client", async () => {
    const { ownerUserId, clientId: clientA } = await createOwnerAndClient();
    const clientB = randomUUID();
    await prisma.client.create({ data: { id: clientB, ownerUserId, fullName: "Second Client" } });
    const { photoPreview } = await createCompletedPhotoPreview(ownerUserId, clientA);

    await expect(createVideoDemonstrationGeneration(ownerUserId, clientB, photoPreview.id, "google", "veo-3.1-lite-generate-preview")).rejects.toThrow(
      VideoDemonstrationGenerationDependencyError,
    );
  });

  it("rejects a Photo Preview that is not yet COMPLETED", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);
    const requestedPhotoPreview = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");
    expect(requestedPhotoPreview.record.status).toBe("REQUESTED");

    await expect(
      createVideoDemonstrationGeneration(ownerUserId, clientId, requestedPhotoPreview.record.id, "google", "veo-3.1-lite-generate-preview"),
    ).rejects.toThrow(VideoDemonstrationGenerationDependencyError);
  });

  it("a foreign owner's photoPreviewGenerationId resolves to NOT_FOUND, never leaking that it belongs to someone else", async () => {
    const { ownerUserId: ownerA, clientId: clientA } = await createOwnerAndClient();
    const { ownerUserId: ownerB, clientId: clientB } = await createOwnerAndClient();
    const { photoPreview } = await createCompletedPhotoPreview(ownerA, clientA);

    let caught: unknown;
    try {
      // ownerB references THEIR OWN client (passes the client-ownership
      // check) but ownerA's photoPreviewGenerationId -- which does not
      // exist under ownerB's scope at all.
      await createVideoDemonstrationGeneration(ownerB, clientB, photoPreview.id, "google", "veo-3.1-lite-generate-preview");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VideoDemonstrationGenerationDependencyError);
    expect((caught as VideoDemonstrationGenerationDependencyError).code).toBe("VIDEO_DEMONSTRATION_GENERATION_PHOTO_PREVIEW_NOT_FOUND");
  });

  it("rejects an invalid provider or model before any row is written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { photoPreview } = await createCompletedPhotoPreview(ownerUserId, clientId);

    await expect(createVideoDemonstrationGeneration(ownerUserId, clientId, photoPreview.id, "openai", "veo-3.1-lite-generate-preview")).rejects.toThrow(
      VideoDemonstrationGenerationValidationError,
    );
    await expect(createVideoDemonstrationGeneration(ownerUserId, clientId, photoPreview.id, "google", "not-a-real-model")).rejects.toThrow(
      VideoDemonstrationGenerationValidationError,
    );

    const all = await listVideoDemonstrationGenerationsForPhotoPreview(ownerUserId, clientId, photoPreview.id);
    expect(all).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Historical provenance over current-state guessing (Video Stage 0
  // Decision Lock, section 5) -- a Photo Preview whose OWN parents were
  // later superseded remains a perfectly valid, unchanged Video source.
  // -------------------------------------------------------------------------

  it("supersession of the parent map AFTER the Photo Preview completed does not block Video creation, and the frozen snapshot still reflects the ORIGINAL map/binding, not the newer one", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { photoPreview, map, binding } = await createCompletedPhotoPreview(ownerUserId, clientId);

    const proposalId = map.analysisProposalId;
    const mapB = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposalId);
    await confirmDraftMap(ownerUserId, mapB.id, map.id);

    const outcome = await createVideoDemonstrationGeneration(ownerUserId, clientId, photoPreview.id, "google", "veo-3.1-lite-generate-preview");
    expect(outcome.created).toBe(true);
    // Still points at the ORIGINAL map, not mapB -- never re-derived from
    // the live (now-superseded) chain.
    expect(outcome.record.technicalVisualMapId).toBe(map.id);
    expect(outcome.record.spatialBindingId).toBe(binding.id);
  });

  // -------------------------------------------------------------------------
  // AiUsageEvent boundary -- pure mapping, no DB
  // -------------------------------------------------------------------------

  describe("buildVideoDemonstrationUsageEventInput", () => {
    const generation = { id: "gen-1", ownerUserId: "owner-1", clientId: "client-1", provider: "google", model: "veo-3.1-lite-generate-preview" };

    it("uses the generation's own id as the correlationId, and stamps feature/modality fixed values", () => {
      const input = buildVideoDemonstrationUsageEventInput(generation, { outcome: "SUCCEEDED", attemptNumber: 1 });
      expect(input).toMatchObject({
        ownerUserId: "owner-1",
        clientId: "client-1",
        feature: "video_demonstration",
        modality: "VIDEO_GENERATION",
        correlationId: "gen-1",
        attemptNumber: 1,
        provider: "google",
        model: "veo-3.1-lite-generate-preview",
        outcome: "SUCCEEDED",
      });
    });

    it("omits optional fields entirely when not provided, rather than coercing to a fabricated default", () => {
      const input = buildVideoDemonstrationUsageEventInput(generation, { outcome: "FAILED" });
      expect(input.attemptNumber).toBeUndefined();
      expect(input.providerRequestId).toBeUndefined();
      expect(input.usage).toBeUndefined();
      expect(input.errorCategory).toBeUndefined();
      expect(input.latencyMs).toBeUndefined();
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
    data: { id: ownerUserId, email: `${ownerUserId}@video-generation-repository.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Video Generation Repository Client" } });
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

async function createConfirmedMap(ownerUserId: string, clientId: string): Promise<{ map: TechnicalVisualMapRecord }> {
  const analysis = await createAnalysis(ownerUserId, clientId);
  const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
  const draftMap = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
  const confirmed = await confirmDraftMap(ownerUserId, draftMap.id, null);
  if (!confirmed) throw new Error("expected confirmed map");
  return { map: confirmed };
}

async function createImageAsset(ownerUserId: string, clientId: string) {
  const id = randomUUID();
  const buffer = await sharp({ create: { width: 1080, height: 1440, channels: 3, background: { r: 200, g: 180, b: 160 } } }).jpeg().toBuffer();
  const asset = await prisma.imageAsset.create({
    data: { id, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: buffer.length, ownerUserId, clientId, storagePath: "pending", width: 1080, height: 1440 },
  });
  const storagePath = await saveImageFile(ownerUserId, id, asset.fileName, buffer);
  return prisma.imageAsset.update({ where: { id }, data: { storagePath } });
}

async function createConfirmedChain(
  ownerUserId: string,
  clientId: string,
): Promise<{ map: TechnicalVisualMapRecord; binding: TechnicalVisualMapSpatialBindingRecord }> {
  const { map } = await createConfirmedMap(ownerUserId, clientId);
  const asset = await createImageAsset(ownerUserId, clientId);
  const draftBinding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
  const binding = await confirmSpatialBinding(ownerUserId, draftBinding.id, null);
  if (!binding) throw new Error("expected confirmed spatial binding");
  return { map, binding };
}

// Runs the REAL Photo Preview execution orchestrator (with an injected fake
// provider -- zero real Gemini calls) to reach a genuinely COMPLETED row
// with a real generatedImageAssetId backed by real bytes on disk. This is
// the only source of a valid Video authority-gate fixture -- never a
// hand-rolled row that skips Photo Preview's own real logic.
async function createCompletedPhotoPreview(
  ownerUserId: string,
  clientId: string,
): Promise<{ photoPreview: PhotoPreviewGenerationRecord; map: TechnicalVisualMapRecord; binding: TechnicalVisualMapSpatialBindingRecord }> {
  const { map, binding } = await createConfirmedChain(ownerUserId, clientId);
  const created = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");
  const executed = await executePhotoPreviewGeneration(created.record.id, ownerUserId, {
    env: enabledPhotoPreviewEnv,
    createProvider: () => fakeSuccessProvider(),
    recordAiUsageEvent: async () => undefined,
  });
  if (executed.outcome !== "completed") throw new Error(`expected a COMPLETED Photo Preview fixture, got ${JSON.stringify(executed)}`);
  return { photoPreview: executed.generation, map, binding };
}
