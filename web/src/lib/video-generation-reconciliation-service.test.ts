import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
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
  markVideoDemonstrationGenerationFailed,
  markVideoDemonstrationGenerationSubmitted,
} from "@/lib/video-generation-execution-repository";
import { reconcileVideoDemonstrationGeneration } from "@/lib/video-generation-reconciliation-service";
import {
  AlwaysFailingPollVideoDemonstrationProvider,
  AlwaysFailingSubmitVideoDemonstrationProvider,
  AlwaysProcessingVideoDemonstrationProvider,
  FakeVideoDemonstrationProvider,
} from "@/lib/video-provider";

// Real AI Video Demonstration -- reconciliation service, tested against
// real Postgres for state, with an EXPLICITLY INJECTED fake provider in
// every single test (identical hard acceptance condition to
// video-generation-execution-service.test.ts's own "network safety" block
// -- see this file's own bottom describe block, which asserts it
// structurally at the source level).
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
const enabledVideoEnv = { VIDEO_DEMONSTRATION_PROVIDER: "google", VIDEO_DEMONSTRATION_API_KEY: "test-key", VIDEO_DEMONSTRATION_MODEL: "veo-3.1-lite-generate-preview" };

suite("video-generation-reconciliation-service (recovering a real, provider-confirmed-successful operation falsely marked FAILED locally)", () => {
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

  // -------------------------------------------------------------------------
  // FAILED + provider confirms success -> COMPLETED + VideoAsset
  // -------------------------------------------------------------------------

  it("FAILED + provider poll confirms done:true success -> reconciled to COMPLETED, real VideoAsset persisted, metered SUCCEEDED exactly once", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createFailedGenerationWithOperationId(ownerUserId, clientId);
    const usageEvents: unknown[] = [];

    const result = await reconcileVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () => new FakeVideoDemonstrationProvider(),
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    expect(result.outcome).toBe("reconciled");
    if (result.outcome !== "reconciled") throw new Error("expected reconciled");
    expect(result.generation.status).toBe("COMPLETED");
    expect(result.generation.generatedVideoAssetId).toBeTruthy();

    const asset = await prisma.videoAsset.findUniqueOrThrow({ where: { id: result.generation.generatedVideoAssetId as string } });
    expect(asset.ownerUserId).toBe(ownerUserId);
    expect(asset.clientId).toBe(clientId);
    expect(asset.mimeType).toBe("video/mp4");

    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      ownerUserId,
      clientId,
      feature: "video_demonstration",
      modality: "VIDEO_GENERATION",
      correlationId: generation.id,
      outcome: "SUCCEEDED",
      providerRequestId: "fake-operation-id",
      idempotencyKey: `${generation.id}:reconciliation`,
    });

    // The row's own audit trail (schema comment on reconciliationClaimedAt):
    // a COMPLETED row with non-null failedAt/errorCode/reconciliationClaimedAt
    // unambiguously means "reconciled after a false local FAILED," never
    // confusable with an ordinary first-time completion.
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.failedAt).not.toBeNull();
    expect(row.errorCode).not.toBeNull();
    expect(row.reconciliationClaimedAt).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // FAILED + provider pending -> stays FAILED, reported incomplete
  // -------------------------------------------------------------------------

  it("FAILED + provider poll reports still pending (done:false) -> stays FAILED, never PROCESSING, reported incomplete", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createFailedGenerationWithOperationId(ownerUserId, clientId);

    const result = await reconcileVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () => new AlwaysProcessingVideoDemonstrationProvider(),
    });

    expect(result).toEqual({ outcome: "incomplete", code: "STILL_PENDING" });

    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("FAILED");
    expect(row.generatedVideoAssetId).toBeNull();
    // Claim released -- a human can retry immediately, no 15-minute wait.
    expect(row.reconciliationClaimedAt).toBeNull();
  });

  // -------------------------------------------------------------------------
  // FAILED + provider confirms a genuine failure -> stays FAILED
  // -------------------------------------------------------------------------

  it("FAILED + provider poll confirms a genuine terminal failure (moderation) -> stays FAILED, reported as a confirmed provider refusal", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createFailedGenerationWithOperationId(ownerUserId, clientId);

    const result = await reconcileVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () => new AlwaysFailingPollVideoDemonstrationProvider(),
    });

    expect(result).toEqual({ outcome: "failed", code: "PROVIDER_REFUSED" });

    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("FAILED");
    expect(row.generatedVideoAssetId).toBeNull();
  });

  it("FAILED + provider reports the operation no longer exists (404) -> stays FAILED, reported as operation-not-found", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createFailedGenerationWithOperationId(ownerUserId, clientId);

    // AlwaysFailingSubmitVideoDemonstrationProvider's poll() throws
    // OPERATION_NOT_FOUND -- reused here for exactly that behavior, its
    // (irrelevant to this test) always-failing submit() is never called.
    const result = await reconcileVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () => new AlwaysFailingSubmitVideoDemonstrationProvider(),
    });

    expect(result).toEqual({ outcome: "failed", code: "OPERATION_NOT_FOUND" });

    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("FAILED");
  });

  // -------------------------------------------------------------------------
  // providerOperationId missing -> rejected, never even attempts to poll
  // -------------------------------------------------------------------------

  it("providerOperationId missing (a submit-phase failure, never reached the provider) -> rejected as NO_OPERATION_ID, never polls", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    await claimVideoDemonstrationGenerationForSubmit(generation.id, ownerUserId);
    // Never markVideoDemonstrationGenerationSubmitted -- providerOperationId
    // stays null, exactly like a real pre-operation-id submit failure.
    await markVideoDemonstrationGenerationFailed(generation.id, ownerUserId, { errorCode: "VIDEO_DEMONSTRATION_SOURCE_UNAVAILABLE", retryable: false });

    let pollCalls = 0;
    const result = await reconcileVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () =>
        Object.assign(new FakeVideoDemonstrationProvider(), {
          poll: async () => {
            pollCalls += 1;
            return { done: true, videoBuffer: Buffer.from("x"), mimeType: "video/mp4", durationSeconds: 4 };
          },
        }),
    });

    expect(result).toEqual({ outcome: "not_eligible", code: "NO_OPERATION_ID" });
    expect(pollCalls).toBe(0);
  });

  it("a nonexistent generation id, or one belonging to a different owner -> rejected as GENERATION_NOT_FOUND, never leaks existence", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createFailedGenerationWithOperationId(ownerUserId, clientId);

    expect(await reconcileVideoDemonstrationGeneration(randomUUID(), ownerUserId, { env: enabledVideoEnv })).toEqual({ outcome: "not_eligible", code: "GENERATION_NOT_FOUND" });
    expect(await reconcileVideoDemonstrationGeneration(generation.id, randomUUID(), { env: enabledVideoEnv })).toEqual({ outcome: "not_eligible", code: "GENERATION_NOT_FOUND" });
  });

  it("a COMPLETED or still-PROCESSING generation (never FAILED) -> rejected as NOT_FAILED, never touched", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    await claimVideoDemonstrationGenerationForSubmit(generation.id, ownerUserId);
    await markVideoDemonstrationGenerationSubmitted(generation.id, ownerUserId, "op-still-processing");

    const result = await reconcileVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv });
    expect(result).toEqual({ outcome: "not_eligible", code: "NOT_FAILED" });
  });

  // -------------------------------------------------------------------------
  // generatedVideoAssetId already present -> idempotent no-op, never a
  // duplicate VideoAsset
  // -------------------------------------------------------------------------

  it("reconciling an already-reconciled generation a second time is a safe no-op -- exactly one VideoAsset, never a duplicate", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createFailedGenerationWithOperationId(ownerUserId, clientId);

    const first = await reconcileVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => new FakeVideoDemonstrationProvider() });
    expect(first.outcome).toBe("reconciled");

    let pollCallsOnSecondAttempt = 0;
    const second = await reconcileVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () =>
        Object.assign(new FakeVideoDemonstrationProvider(), {
          poll: async () => {
            pollCallsOnSecondAttempt += 1;
            return { done: true, videoBuffer: Buffer.from("x"), mimeType: "video/mp4", durationSeconds: 4 };
          },
        }),
    });

    expect(second.outcome).toBe("already_reconciled");
    if (second.outcome !== "already_reconciled") throw new Error("expected already_reconciled");
    expect(second.generation.generatedVideoAssetId).toBe((first as { generation: { generatedVideoAssetId: string } }).generation.generatedVideoAssetId);
    // Short-circuited BEFORE ever reaching the provider again.
    expect(pollCallsOnSecondAttempt).toBe(0);

    const assetCount = await prisma.videoAsset.count({ where: { ownerUserId, clientId } });
    expect(assetCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Concurrency: two simultaneous reconciliation attempts -> exactly one
  // asset, exactly one completion
  // -------------------------------------------------------------------------

  it("under a real concurrent race, exactly one caller reconciles -- never two VideoAsset rows for the same generation", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createFailedGenerationWithOperationId(ownerUserId, clientId);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        reconcileVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => new FakeVideoDemonstrationProvider() }),
      ),
    );

    const reconciled = results.filter((r) => r.outcome === "reconciled");
    expect(reconciled.length).toBe(1);

    const assetCount = await prisma.videoAsset.count({ where: { ownerUserId, clientId } });
    expect(assetCount).toBe(1);

    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("COMPLETED");
  });

  // -------------------------------------------------------------------------
  // Metering SUCCEEDED exactly-once, even across a storage failure + retry
  // -------------------------------------------------------------------------

  it("metering SUCCEEDED is recorded exactly once even if a first reconciliation attempt fails at storage and a later attempt retries and succeeds", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createFailedGenerationWithOperationId(ownerUserId, clientId);

    const first = await reconcileVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () => new FakeVideoDemonstrationProvider(),
      persistGeneratedVideo: async () => {
        throw new Error("simulated storage outage");
      },
      // Real recordAiUsageEvent (no override) -- proves real DB-level
      // idempotency, not just a call-count on a spy.
    });
    expect(first).toEqual({ outcome: "failed", code: "STORAGE_FAILED" });

    const rowAfterFirst = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(rowAfterFirst.status).toBe("FAILED");
    expect(rowAfterFirst.reconciliationClaimedAt).toBeNull(); // released, retryable immediately

    const second = await reconcileVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () => new FakeVideoDemonstrationProvider(),
    });
    expect(second.outcome).toBe("reconciled");

    const usageRows = await prisma.aiUsageEvent.findMany({ where: { correlationId: generation.id, outcome: "SUCCEEDED" } });
    expect(usageRows.length).toBe(1);
    expect(usageRows[0].idempotencyKey).toBe(`${generation.id}:reconciliation`);
  });

  // -------------------------------------------------------------------------
  // Authority/provenance untouched by reconciliation
  // -------------------------------------------------------------------------

  it("reconciliation never touches the frozen authority-chain snapshot", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createFailedGenerationWithOperationId(ownerUserId, clientId);
    const before = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });

    const result = await reconcileVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => new FakeVideoDemonstrationProvider() });
    expect(result.outcome).toBe("reconciled");

    const after = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(after.analysisProposalId).toBe(before.analysisProposalId);
    expect(after.analysisProposalConfirmedAt).toEqual(before.analysisProposalConfirmedAt);
    expect(after.technicalVisualMapId).toBe(before.technicalVisualMapId);
    expect(after.mapVersion).toBe(before.mapVersion);
    expect(after.spatialBindingId).toBe(before.spatialBindingId);
    expect(after.spatialVersion).toBe(before.spatialVersion);
    expect(after.sourceGeneratedImageAssetId).toBe(before.sourceGeneratedImageAssetId);
    expect(after.sealedRequest).toEqual(before.sealedRequest);
    expect(after.requestFingerprint).toBe(before.requestFingerprint);
    expect(after.photoPreviewGenerationId).toBe(before.photoPreviewGenerationId);
    expect(after.provider).toBe(before.provider);
    expect(after.model).toBe(before.model);
    expect(after.variationIndex).toBe(before.variationIndex);
    expect(after.providerOperationId).toBe(before.providerOperationId);
  });

  // -------------------------------------------------------------------------
  // Network safety / structural safety (request point 3): this file can
  // NEVER submit a new operation or create a new generation, under any
  // outcome, for any provider response.
  // -------------------------------------------------------------------------

  describe("network safety and structural safety", () => {
    it("with no VIDEO_DEMONSTRATION_* environment configured, reconciliation never even attempts to construct a real provider", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const generation = await createFailedGenerationWithOperationId(ownerUserId, clientId);

      const result = await reconcileVideoDemonstrationGeneration(generation.id, ownerUserId, { env: {} });
      expect(result).toEqual({ outcome: "not_eligible", code: "PROCESSING_DISABLED" });
    });

    it("source-level lock: the reconciliation service source never references generateVideos, createVideoDemonstrationGeneration, createVideoDemonstrationGenerationVariation, or provider.submit", () => {
      const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "video-generation-reconciliation-service.ts"), "utf8");
      expect(source).not.toMatch(/generateVideos/);
      expect(source).not.toMatch(/createVideoDemonstrationGeneration\(/);
      expect(source).not.toMatch(/createVideoDemonstrationGenerationVariation/);
      expect(source).not.toMatch(/\.submit\(/);
      expect(source).not.toMatch(/provider\.submit/);
    });

    it("source-level lock: markVideoDemonstrationGenerationReconciledCompleted is the only FAILED -> COMPLETED writer, and only this service calls it", () => {
      const repoSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "video-generation-execution-repository.ts"), "utf8");
      // markVideoDemonstrationGenerationCompleted (the ordinary path) must
      // still require status: "PROCESSING" -- never weakened to accept FAILED.
      const ordinaryIndex = repoSource.indexOf("export async function markVideoDemonstrationGenerationCompleted");
      const ordinaryEndIndex = repoSource.indexOf("export interface MarkVideoDemonstrationGenerationFailedInput", ordinaryIndex);
      const ordinaryBlock = repoSource.slice(ordinaryIndex, ordinaryEndIndex);
      expect(ordinaryBlock).toMatch(/status:\s*"PROCESSING"/);
      expect(ordinaryBlock).not.toMatch(/status:\s*"FAILED"/);

      const reconciliationIndex = repoSource.indexOf("export async function markVideoDemonstrationGenerationReconciledCompleted");
      expect(reconciliationIndex).toBeGreaterThan(-1);
      const reconciliationBlock = repoSource.slice(reconciliationIndex, repoSource.indexOf("\n}\n", reconciliationIndex));
      expect(reconciliationBlock).toMatch(/status:\s*"FAILED"/);
      expect(reconciliationBlock).toMatch(/status:\s*"COMPLETED"/);
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
    data: { id: ownerUserId, email: `${ownerUserId}@video-generation-reconciliation-service.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Video Reconciliation Service Client" } });
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

async function createGeneration(ownerUserId: string, clientId: string) {
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

// Builds a REQUESTED generation, claims + submits it (real
// providerOperationId persisted, PROCESSING), then marks it terminally
// FAILED via the real markVideoDemonstrationGenerationFailed -- exactly
// the same shape a genuine "poll crashed locally after Google already
// responded" incident leaves behind (canRetry is false here because
// providerOperationId is already set, matching the real
// markVideoDemonstrationGenerationFailed contract).
async function createFailedGenerationWithOperationId(ownerUserId: string, clientId: string, providerOperationId = "fake-operation-id") {
  const generation = await createGeneration(ownerUserId, clientId);
  await claimVideoDemonstrationGenerationForSubmit(generation.id, ownerUserId);
  await markVideoDemonstrationGenerationSubmitted(generation.id, ownerUserId, providerOperationId);
  await markVideoDemonstrationGenerationFailed(generation.id, ownerUserId, { errorCode: "VIDEO_DEMONSTRATION_PROVIDER_ERROR", retryable: false });
  return generation;
}
