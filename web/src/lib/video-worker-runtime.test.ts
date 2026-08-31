import { randomUUID } from "crypto";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { saveImageFile } from "@/lib/image-storage";
import { prisma } from "@/lib/prisma";
import { createPhotoPreviewGeneration } from "@/lib/photo-preview-generation-repository";
import { executePhotoPreviewGeneration } from "@/lib/photo-preview-execution-service";
import type { PhotoPreviewProvider } from "@/lib/photo-preview-provider";
import { confirmDraftMap, createDraftFromConfirmedProposal } from "@/lib/technical-visual-map-repository";
import { confirmProposal, createProposalForOwner } from "@/lib/proposal-repository";
import { confirmSpatialBinding, createDraftSpatialBinding } from "@/lib/technical-visual-map-spatial-binding-repository";
import { createVideoDemonstrationGeneration } from "@/lib/video-generation-repository";
import { runVideoDemonstrationRecoverySweepForRuntime } from "@/lib/video-worker-runtime";

// Real AI Video Demonstration, Stage 3 (task §4, real end-to-end wiring
// proof) -- exercises the REAL runtime wiring (real Postgres query, real
// executeVideoDemonstrationGeneration orchestrator) with ZERO real network
// calls: this process's own real environment never sets
// VIDEO_DEMONSTRATION_PROVIDER (same "network safety" precedent as
// video-generation-execution-service.test.ts's own dedicated describe
// block), so every found generation resolves to PROCESSING_DISABLED --
// proving the sweep genuinely finds and advances real due generations from
// the real database, without needing (or risking) a real provider call.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

let cachedRealPngBuffer: Buffer | null = null;
async function realPngBuffer(): Promise<Buffer> {
  if (!cachedRealPngBuffer) {
    cachedRealPngBuffer = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 100, g: 120, b: 140 } } }).png().toBuffer();
  }
  return cachedRealPngBuffer;
}

function fakePhotoPreviewProvider(): PhotoPreviewProvider {
  return {
    name: "fake",
    modelVersion: "fake-1.0",
    generate: async () => ({ imageBuffer: await realPngBuffer(), mimeType: "image/png", providerRequestId: "fake-request-1", usage: { imageCount: 1 } }),
  } as unknown as PhotoPreviewProvider;
}

const enabledPhotoPreviewEnv = { PHOTO_PREVIEW_PROVIDER: "gemini", PHOTO_PREVIEW_API_KEY: "test-key", PHOTO_PREVIEW_MODEL: "gemini-3.1-flash-image" };

suite("video-worker-runtime (real AI Video Demonstration, Stage 3 recovery sweep -- real DB, zero real network calls)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.aiUsageEvent.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.videoDemonstrationGeneration.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
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

  it("finds and advances real REQUESTED generations from the real database -- with VIDEO_DEMONSTRATION_PROVIDER unset (this process's own real environment), every one safely resolves to PROCESSING_DISABLED, never a real network call", async () => {
    expect(process.env.VIDEO_DEMONSTRATION_PROVIDER).toBeFalsy();

    const { ownerUserId: ownerA, clientId: clientA } = await createOwnerAndClient();
    const { ownerUserId: ownerB, clientId: clientB } = await createOwnerAndClient();
    const genA = await createRequestedGeneration(ownerA, clientA);
    const genB = await createRequestedGeneration(ownerB, clientB);

    const result = await runVideoDemonstrationRecoverySweepForRuntime();

    expect(result.generationsFound).toBeGreaterThanOrEqual(2);
    expect(result.outcomeCounts.failed).toBeGreaterThanOrEqual(2);
    expect(result.generationsErrored).toBe(0);

    const rowA = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: genA.id } });
    const rowB = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: genB.id } });
    // Untouched -- PROCESSING_DISABLED never spends a claim/attempt (same
    // precedent already proven for executeVideoDemonstrationGeneration
    // directly).
    expect(rowA.status).toBe("REQUESTED");
    expect(rowA.attemptCount).toBe(0);
    expect(rowB.status).toBe("REQUESTED");
    expect(rowB.attemptCount).toBe(0);
  });

  it("a COMPLETED generation is never touched by the sweep", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createRequestedGeneration(ownerUserId, clientId);
    await prisma.videoDemonstrationGeneration.update({
      where: { id: generation.id },
      data: { status: "COMPLETED", completedAt: new Date(), providerOperationId: "op-already-done" },
    });

    const before = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    await runVideoDemonstrationRecoverySweepForRuntime();
    const after = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
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
    data: { id: ownerUserId, email: `${ownerUserId}@video-worker-runtime.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Video Worker Runtime Client" } });
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

async function createImageAsset(ownerUserId: string, clientId: string) {
  const id = randomUUID();
  const buffer = await sharp({ create: { width: 1080, height: 1440, channels: 3, background: { r: 200, g: 180, b: 160 } } }).jpeg().toBuffer();
  const asset = await prisma.imageAsset.create({
    data: { id, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: buffer.length, ownerUserId, clientId, storagePath: "pending", width: 1080, height: 1440 },
  });
  const storagePath = await saveImageFile(ownerUserId, id, asset.fileName, buffer);
  return prisma.imageAsset.update({ where: { id }, data: { storagePath } });
}

async function createRequestedGeneration(ownerUserId: string, clientId: string) {
  const analysis = await createAnalysis(ownerUserId, clientId);
  const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
  const draftMap = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
  const map = await confirmDraftMap(ownerUserId, draftMap.id, null);
  if (!map) throw new Error("expected confirmed map");
  const asset = await createImageAsset(ownerUserId, clientId);
  const draftBinding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
  const binding = await confirmSpatialBinding(ownerUserId, draftBinding.id, null);
  if (!binding) throw new Error("expected confirmed spatial binding");

  const createdPhotoPreview = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");
  const executed = await executePhotoPreviewGeneration(createdPhotoPreview.record.id, ownerUserId, {
    env: enabledPhotoPreviewEnv,
    createProvider: () => fakePhotoPreviewProvider(),
    recordAiUsageEvent: async () => undefined,
  });
  if (executed.outcome !== "completed") throw new Error(`expected a COMPLETED Photo Preview fixture, got ${JSON.stringify(executed)}`);

  const outcome = await createVideoDemonstrationGeneration(ownerUserId, clientId, executed.generation.id, "google", "veo-3.1-lite-generate-preview");
  return outcome.record;
}
