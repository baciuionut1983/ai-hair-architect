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
import {
  claimVideoDemonstrationGenerationForSubmit,
  isVideoDemonstrationFailureRetryable,
  markVideoDemonstrationGenerationCompleted,
  markVideoDemonstrationGenerationFailed,
  markVideoDemonstrationGenerationSubmitted,
  MAX_PROVIDER_SUBMIT_ATTEMPTS_PER_GENERATION,
  VIDEO_DEMONSTRATION_STALE_CLAIM_TIMEOUT_MS,
  VideoDemonstrationExecutionStateError,
} from "@/lib/video-generation-execution-repository";

// Real AI Video Demonstration, Stage 1 -- real Postgres, no mocks. Exercises
// the claim/submitted/completed/failed state-machine directly against the
// repository layer (no provider, no execution-service orchestration --
// that is video-generation-execution-service.test.ts's own job).
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
    generate: async () => ({ imageBuffer: await realPngBuffer(), mimeType: "image/png", providerRequestId: "fake-request-1", usage: { imageCount: 1 } }),
  } as unknown as PhotoPreviewProvider;
}

const enabledPhotoPreviewEnv = { PHOTO_PREVIEW_PROVIDER: "gemini", PHOTO_PREVIEW_API_KEY: "test-key", PHOTO_PREVIEW_MODEL: "gemini-3.1-flash-image" };

suite("video-generation-execution-repository (real AI Video Demonstration, Stage 1 state machine)", () => {
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
  // claimVideoDemonstrationGenerationForSubmit
  // -------------------------------------------------------------------------

  it("claims a REQUESTED row: status -> PROCESSING, attemptCount 1, startedAt set", async () => {
    const { ownerUserId, generationId } = await createGeneration();

    const claim = await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
    expect(claim).toEqual({ outcome: "claimed", attemptNumber: 1 });

    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.status).toBe("PROCESSING");
    expect(row.attemptCount).toBe(1);
    expect(row.startedAt).not.toBeNull();
    expect(row.providerOperationId).toBeNull();
  });

  it("rejects NOT_FOUND for a nonexistent id or the wrong owner", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    expect(await claimVideoDemonstrationGenerationForSubmit(randomUUID(), ownerUserId)).toEqual({ outcome: "rejected", code: "NOT_FOUND" });
    expect(await claimVideoDemonstrationGenerationForSubmit(generationId, randomUUID())).toEqual({ outcome: "rejected", code: "NOT_FOUND" });
  });

  it("rejects NOT_ELIGIBLE for a row already PROCESSING with a providerOperationId on file -- never re-claimable for a fresh submit", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
    await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-123");

    expect(await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId)).toEqual({ outcome: "rejected", code: "NOT_ELIGIBLE" });
  });

  it("rejects NOT_ELIGIBLE for a fresh (non-stale) PROCESSING row that has no providerOperationId yet", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
    // Still PROCESSING, no providerOperationId, startedAt is recent -- an
    // in-flight submit attempt, not a crashed one.
    expect(await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId)).toEqual({ outcome: "rejected", code: "NOT_ELIGIBLE" });
  });

  it("accepts (re-claims) a STALE PROCESSING row with no providerOperationId -- crash recovery, and increments attemptCount", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
    await prisma.videoDemonstrationGeneration.update({
      where: { id: generationId },
      data: { startedAt: new Date(Date.now() - VIDEO_DEMONSTRATION_STALE_CLAIM_TIMEOUT_MS - 1000) },
    });

    const claim = await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
    expect(claim).toEqual({ outcome: "claimed", attemptNumber: 2 });
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.attemptCount).toBe(2);
  });

  it("rejects MAX_ATTEMPTS_EXCEEDED for a REQUESTED row whose attemptCount is already at the cap", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await prisma.videoDemonstrationGeneration.update({ where: { id: generationId }, data: { attemptCount: MAX_PROVIDER_SUBMIT_ATTEMPTS_PER_GENERATION } });

    expect(await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId)).toEqual({ outcome: "rejected", code: "MAX_ATTEMPTS_EXCEEDED" });
  });

  // -------------------------------------------------------------------------
  // markVideoDemonstrationGenerationSubmitted -- the critical checkpoint
  // -------------------------------------------------------------------------

  it("markVideoDemonstrationGenerationSubmitted sets providerOperationId + submittedAt exactly once", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);

    await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-abc");
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.providerOperationId).toBe("op-abc");
    expect(row.submittedAt).not.toBeNull();
    expect(row.status).toBe("PROCESSING");
  });

  it("markVideoDemonstrationGenerationSubmitted throws if a providerOperationId is already set -- never silently overwrites a real operation id", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
    await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-first");

    await expect(markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-second")).rejects.toThrow(VideoDemonstrationExecutionStateError);
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.providerOperationId).toBe("op-first");
  });

  it("markVideoDemonstrationGenerationSubmitted throws for a row that is not PROCESSING (e.g. still REQUESTED, never claimed)", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await expect(markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-x")).rejects.toThrow(VideoDemonstrationExecutionStateError);
  });

  // -------------------------------------------------------------------------
  // markVideoDemonstrationGenerationCompleted
  // -------------------------------------------------------------------------

  it("markVideoDemonstrationGenerationCompleted transitions PROCESSING -> COMPLETED with the video asset pointer", async () => {
    const { ownerUserId, clientId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
    await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-1");
    const asset = await prisma.videoAsset.create({ data: { id: randomUUID(), ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: 10, storagePath: "p" } });

    await markVideoDemonstrationGenerationCompleted(generationId, ownerUserId, { generatedVideoAssetId: asset.id });
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.status).toBe("COMPLETED");
    expect(row.completedAt).not.toBeNull();
    expect(row.generatedVideoAssetId).toBe(asset.id);
  });

  it("markVideoDemonstrationGenerationCompleted throws for a row that is not PROCESSING (double-completion guard)", async () => {
    const { ownerUserId, clientId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
    await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-1");
    const asset = await prisma.videoAsset.create({ data: { id: randomUUID(), ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: 10, storagePath: "p" } });
    await markVideoDemonstrationGenerationCompleted(generationId, ownerUserId, { generatedVideoAssetId: asset.id });

    await expect(markVideoDemonstrationGenerationCompleted(generationId, ownerUserId, { generatedVideoAssetId: asset.id })).rejects.toThrow(
      VideoDemonstrationExecutionStateError,
    );
  });

  // -------------------------------------------------------------------------
  // markVideoDemonstrationGenerationFailed -- retry policy
  // -------------------------------------------------------------------------

  it("a retryable failure with attempt budget remaining requeues to REQUESTED, not FAILED", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId); // attemptCount 1 of 2

    const result = await markVideoDemonstrationGenerationFailed(generationId, ownerUserId, { errorCode: "VIDEO_DEMONSTRATION_PROVIDER_TIMEOUT", retryable: true });
    expect(result).toEqual({ status: "REQUESTED" });
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.status).toBe("REQUESTED");
    expect(row.failedAt).toBeNull();
    expect(row.errorCode).toBe("VIDEO_DEMONSTRATION_PROVIDER_TIMEOUT");
  });

  it("a retryable failure with NO attempt budget remaining is terminal FAILED", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await prisma.videoDemonstrationGeneration.update({ where: { id: generationId }, data: { attemptCount: MAX_PROVIDER_SUBMIT_ATTEMPTS_PER_GENERATION, status: "PROCESSING", startedAt: new Date() } });

    const result = await markVideoDemonstrationGenerationFailed(generationId, ownerUserId, { errorCode: "VIDEO_DEMONSTRATION_PROVIDER_TIMEOUT", retryable: true });
    expect(result).toEqual({ status: "FAILED" });
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.status).toBe("FAILED");
    expect(row.failedAt).not.toBeNull();
  });

  it("a non-retryable failure is terminal FAILED regardless of remaining attempt budget", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId); // attemptCount 1 of 2 -- budget remains

    const result = await markVideoDemonstrationGenerationFailed(generationId, ownerUserId, { errorCode: "VIDEO_DEMONSTRATION_PROVIDER_REFUSED", retryable: false });
    expect(result).toEqual({ status: "FAILED" });
  });

  it("providerOperationId is left untouched on failure -- a permanent audit trail even after requeue", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
    await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-audit-trail");

    // A poll-time failure on an already-submitted operation, classified
    // retryable (e.g. a transient invalid-response) -- still requeues, and
    // Veo's own documented billing policy means this is not a double-spend
    // risk (see this repository's own module-level comment).
    await markVideoDemonstrationGenerationFailed(generationId, ownerUserId, { errorCode: "VIDEO_DEMONSTRATION_PROVIDER_INVALID_RESPONSE", retryable: true });
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.status).toBe("REQUESTED");
    expect(row.providerOperationId).toBe("op-audit-trail");
  });

  it("markVideoDemonstrationGenerationFailed throws for a nonexistent/foreign-owner row", async () => {
    const { generationId } = await createGeneration();
    await expect(markVideoDemonstrationGenerationFailed(randomUUID(), randomUUID(), { errorCode: "X", retryable: false })).rejects.toThrow(VideoDemonstrationExecutionStateError);
    void generationId;
  });

  // -------------------------------------------------------------------------
  // isVideoDemonstrationFailureRetryable -- single source of truth
  // -------------------------------------------------------------------------

  describe("isVideoDemonstrationFailureRetryable", () => {
    it("RATE_LIMITED / TIMEOUT / INVALID_RESPONSE are retryable", () => {
      expect(isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_PROVIDER_RATE_LIMITED")).toBe(true);
      expect(isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_PROVIDER_TIMEOUT")).toBe(true);
      expect(isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_PROVIDER_INVALID_RESPONSE")).toBe(true);
    });

    it("REFUSED / STORAGE_FAILED / SOURCE_UNAVAILABLE / CONFIGURATION_ERROR / OPERATION_NOT_FOUND are never retryable", () => {
      expect(isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_PROVIDER_REFUSED")).toBe(false);
      expect(isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_STORAGE_FAILED")).toBe(false);
      expect(isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_SOURCE_UNAVAILABLE")).toBe(false);
      expect(isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_CONFIGURATION_ERROR")).toBe(false);
      expect(isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_OPERATION_NOT_FOUND")).toBe(false);
    });

    it("a generic PROVIDER_ERROR defers to the provider's own reported retryable flag", () => {
      expect(isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_PROVIDER_ERROR", true)).toBe(true);
      expect(isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_PROVIDER_ERROR", false)).toBe(false);
      expect(isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_PROVIDER_ERROR")).toBe(false);
    });

    it("an unrecognized code fails closed to non-retryable", () => {
      expect(isVideoDemonstrationFailureRetryable("SOME_UNKNOWN_CODE")).toBe(false);
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
    data: { id: ownerUserId, email: `${ownerUserId}@video-generation-execution-repository.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Video Execution Repository Client" } });
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

// Builds a full confirmed chain + a genuinely COMPLETED Photo Preview (via
// the real orchestrator with a fake provider), then creates one REQUESTED
// VideoDemonstrationGeneration from it -- the fixture every test in this
// file operates on.
async function createGeneration(): Promise<{ ownerUserId: string; clientId: string; generationId: string }> {
  const { ownerUserId, clientId } = await createOwnerAndClient();
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
    createProvider: () => fakeSuccessProvider(),
    recordAiUsageEvent: async () => undefined,
  });
  if (executed.outcome !== "completed") throw new Error(`expected a COMPLETED Photo Preview fixture, got ${JSON.stringify(executed)}`);

  const outcome = await createVideoDemonstrationGeneration(ownerUserId, clientId, executed.generation.id, "google", "veo-3.1-lite-generate-preview");
  return { ownerUserId, clientId, generationId: outcome.record.id };
}
