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
  claimVideoDemonstrationGenerationForCompletionProcessing,
  claimVideoDemonstrationGenerationForSubmit,
  findDueVideoDemonstrationGenerationsForRecovery,
  isVideoDemonstrationFailureRetryable,
  markVideoDemonstrationGenerationCompleted,
  markVideoDemonstrationGenerationFailed,
  markVideoDemonstrationGenerationSubmitted,
  MAX_PROVIDER_SUBMIT_ATTEMPTS_PER_GENERATION,
  scheduleVideoDemonstrationNextPoll,
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

  it("providerOperationId is left untouched on a SUBMIT-phase requeue -- a permanent audit trail is never needed here since providerOperationId was never set for a submit-phase failure in the first place", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId); // claimed, but never submitted -- providerOperationId still null

    await markVideoDemonstrationGenerationFailed(generationId, ownerUserId, { errorCode: "VIDEO_DEMONSTRATION_PROVIDER_ERROR", retryable: true });
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.status).toBe("REQUESTED"); // safe to requeue -- no operation was ever created
    expect(row.providerOperationId).toBeNull();
  });

  it("Stage 3 correctness fix: a RETRYABLE failure reported for a row that already has a providerOperationId is NEVER requeued to REQUESTED -- it goes terminal FAILED instead, since REQUESTED would make it wrongly submit-claimable again while the real operation might still be alive", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
    await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-audit-trail");

    // A poll-time failure classified retryable (e.g. a transient
    // invalid-response) MUST NOT route through this function at all in
    // real code (video-generation-execution-service.ts now uses
    // scheduleVideoDemonstrationNextPoll for that case instead) -- this
    // test proves the function is safe BY CONSTRUCTION even if it were
    // called here by mistake: it degrades to terminal FAILED, never a
    // resubmission risk.
    const result = await markVideoDemonstrationGenerationFailed(generationId, ownerUserId, { errorCode: "VIDEO_DEMONSTRATION_PROVIDER_INVALID_RESPONSE", retryable: true });
    expect(result).toEqual({ status: "FAILED" });
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.status).toBe("FAILED");
    expect(row.providerOperationId).toBe("op-audit-trail"); // still a permanent audit trail
  });

  it("markVideoDemonstrationGenerationFailed throws for a nonexistent/foreign-owner row", async () => {
    const { generationId } = await createGeneration();
    await expect(markVideoDemonstrationGenerationFailed(randomUUID(), randomUUID(), { errorCode: "X", retryable: false })).rejects.toThrow(VideoDemonstrationExecutionStateError);
    void generationId;
  });

  // -------------------------------------------------------------------------
  // markVideoDemonstrationGenerationSubmitted -- Stage 2 self-healing retry
  // -------------------------------------------------------------------------

  it("Stage 2: markVideoDemonstrationGenerationSubmitted self-heals when the row ALREADY carries the exact operationId being set -- treated as success, not a conflict", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
    // Simulates "an earlier attempt in the same retry loop actually landed
    // at the database, but the caller never received confirmation" --
    // pre-set the row to exactly what a real prior success would look like.
    await prisma.videoDemonstrationGeneration.update({ where: { id: generationId }, data: { providerOperationId: "op-already-recorded", submittedAt: new Date() } });

    // Must NOT throw -- this is the self-healing path, not a real conflict.
    await expect(markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-already-recorded")).resolves.toBeUndefined();
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.providerOperationId).toBe("op-already-recorded"); // unchanged, not corrupted
  });

  it("Stage 2: markVideoDemonstrationGenerationSubmitted still throws for a GENUINE conflict -- a different operationId already on file is never silently accepted", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
    await prisma.videoDemonstrationGeneration.update({ where: { id: generationId }, data: { providerOperationId: "op-different-real-operation", submittedAt: new Date() } });

    await expect(markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-new-attempt")).rejects.toThrow(VideoDemonstrationExecutionStateError);
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.providerOperationId).toBe("op-different-real-operation"); // never overwritten
  });

  it("Stage 2: markVideoDemonstrationGenerationSubmitted resets a stale completionClaimedAt from an earlier attempt -- never suppresses the fresh attempt's own completion claim", async () => {
    const { ownerUserId, generationId } = await createGeneration();
    await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
    // Simulate a leftover completion-claim timestamp from a hypothetical
    // earlier attempt on this same row.
    await prisma.videoDemonstrationGeneration.update({ where: { id: generationId }, data: { completionClaimedAt: new Date() } });

    await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-fresh-attempt");
    const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.completionClaimedAt).toBeNull();
  });

  // -------------------------------------------------------------------------
  // claimVideoDemonstrationGenerationForCompletionProcessing -- Stage 2
  // -------------------------------------------------------------------------

  describe("claimVideoDemonstrationGenerationForCompletionProcessing", () => {
    it("claims a PROCESSING row that already has a providerOperationId and no prior completion claim", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
      await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-1");

      const claim = await claimVideoDemonstrationGenerationForCompletionProcessing(generationId, ownerUserId);
      expect(claim).toEqual({ outcome: "claimed" });
      const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
      expect(row.completionClaimedAt).not.toBeNull();
    });

    it("rejects NOT_ELIGIBLE for a row that has not been submitted yet (no providerOperationId) -- completion processing is never claimable before a real submit", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);

      expect(await claimVideoDemonstrationGenerationForCompletionProcessing(generationId, ownerUserId)).toEqual({ outcome: "rejected", code: "NOT_ELIGIBLE" });
    });

    it("rejects NOT_ELIGIBLE for a REQUESTED row (not currently PROCESSING at all)", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      expect(await claimVideoDemonstrationGenerationForCompletionProcessing(generationId, ownerUserId)).toEqual({ outcome: "rejected", code: "NOT_ELIGIBLE" });
    });

    it("rejects NOT_ELIGIBLE for an already-claimed, non-stale completion in progress -- a concurrent caller must never also process the same completion", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
      await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-1");
      await claimVideoDemonstrationGenerationForCompletionProcessing(generationId, ownerUserId);

      expect(await claimVideoDemonstrationGenerationForCompletionProcessing(generationId, ownerUserId)).toEqual({ outcome: "rejected", code: "NOT_ELIGIBLE" });
    });

    it("accepts (re-claims) a STALE completion claim -- crash recovery for a process that died mid-download/persist", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
      await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-1");
      await claimVideoDemonstrationGenerationForCompletionProcessing(generationId, ownerUserId);
      await prisma.videoDemonstrationGeneration.update({ where: { id: generationId }, data: { completionClaimedAt: new Date(Date.now() - VIDEO_DEMONSTRATION_STALE_CLAIM_TIMEOUT_MS - 1000) } });

      expect(await claimVideoDemonstrationGenerationForCompletionProcessing(generationId, ownerUserId)).toEqual({ outcome: "claimed" });
    });

    it("rejects NOT_FOUND for a nonexistent id or the wrong owner -- never leaks whether a foreign generation exists", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      expect(await claimVideoDemonstrationGenerationForCompletionProcessing(randomUUID(), ownerUserId)).toEqual({ outcome: "rejected", code: "NOT_FOUND" });
      expect(await claimVideoDemonstrationGenerationForCompletionProcessing(generationId, randomUUID())).toEqual({ outcome: "rejected", code: "NOT_FOUND" });
    });

    it("under a real concurrent race, exactly one caller wins the completion claim", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
      await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-1");

      const results = await Promise.all(Array.from({ length: 5 }, () => claimVideoDemonstrationGenerationForCompletionProcessing(generationId, ownerUserId)));
      const claimed = results.filter((r) => r.outcome === "claimed");
      expect(claimed.length).toBe(1);
    });
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

  // -------------------------------------------------------------------------
  // findDueVideoDemonstrationGenerationsForRecovery -- Stage 3, task §4
  // -------------------------------------------------------------------------

  describe("findDueVideoDemonstrationGenerationsForRecovery", () => {
    it("a REQUESTED row is always due", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      const due = await findDueVideoDemonstrationGenerationsForRecovery(new Date(), 10);
      expect(due.some((d) => d.id === generationId && d.ownerUserId === ownerUserId)).toBe(true);
    });

    it("a PROCESSING row with a providerOperationId and no nextPollAt yet is due (never polled before)", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
      await prisma.videoDemonstrationGeneration.update({ where: { id: generationId }, data: { providerOperationId: "op-1", nextPollAt: null } });

      const due = await findDueVideoDemonstrationGenerationsForRecovery(new Date(), 10);
      expect(due.some((d) => d.id === generationId)).toBe(true);
    });

    it("a PROCESSING row with a FUTURE nextPollAt is NOT due yet", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
      const now = new Date();
      await prisma.videoDemonstrationGeneration.update({ where: { id: generationId }, data: { providerOperationId: "op-1", nextPollAt: new Date(now.getTime() + 60_000) } });

      const due = await findDueVideoDemonstrationGenerationsForRecovery(now, 10);
      expect(due.some((d) => d.id === generationId)).toBe(false);
    });

    it("a PROCESSING row whose nextPollAt has elapsed IS due", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
      const now = new Date();
      await prisma.videoDemonstrationGeneration.update({ where: { id: generationId }, data: { providerOperationId: "op-1", nextPollAt: new Date(now.getTime() - 1000) } });

      const due = await findDueVideoDemonstrationGenerationsForRecovery(now, 10);
      expect(due.some((d) => d.id === generationId)).toBe(true);
    });

    it("a fresh (non-stale) PROCESSING row with no providerOperationId is NOT due -- someone else may be actively mid-submit", async () => {
      const { generationId } = await createGeneration();
      await claimVideoDemonstrationGenerationForSubmit(generationId, (await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } })).ownerUserId);

      const due = await findDueVideoDemonstrationGenerationsForRecovery(new Date(), 10);
      expect(due.some((d) => d.id === generationId)).toBe(false);
    });

    it("a STALE PROCESSING row with no providerOperationId IS due -- a crashed claim, recoverable", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
      await prisma.videoDemonstrationGeneration.update({ where: { id: generationId }, data: { startedAt: new Date(Date.now() - VIDEO_DEMONSTRATION_STALE_CLAIM_TIMEOUT_MS - 1000) } });

      const due = await findDueVideoDemonstrationGenerationsForRecovery(new Date(), 10);
      expect(due.some((d) => d.id === generationId)).toBe(true);
    });

    it("COMPLETED and FAILED rows are never due", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
      await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-1");
      const asset = await prisma.videoAsset.create({
        data: { id: randomUUID(), ownerUserId, clientId: (await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } })).clientId, mimeType: "video/mp4", sizeBytes: 10, storagePath: "p" },
      });
      await markVideoDemonstrationGenerationCompleted(generationId, ownerUserId, { generatedVideoAssetId: asset.id });

      const due = await findDueVideoDemonstrationGenerationsForRecovery(new Date(), 10);
      expect(due.some((d) => d.id === generationId)).toBe(false);
    });

    it("respects the limit and orders oldest-requested-first", async () => {
      const first = await createGeneration();
      const second = await createGeneration();
      const due = await findDueVideoDemonstrationGenerationsForRecovery(new Date(), 1);
      expect(due).toHaveLength(1);
      expect(due[0].id).toBe(first.generationId);
      void second;
    });
  });

  describe("scheduleVideoDemonstrationNextPoll", () => {
    it("sets nextPollAt on a PROCESSING row with a providerOperationId", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
      await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, "op-1");
      const nextPollAt = new Date(Date.now() + 30_000);

      await scheduleVideoDemonstrationNextPoll(generationId, ownerUserId, nextPollAt);
      const row = await prisma.videoDemonstrationGeneration.findUniqueOrThrow({ where: { id: generationId } });
      expect(row.nextPollAt?.getTime()).toBe(nextPollAt.getTime());
      expect(row.status).toBe("PROCESSING"); // untouched
    });

    it("throws for a row with no providerOperationId (never legal to schedule a poll for something never submitted)", async () => {
      const { ownerUserId, generationId } = await createGeneration();
      await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId);
      await expect(scheduleVideoDemonstrationNextPoll(generationId, ownerUserId, new Date())).rejects.toThrow(VideoDemonstrationExecutionStateError);
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
