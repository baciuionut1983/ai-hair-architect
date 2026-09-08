import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createCaptureSet } from "@/lib/capture-set-repository";
import {
  createTechnicalExecutionGenerationRequest,
  grantTechnicalExecutionGenerationConsent,
  recordTechnicalExecutionGenerationQualification,
  sealTechnicalExecutionGenerationRequest,
} from "@/lib/technical-execution-generation-repository";
import {
  claimTechnicalExecutionVideoGenerationForCompletionProcessing,
  claimTechnicalExecutionVideoGenerationForSubmit,
  computeTechnicalExecutionVideoGenerationRequestFingerprint,
  createTechnicalExecutionVideoGeneration,
  findTechnicalExecutionVideoGenerationForOwner,
  isTechnicalExecutionVideoFailureRetryable,
  markTechnicalExecutionVideoGenerationCompleted,
  markTechnicalExecutionVideoGenerationFailed,
  markTechnicalExecutionVideoGenerationSubmitted,
  MAX_TECHNICAL_EXECUTION_VIDEO_SUBMIT_ATTEMPTS,
  rescheduleTechnicalExecutionVideoGenerationPoll,
  TechnicalExecutionVideoGenerationStateError,
} from "@/lib/technical-execution-video-generation-repository";

// AI Hair Architect, Stage 2.5.i.23 -- real Postgres, no mocks. Exercises
// the create/idempotency + claim/submitted/completed/failed state machine
// directly against the repository layer (no provider, no execution-service
// orchestration -- that is technical-execution-video-generation-execution-service.test.ts's
// own job). Mirrors video-generation-execution-repository.test.ts's own
// conventions exactly.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("technical-execution-video-generation-repository (real Central Nape Guide pilot, state machine)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.technicalExecutionVideoGeneration.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.technicalExecutionGenerationRequest.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSetImage.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSet.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  // ---------------------------------------------------------------------------
  // createTechnicalExecutionVideoGeneration
  // ---------------------------------------------------------------------------

  it("creates a REQUESTED row bound to the sealed request id, with the exact provider instruction frozen", async () => {
    const { ownerUserId, clientId, requestId } = await createSealedRequest();

    const outcome = await createTechnicalExecutionVideoGeneration({
      ownerUserId,
      clientId,
      technicalExecutionGenerationRequestId: requestId,
      provider: "google",
      model: "veo-3.1-lite-generate-preview",
      providerInstruction: "EXACT INSTRUCTION",
    });

    expect(outcome.created).toBe(true);
    expect(outcome.record.status).toBe("REQUESTED");
    expect(outcome.record.technicalExecutionGenerationRequestId).toBe(requestId);
    expect(outcome.record.providerInstruction).toBe("EXACT INSTRUCTION");
    expect(outcome.record.attemptCount).toBe(0);
    expect(outcome.record.providerOperationId).toBeNull();
  });

  it("a second create with the same (owner, client, request, provider, model) resolves the existing row -- never creates a duplicate", async () => {
    const { ownerUserId, clientId, requestId } = await createSealedRequest();
    const params = { ownerUserId, clientId, technicalExecutionGenerationRequestId: requestId, provider: "google", model: "veo-3.1-lite-generate-preview", providerInstruction: "A" };

    const first = await createTechnicalExecutionVideoGeneration(params);
    const second = await createTechnicalExecutionVideoGeneration({ ...params, providerInstruction: "DIFFERENT TEXT -- IGNORED" });

    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.providerInstruction).toBe("A");

    const count = await prisma.technicalExecutionVideoGeneration.count({ where: { technicalExecutionGenerationRequestId: requestId } });
    expect(count).toBe(1);
  });

  it("fingerprint is deterministic given the same scope", () => {
    const input = { ownerUserId: "o1", clientId: "c1", technicalExecutionGenerationRequestId: "r1", provider: "google", model: "m1" };
    expect(computeTechnicalExecutionVideoGenerationRequestFingerprint(input)).toBe(computeTechnicalExecutionVideoGenerationRequestFingerprint(input));
    expect(computeTechnicalExecutionVideoGenerationRequestFingerprint(input)).not.toBe(computeTechnicalExecutionVideoGenerationRequestFingerprint({ ...input, model: "m2" }));
  });

  // ---------------------------------------------------------------------------
  // claimTechnicalExecutionVideoGenerationForSubmit
  // ---------------------------------------------------------------------------

  it("claims a REQUESTED row: status -> PROCESSING, attemptCount 1, startedAt set", async () => {
    const { generationId, ownerUserId } = await createGeneration();

    const claim = await claimTechnicalExecutionVideoGenerationForSubmit(generationId, ownerUserId);
    expect(claim).toEqual({ outcome: "claimed", attemptNumber: 1 });

    const row = await prisma.technicalExecutionVideoGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.status).toBe("PROCESSING");
    expect(row.attemptCount).toBe(1);
    expect(row.startedAt).not.toBeNull();
    expect(row.providerOperationId).toBeNull();
  });

  it("rejects NOT_FOUND for a nonexistent id or the wrong owner", async () => {
    const { generationId, ownerUserId } = await createGeneration();
    expect(await claimTechnicalExecutionVideoGenerationForSubmit(randomUUID(), ownerUserId)).toEqual({ outcome: "rejected", code: "NOT_FOUND" });
    expect(await claimTechnicalExecutionVideoGenerationForSubmit(generationId, randomUUID())).toEqual({ outcome: "rejected", code: "NOT_FOUND" });
  });

  it("rejects NOT_ELIGIBLE for a row already PROCESSING with a providerOperationId on file -- never re-claimable for a fresh submit", async () => {
    const { generationId, ownerUserId } = await createGeneration();
    await claimTechnicalExecutionVideoGenerationForSubmit(generationId, ownerUserId);
    await markTechnicalExecutionVideoGenerationSubmitted(generationId, ownerUserId, "operations/real-op-1");

    const claim = await claimTechnicalExecutionVideoGenerationForSubmit(generationId, ownerUserId);
    expect(claim).toEqual({ outcome: "rejected", code: "NOT_ELIGIBLE" });
  });

  it("rejects MAX_ATTEMPTS_EXCEEDED for a REQUESTED row whose attemptCount is already at the cap", async () => {
    const { generationId, ownerUserId } = await createGeneration();
    await prisma.technicalExecutionVideoGeneration.update({ where: { id: generationId }, data: { attemptCount: MAX_TECHNICAL_EXECUTION_VIDEO_SUBMIT_ATTEMPTS } });

    const claim = await claimTechnicalExecutionVideoGenerationForSubmit(generationId, ownerUserId);
    expect(claim).toEqual({ outcome: "rejected", code: "MAX_ATTEMPTS_EXCEEDED" });
  });

  // ---------------------------------------------------------------------------
  // markTechnicalExecutionVideoGenerationSubmitted
  // ---------------------------------------------------------------------------

  it("markSubmitted is a true set-exactly-once write: a second call with a different operation id throws", async () => {
    const { generationId, ownerUserId } = await createGeneration();
    await claimTechnicalExecutionVideoGenerationForSubmit(generationId, ownerUserId);
    await markTechnicalExecutionVideoGenerationSubmitted(generationId, ownerUserId, "operations/first");

    await expect(markTechnicalExecutionVideoGenerationSubmitted(generationId, ownerUserId, "operations/second")).rejects.toBeInstanceOf(TechnicalExecutionVideoGenerationStateError);

    const row = await prisma.technicalExecutionVideoGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.providerOperationId).toBe("operations/first");
  });

  // ---------------------------------------------------------------------------
  // claimTechnicalExecutionVideoGenerationForCompletionProcessing / markCompleted
  // ---------------------------------------------------------------------------

  it("claims completion only after a real submit, and marks COMPLETED with the generated video asset id", async () => {
    const { generationId, ownerUserId } = await createGeneration();
    await claimTechnicalExecutionVideoGenerationForSubmit(generationId, ownerUserId);
    await markTechnicalExecutionVideoGenerationSubmitted(generationId, ownerUserId, "operations/op-1");

    const completionClaim = await claimTechnicalExecutionVideoGenerationForCompletionProcessing(generationId, ownerUserId);
    expect(completionClaim).toEqual({ outcome: "claimed" });

    const videoAssetId = randomUUID();
    await markTechnicalExecutionVideoGenerationCompleted(generationId, ownerUserId, videoAssetId);

    const record = await findTechnicalExecutionVideoGenerationForOwner(ownerUserId, generationId);
    expect(record?.status).toBe("COMPLETED");
    expect(record?.generatedVideoAssetId).toBe(videoAssetId);
    expect(record?.completedAt).not.toBeNull();
  });

  it("rejects a completion claim before any submit exists (no providerOperationId yet)", async () => {
    const { generationId, ownerUserId } = await createGeneration();
    await claimTechnicalExecutionVideoGenerationForSubmit(generationId, ownerUserId);
    const claim = await claimTechnicalExecutionVideoGenerationForCompletionProcessing(generationId, ownerUserId);
    expect(claim).toEqual({ outcome: "rejected", code: "NOT_ELIGIBLE" });
  });

  // ---------------------------------------------------------------------------
  // markTechnicalExecutionVideoGenerationFailed / reschedulePoll / retryability
  // ---------------------------------------------------------------------------

  it("a retryable SUBMIT-phase failure (no operation id yet) requeues to REQUESTED", async () => {
    const { generationId, ownerUserId } = await createGeneration();
    await claimTechnicalExecutionVideoGenerationForSubmit(generationId, ownerUserId);

    const result = await markTechnicalExecutionVideoGenerationFailed(generationId, ownerUserId, { errorCode: "TECHNICAL_EXECUTION_VIDEO_PROVIDER_TIMEOUT", retryable: true });
    expect(result.status).toBe("REQUESTED");
  });

  it("a non-retryable failure is always terminal FAILED, regardless of attempt count", async () => {
    const { generationId, ownerUserId } = await createGeneration();
    await claimTechnicalExecutionVideoGenerationForSubmit(generationId, ownerUserId);

    const result = await markTechnicalExecutionVideoGenerationFailed(generationId, ownerUserId, { errorCode: "TECHNICAL_EXECUTION_VIDEO_PROVIDER_REFUSED", retryable: false });
    expect(result.status).toBe("FAILED");
  });

  it("a retryable failure with a providerOperationId already set is still terminal FAILED -- never resubmitted (guard by construction)", async () => {
    const { generationId, ownerUserId } = await createGeneration();
    await claimTechnicalExecutionVideoGenerationForSubmit(generationId, ownerUserId);
    await markTechnicalExecutionVideoGenerationSubmitted(generationId, ownerUserId, "operations/op-1");
    // Force back to PROCESSING-with-operationId (already true) and call
    // markFailed directly -- simulating a caller that reached this function
    // mistakenly from a poll-phase failure.
    const result = await markTechnicalExecutionVideoGenerationFailed(generationId, ownerUserId, { errorCode: "TECHNICAL_EXECUTION_VIDEO_PROVIDER_TIMEOUT", retryable: true });
    expect(result.status).toBe("FAILED");
  });

  it("reschedulePoll keeps the row PROCESSING with its providerOperationId untouched", async () => {
    const { generationId, ownerUserId } = await createGeneration();
    await claimTechnicalExecutionVideoGenerationForSubmit(generationId, ownerUserId);
    await markTechnicalExecutionVideoGenerationSubmitted(generationId, ownerUserId, "operations/op-1");

    const nextPollAt = new Date(Date.now() + 60_000);
    await rescheduleTechnicalExecutionVideoGenerationPoll(generationId, ownerUserId, nextPollAt);

    const row = await prisma.technicalExecutionVideoGeneration.findUniqueOrThrow({ where: { id: generationId } });
    expect(row.status).toBe("PROCESSING");
    expect(row.providerOperationId).toBe("operations/op-1");
    expect(row.nextPollAt?.getTime()).toBe(nextPollAt.getTime());
  });

  it("isTechnicalExecutionVideoFailureRetryable classifies the known codes correctly", () => {
    expect(isTechnicalExecutionVideoFailureRetryable("TECHNICAL_EXECUTION_VIDEO_PROVIDER_RATE_LIMITED")).toBe(true);
    expect(isTechnicalExecutionVideoFailureRetryable("TECHNICAL_EXECUTION_VIDEO_PROVIDER_REFUSED")).toBe(false);
    expect(isTechnicalExecutionVideoFailureRetryable("TECHNICAL_EXECUTION_VIDEO_PROVIDER_ERROR", true)).toBe(true);
    expect(isTechnicalExecutionVideoFailureRetryable("TECHNICAL_EXECUTION_VIDEO_PROVIDER_ERROR", false)).toBe(false);
    expect(isTechnicalExecutionVideoFailureRetryable("SOME_UNKNOWN_CODE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@technical-execution-video-generation-repository.test`, passwordHash: "test", role: "professional", locale: "en" } });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Technical Execution Video Generation Repository Client" } });
  return { ownerUserId, clientId };
}

async function createImageAsset(ownerUserId: string, clientId: string) {
  return prisma.imageAsset.create({
    data: { id: randomUUID(), fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 12345, ownerUserId, clientId, storagePath: "pending" },
  });
}

async function createSealedRequest() {
  const { ownerUserId, clientId } = await createOwnerAndClient();
  const asset = await createImageAsset(ownerUserId, clientId);
  const captureSet = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "BACK", imageAssetId: asset.id }]);
  const captureSetImage = captureSet.images[0];

  const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
  await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");
  await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");
  await sealTechnicalExecutionGenerationRequest(ownerUserId, request.id);

  return { ownerUserId, clientId, requestId: request.id, imageAssetId: asset.id };
}

async function createGeneration() {
  const { ownerUserId, clientId, requestId } = await createSealedRequest();
  const outcome = await createTechnicalExecutionVideoGeneration({
    ownerUserId,
    clientId,
    technicalExecutionGenerationRequestId: requestId,
    provider: "google",
    model: "veo-3.1-lite-generate-preview",
    providerInstruction: "TEST INSTRUCTION",
  });
  return { generationId: outcome.record.id, ownerUserId, clientId, requestId };
}
