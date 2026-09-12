import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { videoHistoricalReferenceDatabase } from "@/lib/video-asset-historical-reference-guard-runtime";

// VIDEO RETENTION SAFETY GATE -- real-Postgres proof that each of the 3
// real queries (video-asset-historical-reference-guard-runtime.ts's own
// videoHistoricalReferenceDatabase) actually finds a real row in its own
// real table, by the real field name. Mirrors
// image-asset-historical-reference-guard-runtime.test.ts's own convention
// exactly. Skips (never fails) when no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

let fingerprintCounter = 0;

suite("videoHistoricalReferenceDatabase (real Postgres)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.technicalExecutionVideoGeneration.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.videoDemonstrationGeneration.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.technicalExecutionGenerationRequest.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSetImage.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSet.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("1. VideoDemonstrationGeneration.generatedVideoAssetId is found for a real Result Video generation row", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const video = await createVideoAsset(ownerUserId, clientId);
    await prisma.videoDemonstrationGeneration.create({ data: await videoDemonstrationGenerationFixture(ownerUserId, clientId, video.id) });

    const found = await videoHistoricalReferenceDatabase.videoDemonstrationGenerationByGeneratedVideoAssetId([video.id, randomUUID()]);
    expect(found).toEqual([video.id]);
  });

  it("2. TechnicalExecutionVideoGeneration.generatedVideoAssetId is found for a real technical-execution generation row", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const video = await createVideoAsset(ownerUserId, clientId);
    const image = await createImageAsset(ownerUserId, clientId);
    const captureSet = await prisma.captureSet.create({ data: { id: randomUUID(), ownerUserId, clientId, captureSetVersion: 1 } });
    const captureSetImage = await prisma.captureSetImage.create({
      data: { id: randomUUID(), ownerUserId, clientId, captureSetId: captureSet.id, imageAssetId: image.id, viewLabel: "FRONT" },
    });
    const request = await prisma.technicalExecutionGenerationRequest.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId,
        purpose: "TECHNICAL_EXECUTION_VIDEO",
        captureSetId: captureSet.id,
        captureSetImageId: captureSetImage.id,
        imageAssetId: image.id,
        qualificationStatus: "NOT_EVALUATED",
      },
    });

    fingerprintCounter += 1;
    await prisma.technicalExecutionVideoGeneration.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId,
        technicalExecutionGenerationRequestId: request.id,
        provider: "veo",
        model: "veo-test",
        providerInstruction: "test instruction",
        requestFingerprint: `video-guard-runtime-tevg-${fingerprintCounter}`,
        status: "REQUESTED",
        generatedVideoAssetId: video.id,
      },
    });

    const found = await videoHistoricalReferenceDatabase.technicalExecutionVideoGenerationByGeneratedVideoAssetId([video.id, randomUUID()]);
    expect(found).toEqual([video.id]);
  });

  it("3. ProfessionalLearningEvidence.videoAssetId is found for a real VIDEO evidence row (Stage 8.5L2)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const video = await createVideoAsset(ownerUserId, clientId);
    await createLearningEvidence(ownerUserId, {
      evidenceType: "VIDEO",
      vertical: "hair_cutting",
      videoAssetId: video.id,
      provenance: { channel: "upload" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const found = await videoHistoricalReferenceDatabase.professionalLearningEvidenceByVideoAssetId([video.id, randomUUID()]);
    expect(found).toEqual([video.id]);
  });

  it("4. a video with zero real references anywhere is found by none of the 3 sources", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const video = await createVideoAsset(ownerUserId, clientId);
    const results = await Promise.all([
      videoHistoricalReferenceDatabase.videoDemonstrationGenerationByGeneratedVideoAssetId([video.id]),
      videoHistoricalReferenceDatabase.technicalExecutionVideoGenerationByGeneratedVideoAssetId([video.id]),
      videoHistoricalReferenceDatabase.professionalLearningEvidenceByVideoAssetId([video.id]),
    ]);
    expect(results.every((r) => r.length === 0)).toBe(true);
  });
});

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@video-guard-runtime.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Video Guard Runtime Client" } });
  return { ownerUserId, clientId };
}

async function createImageAsset(ownerUserId: string, clientId: string) {
  return prisma.imageAsset.create({
    data: { id: randomUUID(), fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 12345, ownerUserId, clientId, storagePath: "pending" },
  });
}

async function createVideoAsset(ownerUserId: string, clientId: string) {
  return prisma.videoAsset.create({
    data: { id: randomUUID(), ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: 12345, storagePath: "pending" },
  });
}

async function videoDemonstrationGenerationFixture(ownerUserId: string, clientId: string, generatedVideoAssetId: string) {
  fingerprintCounter += 1;
  return {
    id: randomUUID(),
    ownerUserId,
    clientId,
    photoPreviewGenerationId: randomUUID(),
    analysisProposalId: randomUUID(),
    analysisProposalConfirmedAt: new Date(),
    technicalVisualMapId: randomUUID(),
    mapVersion: 1,
    spatialBindingId: randomUUID(),
    spatialVersion: 1,
    sourceGeneratedImageAssetId: randomUUID(),
    provider: "veo",
    model: "veo-test",
    generationSchemaVersion: "1.0.0",
    sealedRequest: {},
    requestFingerprint: `video-guard-runtime-vdg-${fingerprintCounter}`,
    variationIndex: 0,
    status: "REQUESTED",
    generatedVideoAssetId,
  };
}
