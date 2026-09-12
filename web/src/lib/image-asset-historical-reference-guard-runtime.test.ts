import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { createCaptureSet } from "@/lib/capture-set-repository";
import { createCurrentSnapshotFromAnalysis, createManualSnapshot } from "@/lib/hair-state-snapshot-repository";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { historicalReferenceDatabase } from "@/lib/image-asset-retention-runtime";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";

// RETENTION SAFETY GATE -- real-Postgres proof that each of the 13 real
// queries (image-asset-retention-runtime.ts's own historicalReferenceDatabase)
// actually finds a real row in its own real table, by the real field name.
// This is the one place a wrong column/table name or a missed null-filter
// would show up -- the pure guard test only re-proves the merge logic with
// fakes. Skips (never fails) when no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("historicalReferenceDatabase (real Postgres)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.technicalExecutionGenerationRequest.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.videoDemonstrationGeneration.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.photoPreviewGeneration.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.hairStateSnapshotEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.hairStateSnapshot.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSetImage.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSet.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.technicalVisualMapSpatialBinding.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.technicalVisualMap.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.analysisProposal.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.imageAnalysis.deleteMany({});
    await prisma.analysis.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("2. Analysis.imageAssetId is found for a real Analysis row", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    await createRealAnalysis(ownerUserId, clientId, image.id);

    const found = await historicalReferenceDatabase.analysisByImageAssetId([image.id, randomUUID()]);
    expect(found).toEqual([image.id]);
  });

  it("2b. ImageAnalysis.assetId is found for a real ImageAnalysis row (the cascade-risk edge)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    await prisma.imageAnalysis.create({ data: { id: randomUUID(), assetId: image.id } });

    const found = await historicalReferenceDatabase.imageAnalysisByAssetId([image.id, randomUUID()]);
    expect(found).toEqual([image.id]);
  });

  it("3. CaptureSetImage.imageAssetId is found for a real CaptureSet's image", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: image.id }]);

    const found = await historicalReferenceDatabase.captureSetImageByImageAssetId([image.id, randomUUID()]);
    expect(found).toEqual([image.id]);
  });

  it("4a. AnalysisProposal.sourceImageAssetId is found for a real proposal", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const analysis = await createRealAnalysis(ownerUserId, clientId, null);
    await prisma.analysisProposal.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId,
        vertical: "cutting",
        status: "DRAFT",
        analysisId: analysis.id,
        analysisSnapshotAt: new Date(),
        sourceImageAssetId: image.id,
        engineVersion: "1.0.0-m8",
        evidenceSnapshot: {},
        payload: {},
      },
    });

    const found = await historicalReferenceDatabase.analysisProposalBySourceImageAssetId([image.id, randomUUID()]);
    expect(found).toEqual([image.id]);
  });

  it("4b. TechnicalVisualMap.sourceImageAssetId is found for a real map", async () => {
    const { ownerUserId, clientId, proposalId } = await createOwnerClientAnalysisProposal();
    const image = await createImageAsset(ownerUserId, clientId);
    await prisma.technicalVisualMap.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId,
        analysisProposalId: proposalId,
        vertical: "cutting",
        status: "DRAFT",
        mapVersion: 1,
        schemaVersion: "1.0.0",
        payload: {},
        generatorVersion: "1.0.0",
        sourceImageAssetId: image.id,
      },
    });

    const found = await historicalReferenceDatabase.technicalVisualMapBySourceImageAssetId([image.id, randomUUID()]);
    expect(found).toEqual([image.id]);
  });

  it("4c. TechnicalVisualMapSpatialBinding.sourceImageAssetId is found for a real spatial binding", async () => {
    const { ownerUserId, clientId, proposalId } = await createOwnerClientAnalysisProposal();
    const image = await createImageAsset(ownerUserId, clientId);
    const map = await prisma.technicalVisualMap.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId,
        analysisProposalId: proposalId,
        vertical: "cutting",
        status: "CONFIRMED",
        mapVersion: 1,
        schemaVersion: "1.0.0",
        payload: {},
        generatorVersion: "1.0.0",
      },
    });
    await prisma.technicalVisualMapSpatialBinding.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId,
        technicalVisualMapId: map.id,
        sourceImageAssetId: image.id,
        viewLabel: "front",
        status: "DRAFT",
        spatialVersion: 1,
        geometrySchemaVersion: "1.0.0",
        payload: {},
        frozenWidth: 800,
        frozenHeight: 600,
        frozenOrientation: 1,
      },
    });

    const found = await historicalReferenceDatabase.technicalVisualMapSpatialBindingBySourceImageAssetId([image.id, randomUUID()]);
    expect(found).toEqual([image.id]);
  });

  it("5. HairStateSnapshotEvidence.imageAssetId is found for TARGET_REFERENCE and RESULT_GENERATED_PREVIEW roles alike (real rows)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const referenceImage = await createImageAsset(ownerUserId, clientId);
    const generatedPreview = await prisma.imageAsset.create({
      data: { id: randomUUID(), fileName: "preview.jpg", mimeType: "image/jpeg", sizeBytes: 1, ownerUserId, clientId, storagePath: "pending", origin: "ai_generated" },
    });
    const payload: HairStateSnapshotPayload = { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((z) => buildUnassessedZoneEntry(z)) };

    await createManualSnapshot(ownerUserId, clientId, "TARGET", payload, {}, [
      { evidenceKind: "IMAGE_ASSET", evidenceRole: "TARGET_REFERENCE", imageAssetId: referenceImage.id },
    ]);
    await createManualSnapshot(ownerUserId, clientId, "RESULT", payload, {}, [
      { evidenceKind: "IMAGE_ASSET", evidenceRole: "RESULT_GENERATED_PREVIEW", imageAssetId: generatedPreview.id },
    ]);

    const found = await historicalReferenceDatabase.hairStateSnapshotEvidenceByImageAssetId([referenceImage.id, generatedPreview.id, randomUUID()]);
    expect([...found].sort()).toEqual([generatedPreview.id, referenceImage.id].sort());
  });

  it("5b. HairStateSnapshot.sourceImageAssetId (Stage 2's own field, distinct from HairStateSnapshotEvidence) is found for a real snapshot", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const analysis = await createRealAnalysis(ownerUserId, clientId, image.id);
    await createCurrentSnapshotFromAnalysisForTest(ownerUserId, clientId, analysis.id);

    const found = await historicalReferenceDatabase.hairStateSnapshotBySourceImageAssetId([image.id, randomUUID()]);
    expect(found).toEqual([image.id]);
  });

  it("6a. PhotoPreviewGeneration.sourceImageAssetId is found for a real generation row", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    await prisma.photoPreviewGeneration.create({ data: await photoPreviewGenerationFixture(ownerUserId, clientId, { sourceImageAssetId: image.id }) });

    const found = await historicalReferenceDatabase.photoPreviewGenerationBySourceImageAssetId([image.id, randomUUID()]);
    expect(found).toEqual([image.id]);
  });

  it("6b. PhotoPreviewGeneration.generatedImageAssetId (the RESULT/preview image) is found distinctly", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const sourceImage = await createImageAsset(ownerUserId, clientId);
    const generatedImage = await createImageAsset(ownerUserId, clientId);
    await prisma.photoPreviewGeneration.create({
      data: await photoPreviewGenerationFixture(ownerUserId, clientId, { sourceImageAssetId: sourceImage.id, generatedImageAssetId: generatedImage.id }),
    });

    const foundGenerated = await historicalReferenceDatabase.photoPreviewGenerationByGeneratedImageAssetId([generatedImage.id, sourceImage.id]);
    expect(foundGenerated).toEqual([generatedImage.id]);
  });

  it("7. VideoDemonstrationGeneration.sourceGeneratedImageAssetId is found for a real video generation row", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    await prisma.videoDemonstrationGeneration.create({ data: await videoDemonstrationGenerationFixture(ownerUserId, clientId, { sourceGeneratedImageAssetId: image.id }) });

    const found = await historicalReferenceDatabase.videoDemonstrationGenerationBySourceGeneratedImageAssetId([image.id, randomUUID()]);
    expect(found).toEqual([image.id]);
  });

  it("8. TechnicalExecutionGenerationRequest.imageAssetId is found for a real generation request", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const captureSet = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "BACK", imageAssetId: image.id }]);
    const captureSetImageId = captureSet.images[0].id;

    await prisma.technicalExecutionGenerationRequest.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId,
        purpose: "TECHNICAL_EXECUTION_VIDEO",
        captureSetId: captureSet.id,
        captureSetImageId,
        imageAssetId: image.id,
        qualificationStatus: "NOT_EVALUATED",
      },
    });

    const found = await historicalReferenceDatabase.technicalExecutionGenerationRequestByImageAssetId([image.id, randomUUID()]);
    expect(found).toEqual([image.id]);
  });

  it("9. an image with zero real references anywhere is found by none of the 13 sources", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const results = await Promise.all([
      historicalReferenceDatabase.analysisByImageAssetId([image.id]),
      historicalReferenceDatabase.imageAnalysisByAssetId([image.id]),
      historicalReferenceDatabase.analysisProposalBySourceImageAssetId([image.id]),
      historicalReferenceDatabase.technicalVisualMapBySourceImageAssetId([image.id]),
      historicalReferenceDatabase.technicalVisualMapSpatialBindingBySourceImageAssetId([image.id]),
      historicalReferenceDatabase.hairStateSnapshotBySourceImageAssetId([image.id]),
      historicalReferenceDatabase.hairStateSnapshotEvidenceByImageAssetId([image.id]),
      historicalReferenceDatabase.captureSetImageByImageAssetId([image.id]),
      historicalReferenceDatabase.photoPreviewGenerationBySourceImageAssetId([image.id]),
      historicalReferenceDatabase.photoPreviewGenerationByGeneratedImageAssetId([image.id]),
      historicalReferenceDatabase.videoDemonstrationGenerationBySourceGeneratedImageAssetId([image.id]),
      historicalReferenceDatabase.technicalExecutionGenerationRequestByImageAssetId([image.id]),
      historicalReferenceDatabase.professionalLearningEvidenceByImageAssetId([image.id]),
    ]);
    expect(results.every((r) => r.length === 0)).toBe(true);
  });

  it("10. ProfessionalLearningEvidence.imageAssetId is found for a real IMAGE evidence row (Stage 8.5L2)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    await createLearningEvidence(ownerUserId, {
      evidenceType: "IMAGE",
      vertical: "hair_cutting",
      imageAssetId: image.id,
      provenance: { channel: "upload" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const found = await historicalReferenceDatabase.professionalLearningEvidenceByImageAssetId([image.id, randomUUID()]);
    expect(found).toEqual([image.id]);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let fingerprintCounter = 0;

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@retention-guard-runtime.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Retention Guard Runtime Client" } });
  return { ownerUserId, clientId };
}

async function createImageAsset(ownerUserId: string, clientId: string) {
  return prisma.imageAsset.create({
    data: { id: randomUUID(), fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 12345, ownerUserId, clientId, storagePath: "pending" },
  });
}

async function createCurrentSnapshotFromAnalysisForTest(ownerUserId: string, clientId: string, analysisId: string) {
  return createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId);
}

async function createRealAnalysis(ownerUserId: string, clientId: string, imageAssetId: string | null) {
  return createAnalysisForOwner(ownerUserId, clientId, {
    goal: "reshape",
    hairType: "medium",
    density: "medium",
    porosity: "low",
    phase: "ready",
    clarificationRound: 0,
    confidenceScore: 0.9,
    uncertaintyReasons: [],
    followUpQuestions: [],
    recommendations: ["Document the service."],
    safetyNotes: ["Perform a strand test."],
    ...(imageAssetId ? { imageAssetId } : {}),
  });
}

async function createOwnerClientAnalysisProposal() {
  const { ownerUserId, clientId } = await createOwnerAndClient();
  const analysis = await createRealAnalysis(ownerUserId, clientId, null);
  const proposal = await prisma.analysisProposal.create({
    data: {
      id: randomUUID(),
      ownerUserId,
      clientId,
      vertical: "cutting",
      status: "CONFIRMED",
      analysisId: analysis.id,
      analysisSnapshotAt: new Date(),
      engineVersion: "1.0.0-m8",
      evidenceSnapshot: {},
      payload: {},
    },
  });
  return { ownerUserId, clientId, proposalId: proposal.id };
}

async function photoPreviewGenerationFixture(ownerUserId: string, clientId: string, overrides: { sourceImageAssetId: string; generatedImageAssetId?: string }) {
  fingerprintCounter += 1;
  return {
    id: randomUUID(),
    ownerUserId,
    clientId,
    analysisProposalId: randomUUID(),
    analysisProposalConfirmedAt: new Date(),
    technicalVisualMapId: randomUUID(),
    mapVersion: 1,
    spatialBindingId: randomUUID(),
    spatialVersion: 1,
    sourceImageAssetId: overrides.sourceImageAssetId,
    generatedImageAssetId: overrides.generatedImageAssetId ?? null,
    viewLabel: "front",
    frozenSourceWidth: 800,
    frozenSourceHeight: 600,
    frozenSourceOrientation: 1,
    provider: "gemini",
    model: "gemini-test",
    generationSchemaVersion: "1.0.0",
    sealedRequest: {},
    requestFingerprint: `retention-guard-runtime-ppg-${fingerprintCounter}`,
    variationIndex: 0,
    status: "REQUESTED",
  };
}

async function videoDemonstrationGenerationFixture(ownerUserId: string, clientId: string, overrides: { sourceGeneratedImageAssetId: string }) {
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
    sourceGeneratedImageAssetId: overrides.sourceGeneratedImageAssetId,
    provider: "veo",
    model: "veo-test",
    generationSchemaVersion: "1.0.0",
    sealedRequest: {},
    requestFingerprint: `retention-guard-runtime-vdg-${fingerprintCounter}`,
    variationIndex: 0,
    status: "REQUESTED",
  };
}
