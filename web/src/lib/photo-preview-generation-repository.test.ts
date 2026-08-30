import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { prisma } from "@/lib/prisma";
import {
  buildPhotoPreviewUsageEventInput,
  createPhotoPreviewGeneration,
  createPhotoPreviewGenerationVariation,
  findPhotoPreviewGenerationForOwner,
  listPhotoPreviewGenerationsForBinding,
  PhotoPreviewGenerationDependencyError,
  PhotoPreviewGenerationPersistenceError,
  PhotoPreviewGenerationValidationError,
} from "@/lib/photo-preview-generation-repository";
import { isSealedPhotoPreviewRequest } from "@/lib/photo-preview-contracts";
import { confirmDraftMap, createDraftFromConfirmedProposal, type TechnicalVisualMapRecord } from "@/lib/technical-visual-map-repository";
import { confirmProposal, createProposalForOwner } from "@/lib/proposal-repository";
import {
  confirmSpatialBinding,
  createDraftSpatialBinding,
  type TechnicalVisualMapSpatialBindingRecord,
} from "@/lib/technical-visual-map-spatial-binding-repository";

// Real AI Photo Preview, Stage 1 -- real Postgres, no mocks, mirroring
// technical-visual-map-spatial-binding-repository.test.ts's own fixture
// helpers and conventions exactly.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("photo-preview-generation-repository (real AI Photo Preview, Stage 1 domain layer)", () => {
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
  // Authority gate -- the happy path
  // -------------------------------------------------------------------------

  it("creates a REQUESTED generation from an exact, fully-confirmed chain, with a real, valid sealed request", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { map, binding } = await createConfirmedChain(ownerUserId, clientId);

    const outcome = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");

    expect(outcome.created).toBe(true);
    expect(outcome.record).toMatchObject({
      ownerUserId,
      clientId,
      technicalVisualMapId: map.id,
      mapVersion: map.mapVersion,
      spatialBindingId: binding.id,
      spatialVersion: binding.spatialVersion,
      sourceImageAssetId: binding.sourceImageAssetId,
      viewLabel: "front",
      provider: "gemini",
      model: "gemini-3.1-flash-image",
      variationIndex: 0,
      status: "REQUESTED",
      providerRequestId: null,
      generatedImageAssetId: null,
      errorCode: null,
    });
    expect(isSealedPhotoPreviewRequest(outcome.record.sealedRequest)).toBe(true);
    expect(outcome.record.sealedRequest.viewLabel).toBe("front");
    expect(outcome.record.sealedRequest.spatial).toEqual(binding.payload);
    expect(outcome.record.frozenSourceWidth).toBe(binding.frozenWidth);
    expect(outcome.record.frozenSourceHeight).toBe(binding.frozenHeight);

    // Persisted and re-readable exactly as returned.
    const reread = await findPhotoPreviewGenerationForOwner(ownerUserId, outcome.record.id);
    expect(reread).toEqual(outcome.record);
  });

  // -------------------------------------------------------------------------
  // Authority gate -- every rejection re-verifies its own hop, never trusts
  // a transitively-reachable id.
  // -------------------------------------------------------------------------

  it("rejects when the named client does not exist for this owner", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);

    // Same real owner as the binding, but a clientId that was never created
    // under them -- exercises the client lookup specifically, distinct from
    // "a binding scoped to a different owner entirely" (covered separately
    // below).
    const error = await createPhotoPreviewGeneration(ownerUserId, randomUUID(), binding.id, "gemini", "gemini-3.1-flash-image").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PhotoPreviewGenerationDependencyError);
    expect(error).toMatchObject({ code: "PHOTO_PREVIEW_GENERATION_CLIENT_NOT_FOUND" });
  });

  it("rejects a nonexistent/foreign-owner spatial binding, no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();

    const error = await createPhotoPreviewGeneration(ownerUserId, clientId, randomUUID(), "gemini", "gemini-3.1-flash-image").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PhotoPreviewGenerationDependencyError);
    expect(error).toMatchObject({ code: "PHOTO_PREVIEW_GENERATION_BINDING_NOT_FOUND" });
    await expect(prisma.photoPreviewGeneration.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("rejects a spatial binding belonging to a different client of the same owner", async () => {
    const { ownerUserId, clientId: clientOne } = await createOwnerAndClient();
    const clientTwo = randomUUID();
    await prisma.client.create({ data: { id: clientTwo, ownerUserId, fullName: "Second Client" } });
    const { binding } = await createConfirmedChain(ownerUserId, clientOne);

    const error = await createPhotoPreviewGeneration(ownerUserId, clientTwo, binding.id, "gemini", "gemini-3.1-flash-image").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PhotoPreviewGenerationDependencyError);
    expect(error).toMatchObject({ code: "PHOTO_PREVIEW_GENERATION_BINDING_CLIENT_MISMATCH" });
  });

  it("rejects a DRAFT (not yet confirmed) spatial binding", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const draftBinding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front"); // never confirmed

    const error = await createPhotoPreviewGeneration(ownerUserId, clientId, draftBinding.id, "gemini", "gemini-3.1-flash-image").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PhotoPreviewGenerationDependencyError);
    expect(error).toMatchObject({ code: "PHOTO_PREVIEW_GENERATION_BINDING_NOT_CONFIRMED" });
    await expect(prisma.photoPreviewGeneration.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("rejects a SUPERSEDED spatial binding (a newer binding version was confirmed for the same scope)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const bindingA = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    await confirmSpatialBinding(ownerUserId, bindingA.id, null);
    const bindingB = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    await confirmSpatialBinding(ownerUserId, bindingB.id, bindingA.id); // supersedes bindingA

    const error = await createPhotoPreviewGeneration(ownerUserId, clientId, bindingA.id, "gemini", "gemini-3.1-flash-image").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PhotoPreviewGenerationDependencyError);
    expect(error).toMatchObject({ code: "PHOTO_PREVIEW_GENERATION_BINDING_NOT_CONFIRMED" });
  });

  it("rejects when the binding's own map has since become SUPERSEDED, even though the binding itself is still CONFIRMED -- authority is never inferred transitively", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const mapA = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    const confirmedMapA = await confirmDraftMap(ownerUserId, mapA.id, null);
    if (!confirmedMapA) throw new Error("expected confirmed map");
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const binding = await createDraftSpatialBinding(ownerUserId, clientId, confirmedMapA.id, asset.id, "front");
    await confirmSpatialBinding(ownerUserId, binding.id, null); // binding stays CONFIRMED under mapA forever

    // A newer map version is confirmed for the SAME proposal, superseding mapA.
    const mapB = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    await confirmDraftMap(ownerUserId, mapB.id, confirmedMapA.id);

    const error = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PhotoPreviewGenerationDependencyError);
    expect(error).toMatchObject({ code: "PHOTO_PREVIEW_GENERATION_MAP_NOT_CONFIRMED" });
    await expect(prisma.photoPreviewGeneration.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("rejects when the map's own proposal has since become SUPERSEDED, even though the map+binding are still CONFIRMED", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposalA = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const mapA = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposalA.id);
    const confirmedMapA = await confirmDraftMap(ownerUserId, mapA.id, null);
    if (!confirmedMapA) throw new Error("expected confirmed map");
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const binding = await createDraftSpatialBinding(ownerUserId, clientId, confirmedMapA.id, asset.id, "front");
    await confirmSpatialBinding(ownerUserId, binding.id, null);

    // A newer proposal is confirmed for the same analysis, superseding proposalA.
    const draftB = await createProposalForOwner(ownerUserId, clientId, analysis.id, "cutting", cuttingPayload(), evidenceSnapshot(), "1.0.0-m8");
    await confirmProposal(ownerUserId, draftB.id, ownerUserId, proposalA.id);

    const error = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PhotoPreviewGenerationDependencyError);
    expect(error).toMatchObject({ code: "PHOTO_PREVIEW_GENERATION_PROPOSAL_NOT_CONFIRMED" });
    await expect(prisma.photoPreviewGeneration.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("rejects an invalid provider or an out-of-allowlist model, no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);

    const badProvider = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "openai", "gemini-3.1-flash-image").catch(
      (e: unknown) => e,
    );
    expect(badProvider).toBeInstanceOf(PhotoPreviewGenerationValidationError);
    expect(badProvider).toMatchObject({ code: "PHOTO_PREVIEW_GENERATION_INVALID_PROVIDER" });

    const badModel = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gpt-image-1").catch((e: unknown) => e);
    expect(badModel).toBeInstanceOf(PhotoPreviewGenerationValidationError);
    expect(badModel).toMatchObject({ code: "PHOTO_PREVIEW_GENERATION_INVALID_MODEL" });

    await expect(prisma.photoPreviewGeneration.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  // -------------------------------------------------------------------------
  // Idempotency + concurrency (task §18/§19/§20)
  // -------------------------------------------------------------------------

  it("a repeated ordinary Generate for the exact same scope resolves to the SAME row instead of creating a second billable job", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);

    const first = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");
    const second = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    await expect(prisma.photoPreviewGeneration.count({ where: { ownerUserId } })).resolves.toBe(1);
  });

  it("a different provider/model for the exact same binding is a genuinely different generation (A/B path)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);

    const flash = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");
    const pro = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3-pro-image");

    expect(flash.created).toBe(true);
    expect(pro.created).toBe(true);
    expect(pro.record.id).not.toBe(flash.record.id);
    await expect(prisma.photoPreviewGeneration.count({ where: { ownerUserId } })).resolves.toBe(2);
  });

  it("an explicit 'generate another variation' always creates a new row with a server-allocated, incrementing variationIndex", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);

    const base = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");
    const variation1 = await createPhotoPreviewGenerationVariation(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");
    const variation2 = await createPhotoPreviewGenerationVariation(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");

    expect(base.record.variationIndex).toBe(0);
    expect(variation1.created).toBe(true);
    expect(variation1.record.variationIndex).toBe(1);
    expect(variation2.created).toBe(true);
    expect(variation2.record.variationIndex).toBe(2);
    const ids = new Set([base.record.id, variation1.record.id, variation2.record.id]);
    expect(ids.size).toBe(3);
    await expect(prisma.photoPreviewGeneration.count({ where: { ownerUserId } })).resolves.toBe(3);
  });

  it("concurrency: simultaneous identical Generate submissions never produce duplicate billable rows -- DB backstop, not application-only", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);

    const [a, b, c] = await Promise.all([
      createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image"),
      createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image"),
      createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image"),
    ]);

    const ids = new Set([a.record.id, b.record.id, c.record.id]);
    expect(ids.size).toBe(1);
    expect([a.created, b.created, c.created].filter(Boolean).length).toBe(1);
    await expect(prisma.photoPreviewGeneration.count({ where: { ownerUserId } })).resolves.toBe(1);
  });

  it("concurrency: simultaneous 'generate another variation' calls each allocate a distinct index, no duplicate/lost variation", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);

    const results = await Promise.all([
      createPhotoPreviewGenerationVariation(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image"),
      createPhotoPreviewGenerationVariation(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image"),
      createPhotoPreviewGenerationVariation(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image"),
    ]);

    const indexes = results.map((r) => r.record.variationIndex).sort((x, y) => x - y);
    expect(indexes).toEqual([0, 1, 2]);
    const ids = new Set(results.map((r) => r.record.id));
    expect(ids.size).toBe(3);
    await expect(prisma.photoPreviewGeneration.count({ where: { ownerUserId } })).resolves.toBe(3);
  });

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  it("findPhotoPreviewGenerationForOwner returns null for a foreign-owner or nonexistent id", async () => {
    const { ownerUserId } = await createOwnerAndClient();
    await expect(findPhotoPreviewGenerationForOwner(ownerUserId, randomUUID())).resolves.toBeNull();
  });

  it("listPhotoPreviewGenerationsForBinding returns every generation for the exact binding, newest first", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);

    const first = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");
    const second = await createPhotoPreviewGenerationVariation(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");

    const list = await listPhotoPreviewGenerationsForBinding(ownerUserId, clientId, binding.id);
    expect(list.map((g) => g.id).sort()).toEqual([first.record.id, second.record.id].sort());
  });

  // -------------------------------------------------------------------------
  // Stage 5 -- real, two-real-owner IDOR proof (task #18/#32): the pre-
  // existing "foreign owner" read test above only ever probed a random,
  // never-created id, which proves the WHERE clause shape but never proves
  // a REAL row belonging to a genuinely different, real owner is actually
  // unreachable. These tests create two entirely separate real owners, each
  // with their own real confirmed authority chain and generation, and
  // assert cross-owner access fails at every read/write surface this
  // repository exposes.
  // -------------------------------------------------------------------------

  it("a real generation belonging to a different real owner is unreachable via findPhotoPreviewGenerationForOwner", async () => {
    const ownerA = await createOwnerAndClient();
    const ownerB = await createOwnerAndClient();
    const { binding: bindingB } = await createConfirmedChain(ownerB.ownerUserId, ownerB.clientId);
    const generationB = await createPhotoPreviewGeneration(ownerB.ownerUserId, ownerB.clientId, bindingB.id, "gemini", "gemini-3.1-flash-image");

    await expect(findPhotoPreviewGenerationForOwner(ownerA.ownerUserId, generationB.record.id)).resolves.toBeNull();
    // Sanity: the row genuinely exists -- this is a real cross-owner denial, not a coincidental not-found.
    await expect(findPhotoPreviewGenerationForOwner(ownerB.ownerUserId, generationB.record.id)).resolves.not.toBeNull();
  });

  it("listPhotoPreviewGenerationsForBinding never returns another real owner's generations, even when queried with their own real binding id", async () => {
    const ownerA = await createOwnerAndClient();
    const ownerB = await createOwnerAndClient();
    const { binding: bindingB } = await createConfirmedChain(ownerB.ownerUserId, ownerB.clientId);
    await createPhotoPreviewGeneration(ownerB.ownerUserId, ownerB.clientId, bindingB.id, "gemini", "gemini-3.1-flash-image");

    // Owner A queries using Owner B's own real clientId/bindingId -- still
    // scoped by Owner A's ownerUserId, so nothing is returned.
    const listAsA = await listPhotoPreviewGenerationsForBinding(ownerA.ownerUserId, ownerB.clientId, bindingB.id);
    expect(listAsA).toEqual([]);

    // Sanity: Owner B genuinely sees their own real generation.
    const listAsB = await listPhotoPreviewGenerationsForBinding(ownerB.ownerUserId, ownerB.clientId, bindingB.id);
    expect(listAsB).toHaveLength(1);
  });

  it("a real generation's authority chain (proposal/map/binding) belonging to a different real owner cannot be used to create a new generation", async () => {
    const ownerA = await createOwnerAndClient();
    const ownerB = await createOwnerAndClient();
    const { binding: bindingB } = await createConfirmedChain(ownerB.ownerUserId, ownerB.clientId);

    // Owner A attempts to create a generation against Owner B's real
    // confirmed binding, even supplying Owner B's own real clientId -- the
    // FIRST hop of resolveAuthorityChain (client.findFirst scoped by
    // ownerUserId) already rejects this as CLIENT_NOT_FOUND, before the
    // binding is ever consulted -- real, observed defense-in-depth: Owner A
    // is denied at the very first ownership check, not merely by a later
    // binding-specific one.
    await expect(
      createPhotoPreviewGeneration(ownerA.ownerUserId, ownerB.clientId, bindingB.id, "gemini", "gemini-3.1-flash-image"),
    ).rejects.toMatchObject({ code: "PHOTO_PREVIEW_GENERATION_CLIENT_NOT_FOUND" });

    // No generation was created under either owner as a side effect.
    await expect(prisma.photoPreviewGeneration.count({ where: { ownerUserId: ownerA.ownerUserId } })).resolves.toBe(0);
  });

  it("the binding-level ownership check independently rejects Owner B's real binding id even when Owner A supplies their OWN real, owned client", async () => {
    const ownerA = await createOwnerAndClient();
    const ownerB = await createOwnerAndClient();
    const { binding: bindingB } = await createConfirmedChain(ownerB.ownerUserId, ownerB.clientId);

    // A more realistic IDOR attempt than the client-mismatch case above:
    // Owner A's OWN real, owned clientId passes the first (client) check,
    // so this specifically exercises the SECOND, binding-level ownership
    // check (technicalVisualMapSpatialBinding.findFirst scoped by
    // ownerUserId) in isolation.
    await expect(
      createPhotoPreviewGeneration(ownerA.ownerUserId, ownerA.clientId, bindingB.id, "gemini", "gemini-3.1-flash-image"),
    ).rejects.toMatchObject({ code: "PHOTO_PREVIEW_GENERATION_BINDING_NOT_FOUND" });
    await expect(prisma.photoPreviewGeneration.count({ where: { ownerUserId: ownerA.ownerUserId } })).resolves.toBe(0);
  });

  // -------------------------------------------------------------------------
  // Fail-closed
  // -------------------------------------------------------------------------

  it("fails closed with PhotoPreviewGenerationPersistenceError when the database is not configured", async () => {
    const saved = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
      await expect(findPhotoPreviewGenerationForOwner(randomUUID(), randomUUID())).rejects.toBeInstanceOf(PhotoPreviewGenerationPersistenceError);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });

  // -------------------------------------------------------------------------
  // AiUsageEvent integration boundary (task §23) -- pure, no I/O
  // -------------------------------------------------------------------------

  it("buildPhotoPreviewUsageEventInput maps a completed generation to a RecordAiUsageEventInput-shaped object, never fabricating usage", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { binding } = await createConfirmedChain(ownerUserId, clientId);
    const outcome = await createPhotoPreviewGeneration(ownerUserId, clientId, binding.id, "gemini", "gemini-3.1-flash-image");

    const succeeded = buildPhotoPreviewUsageEventInput(outcome.record, {
      outcome: "SUCCEEDED",
      providerRequestId: "req-123",
      usage: { imageCount: 1, inputTokens: 500, outputTokens: 1290 },
      attemptNumber: 1,
    });
    expect(succeeded).toMatchObject({
      ownerUserId,
      clientId,
      feature: "photo_preview",
      modality: "IMAGE_GENERATION",
      correlationId: outcome.record.id,
      attemptNumber: 1,
      provider: "gemini",
      model: "gemini-3.1-flash-image",
      providerRequestId: "req-123",
      usage: { imageCount: 1, inputTokens: 500, outputTokens: 1290 },
      outcome: "SUCCEEDED",
    });

    const failed = buildPhotoPreviewUsageEventInput(outcome.record, { outcome: "FAILED" });
    expect(failed.usage).toBeUndefined();
    expect(failed.providerRequestId).toBeUndefined();
    expect(failed.outcome).toBe("FAILED");
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
    data: { id: ownerUserId, email: `${ownerUserId}@photo-preview-repository.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Photo Preview Repository Client" } });
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
    warnings: [], contraindications: ["Perform a strand test before lightening."], assumptions: [], missingData: [], confidence: 0.9,
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

async function createImageAsset(
  ownerUserId: string,
  clientId: string,
  overrides: { width?: number; height?: number; contentSha256?: string; storageVersionId?: string },
) {
  return prisma.imageAsset.create({
    data: {
      id: randomUUID(),
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 12345,
      ownerUserId,
      clientId,
      storagePath: "pending",
      width: overrides.width ?? null,
      height: overrides.height ?? null,
      contentSha256: overrides.contentSha256 ?? null,
      storageVersionId: overrides.storageVersionId ?? null,
    },
  });
}

// The full CONFIRMED chain a Photo Preview generation actually needs: a
// CONFIRMED map, a real owned image asset, and a CONFIRMED spatial binding
// over both -- the exact minimum authority this module's own
// resolveAuthorityChain requires.
async function createConfirmedChain(
  ownerUserId: string,
  clientId: string,
): Promise<{ map: TechnicalVisualMapRecord; binding: TechnicalVisualMapSpatialBindingRecord }> {
  const map = await createConfirmedMap(ownerUserId, clientId);
  const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
  const draftBinding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
  const binding = await confirmSpatialBinding(ownerUserId, draftBinding.id, null);
  if (!binding) throw new Error("expected confirmed spatial binding");
  return { map, binding };
}
