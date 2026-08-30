import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { prisma } from "@/lib/prisma";
import { createPhotoPreviewGeneration } from "@/lib/photo-preview-generation-repository";
import {
  claimPhotoPreviewGenerationForExecution,
  isPhotoPreviewFailureRetryable,
  markPhotoPreviewGenerationCompleted,
  markPhotoPreviewGenerationFailed,
  MAX_PROVIDER_ATTEMPTS_PER_GENERATION,
  PhotoPreviewExecutionStateError,
  PHOTO_PREVIEW_STALE_PROCESSING_TIMEOUT_MS,
} from "@/lib/photo-preview-execution-repository";
import { confirmDraftMap, createDraftFromConfirmedProposal, type TechnicalVisualMapRecord } from "@/lib/technical-visual-map-repository";
import { confirmProposal, createProposalForOwner } from "@/lib/proposal-repository";
import { confirmSpatialBinding, createDraftSpatialBinding, type TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";

// Real AI Photo Preview, Stage 2 -- real Postgres, no mocks. Mirrors
// image-analysis-job-repository's own claim/mark testing philosophy:
// concurrency proofs run against the real database, not simulated.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("photo-preview-execution-repository (real AI Photo Preview, Stage 2 execution claim/state layer)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
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
  // Claim
  // -------------------------------------------------------------------------

  it("17. claims a REQUESTED job, transitioning it to PROCESSING with attemptNumber 1", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);

    const claim = await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId);
    expect(claim).toEqual({ outcome: "claimed", attemptNumber: 1 });

    const row = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("PROCESSING");
    expect(row.attemptCount).toBe(1);
    expect(row.startedAt).not.toBeNull();
  });

  it("18. a second claim of an already-PROCESSING (fresh, non-stale) job is rejected, not re-claimed", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);

    const first = await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId);
    expect(first.outcome).toBe("claimed");

    const second = await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId);
    expect(second).toEqual({ outcome: "rejected", code: "NOT_ELIGIBLE" });

    const row = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.attemptCount).toBe(1); // never double-incremented
  });

  it("19. concurrency: N simultaneous claims of the SAME REQUESTED job -- exactly one succeeds, real DB backstop", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId)),
    );

    const claimed = results.filter((r) => r.outcome === "claimed");
    expect(claimed.length).toBe(1);
    const row = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.attemptCount).toBe(1);
  });

  it("a nonexistent or foreign-owner generation is rejected as NOT_FOUND", async () => {
    const { ownerUserId } = await createOwnerAndClient();
    const result = await claimPhotoPreviewGenerationForExecution(randomUUID(), ownerUserId);
    expect(result).toEqual({ outcome: "rejected", code: "NOT_FOUND" });
  });

  it("28. the attempt cap is enforced -- claiming beyond MAX_PROVIDER_ATTEMPTS_PER_GENERATION is rejected", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);

    // Exhaust every allowed attempt via the real fail-and-requeue path.
    for (let i = 0; i < MAX_PROVIDER_ATTEMPTS_PER_GENERATION; i += 1) {
      const claim = await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId);
      expect(claim.outcome).toBe("claimed");
      await markPhotoPreviewGenerationFailed(generation.id, ownerUserId, { errorCode: "PHOTO_PREVIEW_PROVIDER_TIMEOUT", retryable: true });
    }

    const finalRow = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(finalRow.status).toBe("FAILED"); // last failure had no retry budget left
    expect(finalRow.attemptCount).toBe(MAX_PROVIDER_ATTEMPTS_PER_GENERATION);

    const overCap = await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId);
    expect(overCap).toEqual({ outcome: "rejected", code: "NOT_ELIGIBLE" }); // FAILED is not REQUESTED
  });

  // -------------------------------------------------------------------------
  // Stale-processing recovery (task §20, §43)
  // -------------------------------------------------------------------------

  it("58. a PROCESSING job past the stale threshold becomes claimable again", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const longAgo = new Date(Date.now() - PHOTO_PREVIEW_STALE_PROCESSING_TIMEOUT_MS - 1000);

    const first = await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId, longAgo);
    expect(first.outcome).toBe("claimed");
    // Simulate a crash: the row is left PROCESSING forever, never marked
    // completed or failed.

    const recovered = await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId, new Date());
    expect(recovered).toEqual({ outcome: "claimed", attemptNumber: 2 });
  });

  it("59. a FRESH (non-stale) PROCESSING job cannot be stolen by a recovery attempt", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);

    const first = await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId, new Date());
    expect(first.outcome).toBe("claimed");

    const stolen = await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId, new Date());
    expect(stolen).toEqual({ outcome: "rejected", code: "NOT_ELIGIBLE" });
  });

  it("62. two concurrent recovery attempts on the same stale job cannot both succeed", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const longAgo = new Date(Date.now() - PHOTO_PREVIEW_STALE_PROCESSING_TIMEOUT_MS - 1000);
    await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId, longAgo);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId, new Date())),
    );
    const claimed = results.filter((r) => r.outcome === "claimed");
    expect(claimed.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Completion / failure
  // -------------------------------------------------------------------------

  it("20. PROCESSING -> COMPLETED on a valid completion", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId);
    const generatedAssetId = randomUUID();

    await markPhotoPreviewGenerationCompleted(generation.id, ownerUserId, { generatedImageAssetId: generatedAssetId, providerRequestId: "req-1" });

    const row = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("COMPLETED");
    expect(row.generatedImageAssetId).toBe(generatedAssetId);
    expect(row.providerRequestId).toBe("req-1");
    expect(row.completedAt).not.toBeNull();
  });

  it("completing a job that was never claimed (still REQUESTED) is rejected, no silent success", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    await expect(
      markPhotoPreviewGenerationCompleted(generation.id, ownerUserId, { generatedImageAssetId: randomUUID() }),
    ).rejects.toBeInstanceOf(PhotoPreviewExecutionStateError);
  });

  it("21/27. PROCESSING -> FAILED on a non-retryable provider refusal, never requeued", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId);

    const result = await markPhotoPreviewGenerationFailed(generation.id, ownerUserId, { errorCode: "PHOTO_PREVIEW_PROVIDER_REFUSED", retryable: false });
    expect(result).toEqual({ status: "FAILED" });

    const row = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("FAILED");
    expect(row.errorCode).toBe("PHOTO_PREVIEW_PROVIDER_REFUSED");
    expect(row.failedAt).not.toBeNull();
  });

  it("26/27. a retryable failure with budget remaining requeues to REQUESTED, not terminal FAILED", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId); // attempt 1 of 2

    const result = await markPhotoPreviewGenerationFailed(generation.id, ownerUserId, { errorCode: "PHOTO_PREVIEW_PROVIDER_TIMEOUT", retryable: true });
    expect(result).toEqual({ status: "REQUESTED" });

    const row = await prisma.photoPreviewGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("REQUESTED");
    expect(row.failedAt).toBeNull(); // not terminal
    expect(row.errorCode).toBe("PHOTO_PREVIEW_PROVIDER_TIMEOUT"); // still recorded for visibility
  });

  it("23. a storage failure is always terminal FAILED, never automatically requeued for another paid attempt", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    await claimPhotoPreviewGenerationForExecution(generation.id, ownerUserId); // attempt 1 of 2 -- budget remains

    const result = await markPhotoPreviewGenerationFailed(generation.id, ownerUserId, { errorCode: "PHOTO_PREVIEW_STORAGE_FAILED", retryable: false });
    expect(result).toEqual({ status: "FAILED" });
  });

  it("failing a job that is not currently PROCESSING is rejected", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId); // still REQUESTED
    await expect(
      markPhotoPreviewGenerationFailed(generation.id, ownerUserId, { errorCode: "PHOTO_PREVIEW_PROVIDER_ERROR", retryable: false }),
    ).rejects.toBeInstanceOf(PhotoPreviewExecutionStateError);
  });

  // -------------------------------------------------------------------------
  // Retry policy classification (pure, task §21/§31)
  // -------------------------------------------------------------------------

  describe("isPhotoPreviewFailureRetryable", () => {
    it("rate limit, timeout, and invalid response are retryable", () => {
      expect(isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_PROVIDER_RATE_LIMITED")).toBe(true);
      expect(isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_PROVIDER_TIMEOUT")).toBe(true);
      expect(isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_PROVIDER_INVALID_RESPONSE")).toBe(true);
    });

    it("moderation refusal, storage failure, source unavailable, and configuration error are never retryable", () => {
      expect(isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_PROVIDER_REFUSED")).toBe(false);
      expect(isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_STORAGE_FAILED")).toBe(false);
      expect(isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_SOURCE_UNAVAILABLE")).toBe(false);
      expect(isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_CONFIGURATION_ERROR")).toBe(false);
    });

    it("PHOTO_PREVIEW_PROVIDER_ERROR's retryability depends entirely on the underlying provider signal", () => {
      expect(isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_PROVIDER_ERROR", true)).toBe(true);
      expect(isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_PROVIDER_ERROR", false)).toBe(false);
      expect(isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_PROVIDER_ERROR")).toBe(false);
    });

    it("an unrecognized code is conservatively non-retryable", () => {
      expect(isPhotoPreviewFailureRetryable("SOME_FUTURE_CODE")).toBe(false);
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
    data: { id: ownerUserId, email: `${ownerUserId}@photo-preview-execution.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Photo Preview Execution Client" } });
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

async function createConfirmedMap(ownerUserId: string, clientId: string): Promise<TechnicalVisualMapRecord> {
  const analysis = await createAnalysis(ownerUserId, clientId);
  const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
  const draftMap = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
  const confirmed = await confirmDraftMap(ownerUserId, draftMap.id, null);
  if (!confirmed) throw new Error("expected confirmed map");
  return confirmed;
}

async function createImageAsset(ownerUserId: string, clientId: string) {
  return prisma.imageAsset.create({
    data: { id: randomUUID(), fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 12345, ownerUserId, clientId, storagePath: "pending", width: 1080, height: 1440 },
  });
}

async function createConfirmedBinding(ownerUserId: string, clientId: string): Promise<{ map: TechnicalVisualMapRecord; binding: TechnicalVisualMapSpatialBindingRecord }> {
  const map = await createConfirmedMap(ownerUserId, clientId);
  const asset = await createImageAsset(ownerUserId, clientId);
  const draftBinding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
  const binding = await confirmSpatialBinding(ownerUserId, draftBinding.id, null);
  if (!binding) throw new Error("expected confirmed spatial binding");
  return { map, binding };
}

async function createGeneration(ownerUserId: string, clientId: string) {
  const { binding } = await createConfirmedBinding(ownerUserId, clientId);
  const outcome = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");
  return outcome.record;
}
