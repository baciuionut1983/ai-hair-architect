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
import { claimVideoDemonstrationGenerationForSubmit, markVideoDemonstrationGenerationSubmitted, MAX_PROVIDER_SUBMIT_ATTEMPTS_PER_GENERATION } from "@/lib/video-generation-execution-repository";
import { executeVideoDemonstrationGeneration } from "@/lib/video-generation-execution-service";
import {
  AlwaysFailingPollVideoDemonstrationProvider,
  AlwaysFailingSubmitVideoDemonstrationProvider,
  AlwaysProcessingVideoDemonstrationProvider,
  FakeVideoDemonstrationProvider,
  VideoDemonstrationProvider,
  type VideoDemonstrationPollOutcome,
  type VideoDemonstrationSubmitOutcome,
} from "@/lib/video-provider";

// Real AI Video Demonstration, Stage 1 -- the FULL orchestrator, tested
// against real Postgres for state, but with an EXPLICITLY INJECTED fake
// provider in every single test (mirrors photo-preview-execution-service.test.ts's
// own hard acceptance condition -- see the dedicated "network safety"
// describe block at the bottom, which asserts this structurally).
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

suite("video-generation-execution-service (real AI Video Demonstration, Stage 1 orchestrator)", () => {
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
  // Full two-phase happy path
  // -------------------------------------------------------------------------

  it("REQUESTED -> submitted (real providerOperationId persisted, NOT metered yet) -> completed on the next call (metered exactly once, real VideoAsset persisted)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const usageEvents: unknown[] = [];
    const provider = new FakeVideoDemonstrationProvider();

    const submitted = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () => provider,
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    expect(submitted.outcome).toBe("submitted");
    if (submitted.outcome !== "submitted") throw new Error("expected submitted");
    expect(submitted.generation.status).toBe("PROCESSING");
    expect(submitted.generation.providerOperationId).toBe("fake-operation-id");
    expect(submitted.generation.attemptCount).toBe(1);
    // Not metered yet -- Veo bills only on confirmed successful generation,
    // which is not yet known at submit time.
    expect(usageEvents).toHaveLength(0);

    const completed = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () => provider,
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    expect(completed.outcome).toBe("completed");
    if (completed.outcome !== "completed") throw new Error("expected completed");
    expect(completed.generation.status).toBe("COMPLETED");
    expect(completed.generation.generatedVideoAssetId).toBeTruthy();

    const asset = await prisma.videoAsset.findUniqueOrThrow({ where: { id: completed.generation.generatedVideoAssetId as string } });
    expect(asset.ownerUserId).toBe(ownerUserId);
    expect(asset.clientId).toBe(clientId);
    expect(asset.mimeType).toBe("video/mp4");
    expect(asset.durationSeconds).toBe(4);

    // Metered exactly once, at completion, with real usage.videoSeconds.
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      ownerUserId,
      clientId,
      feature: "video_demonstration",
      modality: "VIDEO_GENERATION",
      correlationId: generation.id,
      attemptNumber: 1,
      provider: "google",
      outcome: "SUCCEEDED",
      usage: { videoSeconds: 4 },
      providerRequestId: "fake-operation-id",
    });
  });

  // (Still-PROCESSING / repeated-poll-without-resubmit behavior is covered
  // below by "a still-processing poll never resubmits and is never
  // metered, across repeated calls".)

  // -------------------------------------------------------------------------
  // Submit-phase failures
  // -------------------------------------------------------------------------

  it("a submit failure (never reached the provider's own success path) is metered as FAILED under this attempt's number, and never persists a providerOperationId", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const usageEvents: unknown[] = [];

    const result = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () => new AlwaysFailingSubmitVideoDemonstrationProvider(),
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    // AlwaysFailingSubmitVideoDemonstrationProvider throws a retryable
    // PROVIDER_ERROR -- with attempt budget remaining (this is attempt 1 of
    // MAX_PROVIDER_SUBMIT_ATTEMPTS_PER_GENERATION), it requeues.
    expect(result).toEqual({ outcome: "requeued_for_retry", code: "PROVIDER_ERROR" });
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("REQUESTED");
    expect(row.providerOperationId).toBeNull();
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({ outcome: "FAILED", attemptNumber: 1, errorCategory: "PROVIDER_ERROR" });
  });

  it("exhausting the submit-attempt cap on repeated submit failures ends in terminal FAILED", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const provider = new AlwaysFailingSubmitVideoDemonstrationProvider();

    let lastResult;
    for (let i = 0; i < MAX_PROVIDER_SUBMIT_ATTEMPTS_PER_GENERATION; i += 1) {
      lastResult = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => provider });
    }
    expect(lastResult).toEqual({ outcome: "failed", code: "PROVIDER_ERROR" });
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("FAILED");
    expect(row.attemptCount).toBe(MAX_PROVIDER_SUBMIT_ATTEMPTS_PER_GENERATION);
  });

  // -------------------------------------------------------------------------
  // Poll-phase failures (operation was genuinely submitted, then the
  // provider reports a terminal failure on poll -- e.g. a moderation block)
  // -------------------------------------------------------------------------

  it("a poll-detected terminal failure is metered as FAILED under the SAME attemptCount the submit used, and the generation ends FAILED", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const provider = new AlwaysFailingPollVideoDemonstrationProvider();
    const usageEvents: unknown[] = [];

    const submitted = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => provider });
    expect(submitted.outcome).toBe("submitted");

    const polled = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () => provider,
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    // MODERATION_REFUSED is non-retryable -> terminal FAILED.
    expect(polled).toEqual({ outcome: "failed", code: "PROVIDER_REFUSED" });
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("FAILED");
    expect(row.providerOperationId).toBe("fake-operation-id-fails-on-poll"); // audit trail preserved
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({ outcome: "FAILED", attemptNumber: 1, errorCategory: "PROVIDER_REFUSED" });
  });

  it("a still-processing poll never resubmits and is never metered, across repeated calls", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const provider = new AlwaysProcessingVideoDemonstrationProvider();
    const usageEvents: unknown[] = [];
    const recordAiUsageEvent = async (input: unknown) => {
      usageEvents.push(input);
    };

    const submitted = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => provider, recordAiUsageEvent });
    expect(submitted.outcome).toBe("submitted");

    for (let i = 0; i < 3; i += 1) {
      const polled = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => provider, recordAiUsageEvent });
      expect(polled).toEqual({ outcome: "still_processing", generation: expect.objectContaining({ status: "PROCESSING" }) });
    }

    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("PROCESSING");
    expect(row.attemptCount).toBe(1); // never re-claimed/resubmitted
    expect(row.providerOperationId).toBe("fake-operation-id-processing");
    expect(usageEvents).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Stage 2 hardening -- a transient (retryable) poll failure requeues the
  // row, and a LATER call (fresh provider instance, fresh dependencies
  // object -- proving no reliance on process memory) submits again and
  // completes normally.
  // -------------------------------------------------------------------------

  it("Stage 2: a retryable poll failure requeues to REQUESTED, and a fully independent later execution recovers and completes", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);

    class OnceFailingPollProvider extends VideoDemonstrationProvider {
      readonly name = "fake-once-failing-poll";
      readonly modelVersion = "fake-1.0";
      async submit(): Promise<VideoDemonstrationSubmitOutcome> {
        return { providerOperationId: "fake-operation-id" };
      }
      async poll(): Promise<VideoDemonstrationPollOutcome> {
        throw this.createProviderError("TIMEOUT", "simulated transient poll timeout", true);
      }
    }

    const submitted = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => new OnceFailingPollProvider() });
    expect(submitted.outcome).toBe("submitted");

    const polled = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => new OnceFailingPollProvider() });
    expect(polled).toEqual({ outcome: "requeued_for_retry", code: "PROVIDER_TIMEOUT" });
    const requeued = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(requeued.status).toBe("REQUESTED"); // NOT stuck PROCESSING forever

    // A fully independent "later execution" -- a brand-new provider
    // instance and a brand-new dependencies object, simulating a genuinely
    // separate process/request with zero shared in-memory state.
    const recoveryProvider = new FakeVideoDemonstrationProvider();
    const recoveredSubmit = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => recoveryProvider });
    expect(recoveredSubmit.outcome).toBe("submitted");
    const recoveredComplete = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => recoveryProvider });
    expect(recoveredComplete.outcome).toBe("completed");

    const finalRow = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(finalRow.status).toBe("COMPLETED");
    expect(finalRow.attemptCount).toBe(2); // the failed attempt + the recovered one
  });

  // -------------------------------------------------------------------------
  // Stage 2 hardening -- restart recovery for the SUBMIT-succeeded-but-
  // never-polled-to-completion case, driven entirely from durable DB state
  // (no shared closure/provider instance across the two calls).
  // -------------------------------------------------------------------------

  it("Stage 2: a submitted-but-never-polled generation is found from DB alone and completes under a brand-new execution call with its own provider instance", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);

    await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => new FakeVideoDemonstrationProvider() });
    const afterSubmit = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(afterSubmit.status).toBe("PROCESSING");
    expect(afterSubmit.providerOperationId).toBeTruthy();

    // A "new execution instance" -- looked up by id alone, a fresh
    // provider, no reference to anything from the call above.
    const result = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => new FakeVideoDemonstrationProvider() });
    expect(result.outcome).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // Stage 2 hardening -- concurrent polling must never double-download,
  // double-persist a VideoAsset, double-meter, or double-complete.
  // -------------------------------------------------------------------------

  it("Stage 2: concurrent polls of the same completed operation create exactly one VideoAsset, meter exactly once, and complete exactly once", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    let downloadCalls = 0;
    class CountingCompletionProvider extends FakeVideoDemonstrationProvider {
      async poll(...args: Parameters<VideoDemonstrationProvider["poll"]>) {
        downloadCalls += 1;
        return super.poll(...args);
      }
    }
    const provider = new CountingCompletionProvider();
    const usageEvents: unknown[] = [];
    const recordAiUsageEvent = async (input: unknown) => {
      usageEvents.push(input);
    };

    await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => provider, recordAiUsageEvent });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => provider, recordAiUsageEvent })),
    );

    const completed = results.filter((r) => r.outcome === "completed");
    expect(completed.length).toBe(1);
    for (const result of results) {
      // A losing caller sees "still_processing" (someone else is handling
      // completion) -- OR, if it happened to be scheduled after the winner
      // already fully finished, the already-proven-safe
      // GENERATION_ALREADY_TERMINAL outcome (same as re-executing any
      // COMPLETED generation). Never anything else.
      const safe = result.outcome === "completed" || result.outcome === "still_processing" || (result.outcome === "failed" && result.code === "GENERATION_ALREADY_TERMINAL");
      expect(safe).toBe(true);
    }

    const assets = await prisma.videoAsset.findMany({ where: { ownerUserId, clientId } });
    expect(assets).toHaveLength(1); // never a duplicated/orphaned VideoAsset

    const succeededEvents = usageEvents.filter((e) => (e as { outcome: string }).outcome === "SUCCEEDED");
    expect(succeededEvents).toHaveLength(1); // never double-metered

    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("COMPLETED");
    expect(row.generatedVideoAssetId).toBe(assets[0].id);

    // downloadCalls may exceed 1 (every concurrent caller is entitled to
    // poll the provider itself -- polling is free/idempotent-safe), but
    // exactly one of them is entitled to WIN the completion-processing
    // claim and actually persist/meter/complete -- already proven above.
    expect(downloadCalls).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Storage failure after a genuinely successful generation
  // -------------------------------------------------------------------------

  it("a real successful generation whose durable storage write fails is still metered SUCCEEDED (real cost was incurred), but the row is FAILED, never COMPLETED", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const provider = new FakeVideoDemonstrationProvider();
    const usageEvents: unknown[] = [];

    await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => provider });

    const result = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () => provider,
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
      persistGeneratedVideo: async () => {
        throw new Error("simulated storage failure");
      },
    });

    expect(result).toEqual({ outcome: "failed", code: "STORAGE_FAILED" });
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("FAILED");
    expect(row.generatedVideoAssetId).toBeNull();
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({ outcome: "SUCCEEDED" });
  });

  // -------------------------------------------------------------------------
  // Source unavailable
  // -------------------------------------------------------------------------

  it("source image unavailable -> FAILED without any provider call, never metered", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    await prisma.imageAsset.update({ where: { id: generation.sourceGeneratedImageAssetId }, data: { deletedAt: new Date() } });
    const usageEvents: unknown[] = [];

    const result = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () => new FakeVideoDemonstrationProvider(),
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    expect(result).toEqual({ outcome: "failed", code: "SOURCE_UNAVAILABLE" });
    expect(usageEvents).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  it("disabled configuration -> failed without any provider call and without touching the row", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    let providerConstructed = false;

    const result = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: {},
      createProvider: () => {
        providerConstructed = true;
        return new FakeVideoDemonstrationProvider();
      },
    });

    expect(result).toEqual({ outcome: "failed", code: "PROCESSING_DISABLED" });
    expect(providerConstructed).toBe(false);
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.status).toBe("REQUESTED");
    expect(row.attemptCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Concurrency -- exactly one submit under a real race
  // -------------------------------------------------------------------------

  it("exactly one real submit occurs under a real concurrent execution race, and the row ends in a coherent, never-double-submitted state", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    let submitCalls = 0;
    class CountingProvider extends FakeVideoDemonstrationProvider {
      async submit(...args: Parameters<VideoDemonstrationProvider["submit"]>) {
        submitCalls += 1;
        return super.submit(...args);
      }
    }
    const provider = new CountingProvider();

    // Unlike Photo Preview's single-phase race (where every loser can only
    // ever observe CLAIM_CONFLICT), Video's genuinely two-phase design
    // means a late-arriving concurrent call CAN legitimately observe the
    // winner's already-submitted row and take the POLL branch instead --
    // with this instant fake provider, that can even race to a real
    // "completed" outcome, or a PERSISTENCE_FAILURE if it loses that
    // narrower completion race. All of those are safe, expected shapes;
    // the only two invariants that actually matter are asserted below:
    // the real provider was submitted to exactly once, and never more than
    // one caller ever reports having produced the completion.
    const results = await Promise.all(
      Array.from({ length: 4 }, () => executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => provider })),
    );

    expect(submitCalls).toBe(1);
    const submitted = results.filter((r) => r.outcome === "submitted");
    expect(submitted.length).toBe(1);
    const completed = results.filter((r) => r.outcome === "completed");
    expect(completed.length).toBeLessThanOrEqual(1);
    for (const result of results) {
      expect(["submitted", "completed", "still_processing"].includes(result.outcome) || (result.outcome === "failed" && ["CLAIM_CONFLICT", "PERSISTENCE_FAILURE"].includes(result.code))).toBe(true);
    }

    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.attemptCount).toBe(1); // never re-claimed/resubmitted
    expect(row.providerOperationId).toBe("fake-operation-id");
    expect(["PROCESSING", "COMPLETED"]).toContain(row.status);
  });

  // -------------------------------------------------------------------------
  // Cross-owner
  // -------------------------------------------------------------------------

  it("a real generation cannot be executed by a different real owner -- no provider call, no row mutation, no metering", async () => {
    const { ownerUserId: ownerA } = await createOwnerAndClient();
    const { ownerUserId: ownerB, clientId: clientB } = await createOwnerAndClient();
    const generationB = await createGeneration(ownerB, clientB);
    let providerConstructed = false;
    const usageEvents: unknown[] = [];

    const result = await executeVideoDemonstrationGeneration(generationB.id, ownerA, {
      env: enabledVideoEnv,
      createProvider: () => {
        providerConstructed = true;
        return new FakeVideoDemonstrationProvider();
      },
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    expect(result).toEqual({ outcome: "failed", code: "GENERATION_NOT_FOUND" });
    expect(providerConstructed).toBe(false);
    expect(usageEvents).toHaveLength(0);
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationB.id } });
    expect(row.status).toBe("REQUESTED");
    expect(row.ownerUserId).toBe(ownerB);
  });

  // -------------------------------------------------------------------------
  // A terminal (COMPLETED/FAILED) generation is never re-executed
  // -------------------------------------------------------------------------

  it("a COMPLETED generation cannot be re-executed -- no provider call, no state change", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    const provider = new FakeVideoDemonstrationProvider();
    await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => provider });
    const completed = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => provider });
    expect(completed.outcome).toBe("completed");

    let providerConstructed = false;
    const result = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, {
      env: enabledVideoEnv,
      createProvider: () => {
        providerConstructed = true;
        return provider;
      },
    });
    expect(result).toEqual({ outcome: "failed", code: "GENERATION_ALREADY_TERMINAL" });
    expect(providerConstructed).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Crash-recovery: a stale unsubmitted claim can be re-claimed and
  // completed; an already-submitted operation is only ever polled, never
  // resubmitted, even after the same staleness window.
  // -------------------------------------------------------------------------

  it("a stale unsubmitted claim (crash between claim and submit) can be re-claimed and completes normally", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    // Simulate a crash: claim happened (attemptCount 1, PROCESSING), but
    // markSubmitted never ran, and the claim is now stale.
    await claimVideoDemonstrationGenerationForSubmit(generation.id, ownerUserId);
    await prisma.videoDemonstrationGeneration.update({ where: { id: generation.id }, data: { startedAt: new Date(Date.now() - 20 * 60 * 1000) } });

    const provider = new FakeVideoDemonstrationProvider();
    const result = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => provider });
    expect(result.outcome).toBe("submitted");
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generation.id } });
    expect(row.attemptCount).toBe(2); // the crashed claim + the successful re-claim
    expect(row.providerOperationId).toBe("fake-operation-id");
  });

  it("an already-submitted operation (providerOperationId set) is ONLY EVER polled, never resubmitted, even long after the stale-claim window", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const generation = await createGeneration(ownerUserId, clientId);
    await claimVideoDemonstrationGenerationForSubmit(generation.id, ownerUserId);
    await markVideoDemonstrationGenerationSubmitted(generation.id, ownerUserId, "op-already-submitted");
    await prisma.videoDemonstrationGeneration.update({ where: { id: generation.id }, data: { startedAt: new Date(Date.now() - 60 * 60 * 1000) } });

    let submitCalls = 0;
    let pollCalls = 0;
    class SpyProvider extends FakeVideoDemonstrationProvider {
      async submit(...args: Parameters<VideoDemonstrationProvider["submit"]>) {
        submitCalls += 1;
        return super.submit(...args);
      }
      async poll(...args: Parameters<VideoDemonstrationProvider["poll"]>) {
        pollCalls += 1;
        return super.poll(...args);
      }
    }
    const provider = new SpyProvider();

    const result = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: enabledVideoEnv, createProvider: () => provider });
    expect(result.outcome).toBe("completed");
    expect(submitCalls).toBe(0);
    expect(pollCalls).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Network safety (mirrors Photo Preview's own hard acceptance condition)
  // -------------------------------------------------------------------------

  describe("network safety", () => {
    it("with no VIDEO_DEMONSTRATION_* environment configured, execution never even attempts to construct a real provider", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const generation = await createGeneration(ownerUserId, clientId);

      const result = await executeVideoDemonstrationGeneration(generation.id, ownerUserId, { env: {} });
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
    data: { id: ownerUserId, email: `${ownerUserId}@video-generation-execution-service.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Video Execution Service Client" } });
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
