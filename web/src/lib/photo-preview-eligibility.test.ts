import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { prisma } from "@/lib/prisma";
import { confirmProposal, createProposalForOwner, findCurrentConfirmedProposal } from "@/lib/proposal-repository";
import { confirmDraftMap, createDraftFromConfirmedProposal, type TechnicalVisualMapRecord } from "@/lib/technical-visual-map-repository";
import { confirmSpatialBinding, createDraftSpatialBinding, type TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";
import { createPhotoPreviewGeneration } from "@/lib/photo-preview-generation-repository";
import { findEligibleCompletedPhotoPreview } from "@/lib/photo-preview-eligibility";

// AI Concierge / Orchestrator, Gap #3 -- real Postgres, no mocks, mirroring
// photo-preview-generation-repository.test.ts's own fixture helpers and
// conventions exactly. No provider is ever called: createPhotoPreviewGeneration
// only ever allocates a REQUESTED row (a real sealed request, no network
// call); every terminal status this file needs is set directly via a plain
// Prisma update, never through the real execution path.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("findEligibleCompletedPhotoPreview (Gap #3 -- server-authoritative discovery)", () => {
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

  it("a real eligible COMPLETED generation is discovered, with its real id", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);
    const generation = await completedGeneration(ownerUserId, clientId, binding.id);

    const result = await findEligibleCompletedPhotoPreview(ownerUserId, clientId);

    expect(result).toEqual({ eligible: true, photoPreviewGenerationId: generation.id });
  });

  it("no confirmed proposal at all -- not eligible", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const result = await findEligibleCompletedPhotoPreview(ownerUserId, clientId);
    expect(result).toEqual({ eligible: false, photoPreviewGenerationId: null });
  });

  it("a confirmed proposal but no confirmed Technical Visual Map -- not eligible", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    await confirmedProposal(ownerUserId, clientId, analysis.id);

    const result = await findEligibleCompletedPhotoPreview(ownerUserId, clientId);
    expect(result.eligible).toBe(false);
  });

  it("a confirmed map but no confirmed spatial binding -- not eligible", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    await createConfirmedMap(ownerUserId, clientId);

    const result = await findEligibleCompletedPhotoPreview(ownerUserId, clientId);
    expect(result.eligible).toBe(false);
  });

  it("a confirmed spatial binding with no generation at all -- not eligible", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    await createConfirmedChain(ownerUserId, clientId);

    const result = await findEligibleCompletedPhotoPreview(ownerUserId, clientId);
    expect(result.eligible).toBe(false);
  });

  it("a FAILED generation only -- not eligible", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);
    const generation = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");
    await prisma.photoPreviewGeneration.update({ where: { id: generation.record.id }, data: { status: "FAILED", errorCode: "PROVIDER_ERROR" } });

    const result = await findEligibleCompletedPhotoPreview(ownerUserId, clientId);
    expect(result.eligible).toBe(false);
  });

  it("a PROCESSING generation only -- not eligible", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);
    const generation = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");
    await prisma.photoPreviewGeneration.update({ where: { id: generation.record.id }, data: { status: "PROCESSING" } });

    const result = await findEligibleCompletedPhotoPreview(ownerUserId, clientId);
    expect(result.eligible).toBe(false);
  });

  it("a REQUESTED generation only -- not eligible", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);
    await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");

    const result = await findEligibleCompletedPhotoPreview(ownerUserId, clientId);
    expect(result.eligible).toBe(false);
  });

  it("a COMPLETED row with no generatedImageAssetId (should be structurally impossible, but defended anyway) -- not eligible", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);
    const generation = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");
    await prisma.photoPreviewGeneration.update({ where: { id: generation.record.id }, data: { status: "COMPLETED", generatedImageAssetId: null } });

    const result = await findEligibleCompletedPhotoPreview(ownerUserId, clientId);
    expect(result.eligible).toBe(false);
  });

  it("multiple independent CONFIRMED view scopes -- eligible if ANY one of them has a real completed result", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const frontAsset = await createImageAsset(ownerUserId, clientId);
    const backAsset = await createImageAsset(ownerUserId, clientId);
    const frontDraft = await createDraftSpatialBinding(ownerUserId, clientId, map.id, frontAsset.id, "front");
    const frontBinding = await confirmSpatialBinding(ownerUserId, frontDraft.id, null);
    const backDraft = await createDraftSpatialBinding(ownerUserId, clientId, map.id, backAsset.id, "back");
    const backBinding = await confirmSpatialBinding(ownerUserId, backDraft.id, null);
    if (!frontBinding || !backBinding) throw new Error("expected both confirmed bindings");

    // Only the BACK view has a real completed result -- front has nothing.
    const generation = await completedGeneration(ownerUserId, clientId, backBinding.id);

    const result = await findEligibleCompletedPhotoPreview(ownerUserId, clientId);
    expect(result).toEqual({ eligible: true, photoPreviewGenerationId: generation.id });
  });

  it("STALE AUTHORITY: a completed preview bound to a SUPERSEDED proposal's own old chain is never eligible once a newer proposal is confirmed", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);
    await completedGeneration(ownerUserId, clientId, binding.id);
    // Sanity: eligible under the ORIGINAL (still current) proposal.
    expect((await findEligibleCompletedPhotoPreview(ownerUserId, clientId)).eligible).toBe(true);

    // A brand-new analysis + proposal gets confirmed for the SAME client --
    // this becomes the new "current confirmed proposal"; the old one, and
    // everything built on it, is no longer the authoritative chain. Real
    // optimistic-concurrency semantics (confirmProposal.test.ts's own
    // convention) require passing the id of the proposal actually being
    // superseded, not null -- null means "expect no proposal confirmed yet",
    // which is only true the very first time.
    const currentlyConfirmed = await findCurrentConfirmedProposal(ownerUserId, clientId, "cutting");
    if (!currentlyConfirmed) throw new Error("expected an existing confirmed proposal to supersede");
    const newAnalysis = await createAnalysis(ownerUserId, clientId);
    const newDraft = await createProposalForOwner(ownerUserId, clientId, newAnalysis.id, "cutting", cuttingPayload(), evidenceSnapshot(), "1.0.0-m8");
    const superseding = await confirmProposal(ownerUserId, newDraft.id, ownerUserId, currentlyConfirmed.id);
    if (!superseding) throw new Error("expected the new proposal to supersede the old one");

    const result = await findEligibleCompletedPhotoPreview(ownerUserId, clientId);
    // The new proposal has no map/binding/preview of its own yet -- the OLD
    // completed preview must never leak through as if it were still current.
    expect(result.eligible).toBe(false);
  });

  it("cross-owner isolation: another owner's eligible preview never leaks", async () => {
    const { ownerUserId: ownerA, clientId: clientA } = await createOwnerAndClient();
    const { ownerUserId: ownerB, clientId: clientB } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerB, clientB);
    await completedGeneration(ownerB, clientB, binding.id);

    const result = await findEligibleCompletedPhotoPreview(ownerA, clientA);
    expect(result.eligible).toBe(false);
  });

  it("cross-client isolation: another client of the SAME owner never leaks", async () => {
    const { ownerUserId, clientId: clientA } = await createOwnerAndClient();
    const { clientId: clientB } = await createOwnerAndClient(ownerUserId);
    const { binding } = await createConfirmedChain(ownerUserId, clientB);
    await completedGeneration(ownerUserId, clientB, binding.id);

    const result = await findEligibleCompletedPhotoPreview(ownerUserId, clientA);
    expect(result.eligible).toBe(false);
  });

  it("fails closed on a read error -- never treated as eligible", async () => {
    const result = await findEligibleCompletedPhotoPreview("owner-x", "client-x", {
      findCurrentConfirmedProposal: async () => {
        throw new Error("boom");
      },
    });
    expect(result).toEqual({ eligible: false, photoPreviewGenerationId: null });
  });
});

async function createOwnerAndClient(existingOwnerUserId?: string) {
  const ownerUserId = existingOwnerUserId ?? randomUUID();
  const clientId = randomUUID();
  if (!existingOwnerUserId) {
    owners.add(ownerUserId);
    await prisma.user.create({
      data: { id: ownerUserId, email: `${ownerUserId}@photo-preview-eligibility.test`, passwordHash: "test", role: "professional", locale: "en" },
    });
  }
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Photo Preview Eligibility Client" } });
  return { ownerUserId, clientId };
}

async function createAnalysis(ownerUserId: string, clientId: string) {
  return createAnalysisForOwner(ownerUserId, clientId, {
    goal: "refresh",
    hairType: "medium",
    density: "medium",
    porosity: "low",
    phase: "ready",
    clarificationRound: 0,
    confidenceScore: 0.87,
    uncertaintyReasons: [],
    followUpQuestions: [],
    recommendations: ["Document the service."],
    safetyNotes: ["Perform a strand test."],
  });
}

function cuttingPayload(): TechnicalCutPlan {
  return {
    structuralTechnique: "graduation",
    cuttingTechnique: "slice_cutting",
    texturizingTechnique: "point_cutting",
    sectioning: "diagonal_back",
    elevation: "45_deg_graduation",
    distribution: "overdirected_back",
    guideline: "stationary",
    cuttingSteps: [{ stepNumber: 1, zone: "nape", action: "Establish the guideline", elevationAngle: "45_deg_graduation", toolRequired: "shears" }],
    stylistExplanation: "x",
    clientExplanation: "x",
    professionalReason: "x",
    warnings: [],
    contraindications: [],
    assumptions: [],
    missingData: [],
    confidence: 0.9,
    stylistValidationDisclaimer: "x",
    version: "1.0.0-m8",
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
    data: {
      id: randomUUID(),
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 12345,
      ownerUserId,
      clientId,
      storagePath: "pending",
      width: 1080,
      height: 1440,
    },
  });
}

async function createConfirmedChain(
  ownerUserId: string,
  clientId: string,
): Promise<{ map: TechnicalVisualMapRecord; binding: TechnicalVisualMapSpatialBindingRecord }> {
  const map = await createConfirmedMap(ownerUserId, clientId);
  const asset = await createImageAsset(ownerUserId, clientId);
  const draftBinding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
  const binding = await confirmSpatialBinding(ownerUserId, draftBinding.id, null);
  if (!binding) throw new Error("expected confirmed spatial binding");
  return { map, binding };
}

// Creates a real REQUESTED row (createPhotoPreviewGeneration -- no provider
// call, just a real sealed request + DB row) then flips it to COMPLETED with
// a real generatedImageAssetId directly via Prisma -- never through the
// real execution path, which would call a provider.
async function completedGeneration(ownerUserId: string, clientId: string, spatialBindingId: string) {
  const outcome = await createPhotoPreviewGeneration(ownerUserId, clientId, spatialBindingId, "gemini", "gemini-3.1-flash-image");
  const outputAsset = await createImageAsset(ownerUserId, clientId);
  return prisma.photoPreviewGeneration.update({
    where: { id: outcome.record.id },
    data: { status: "COMPLETED", generatedImageAssetId: outputAsset.id },
  });
}
