import { randomUUID } from "crypto";
import { createHash } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { prisma } from "@/lib/prisma";
import { confirmDraftMap, createDraftFromConfirmedProposal, type TechnicalVisualMapRecord } from "@/lib/technical-visual-map-repository";
import { confirmProposal, createProposalForOwner } from "@/lib/proposal-repository";
import type { TechnicalCutPlan } from "@/lib/contracts";
import {
  TechnicalVisualMapSpatialBindingConcurrencyError,
  TechnicalVisualMapSpatialBindingDependencyError,
  TechnicalVisualMapSpatialBindingPersistenceError,
  TechnicalVisualMapSpatialBindingStateError,
  TechnicalVisualMapSpatialBindingValidationError,
  applySpatialBindingEdits,
  confirmSpatialBinding,
  createDraftSpatialBinding,
  findCurrentConfirmedSpatialBinding,
  findSpatialBindingForOwner,
  listSpatialBindingsForMap,
  type TechnicalVisualMapSpatialBindingRecord,
} from "@/lib/technical-visual-map-spatial-binding-repository";
import type { SpatialBindingEditOperation } from "@/lib/technical-visual-map-spatial-validators";

// Technical Visual Map, Stage 5B -- real Postgres, no mocks, mirroring
// technical-visual-map-repository.test.ts's own conventions exactly.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("technical-visual-map-spatial-binding-repository (durable spatial geometry domain layer)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
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
  // createDraftSpatialBinding
  // -------------------------------------------------------------------------

  it("19. creates a DRAFT binding from an owned CONFIRMED map + owned image, spatialVersion 1", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });

    const binding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");

    expect(binding).toMatchObject({
      ownerUserId,
      clientId,
      technicalVisualMapId: map.id,
      sourceImageAssetId: asset.id,
      viewLabel: "front",
      status: "DRAFT",
      spatialVersion: 1,
    });
  });

  it("20. create from a DRAFT (not yet confirmed) map is rejected, no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const draftMap = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id); // never confirmed
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });

    const error = await createDraftSpatialBinding(ownerUserId, clientId, draftMap.id, asset.id, "front").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalVisualMapSpatialBindingDependencyError);
    expect(error).toMatchObject({ code: "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_NOT_CONFIRMED" });
    await expect(prisma.technicalVisualMapSpatialBinding.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("21. create from a SUPERSEDED map is rejected, no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const mapA = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    const mapB = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    await confirmDraftMap(ownerUserId, mapA.id, null);
    await confirmDraftMap(ownerUserId, mapB.id, mapA.id); // supersedes mapA
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });

    const error = await createDraftSpatialBinding(ownerUserId, clientId, mapA.id, asset.id, "front").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalVisualMapSpatialBindingDependencyError);
    expect(error).toMatchObject({ code: "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_NOT_CONFIRMED" });
  });

  it("22. a foreign-owner (or nonexistent) parent map is rejected, no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });

    const error = await createDraftSpatialBinding(other.ownerUserId, other.clientId, randomUUID(), asset.id, "front").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TechnicalVisualMapSpatialBindingDependencyError);
    expect(error).toMatchObject({ code: "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_MAP_NOT_FOUND" });
  });

  it("23. a foreign-owner (or nonexistent) source image is rejected, no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);

    const error = await createDraftSpatialBinding(ownerUserId, clientId, map.id, randomUUID(), "front").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalVisualMapSpatialBindingDependencyError);
    expect(error).toMatchObject({ code: "TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_ASSET_NOT_FOUND" });
    await expect(prisma.technicalVisualMapSpatialBinding.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("a source image belonging to a different client of the same owner is rejected", async () => {
    const { ownerUserId, clientId: clientOne } = await createOwnerAndClient();
    const clientTwo = randomUUID();
    await prisma.client.create({ data: { id: clientTwo, ownerUserId, fullName: "Second Client" } });
    const map = await createConfirmedMap(ownerUserId, clientOne);
    const asset = await createImageAsset(ownerUserId, clientTwo, { width: 1080, height: 1440 });

    const error = await createDraftSpatialBinding(ownerUserId, clientOne, map.id, asset.id, "front").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalVisualMapSpatialBindingDependencyError);
    expect(error).toMatchObject({ code: "TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_ASSET_CLIENT_MISMATCH" });
  });

  it("24. missing source dimensions rejected with the exact documented stable code", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, {}); // no width/height

    const error = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalVisualMapSpatialBindingDependencyError);
    expect(error).toMatchObject({ code: "TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_DIMENSIONS_UNAVAILABLE", httpStatus: 422 });
  });

  it("25/26/27/28/29. frozen snapshot fields are copied exactly from the real ImageAsset row (hash/storageVersionId when present, null when absent)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);

    const withHash = await createImageAsset(ownerUserId, clientId, {
      width: 900, height: 1200, contentSha256: createHash("sha256").update("x").digest("hex"), storageVersionId: "v-abc123",
    });
    const bindingWithHash = await createDraftSpatialBinding(ownerUserId, clientId, map.id, withHash.id, "front");
    expect(bindingWithHash.frozenWidth).toBe(900);
    expect(bindingWithHash.frozenHeight).toBe(1200);
    expect(bindingWithHash.frozenOrientation).toBe(0);
    expect(bindingWithHash.frozenContentSha256).toBe(withHash.contentSha256);
    expect(bindingWithHash.frozenStorageVersionId).toBe("v-abc123");

    const withoutHash = await createImageAsset(ownerUserId, clientId, { width: 640, height: 480 });
    const bindingWithoutHash = await createDraftSpatialBinding(ownerUserId, clientId, map.id, withoutHash.id, "back");
    expect(bindingWithoutHash.frozenContentSha256).toBeNull();
    expect(bindingWithoutHash.frozenStorageVersionId).toBeNull();
  });

  it("30/31. the initial payload is an honest skeleton: all six zones not_placed, perimeter not_placed", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });

    const binding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");

    expect(binding.payload.zones).toHaveLength(6);
    expect(binding.payload.zones.every((z) => z.state === "not_placed")).toBe(true);
    expect(binding.payload.perimeter).toEqual({ state: "not_placed" });
  });

  it("32. spatialVersion increments transaction-safely within the exact scope", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });

    const first = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    const second = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    expect([first.spatialVersion, second.spatialVersion]).toEqual([1, 2]);
  });

  it("33. a real concurrent create race allocates two distinct spatialVersions, never a duplicate", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });

    const [a, b] = await Promise.all([
      createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front"),
      createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front"),
    ]);
    expect(new Set([a.spatialVersion, b.spatialVersion])).toEqual(new Set([1, 2]));
  });

  // -------------------------------------------------------------------------
  // applySpatialBindingEdits
  // -------------------------------------------------------------------------

  it("34/35/36/37. valid DRAFT edits: place an anchor, reset it, mark a zone not_visible, set a perimeter", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const binding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");

    const afterAnchor = await applySpatialBindingEdits(ownerUserId, binding.id, [
      { op: "set_zone_anchor", zone: "nape", x: 0.4, y: 0.6 },
    ]);
    expect(afterAnchor?.payload.zones.find((z) => z.zone === "nape")).toEqual({
      zone: "nape", state: "placed", x: 0.4, y: 0.6, source: "professional",
    });

    const afterReset = await applySpatialBindingEdits(ownerUserId, binding.id, [{ op: "reset_zone", zone: "nape" }]);
    expect(afterReset?.payload.zones.find((z) => z.zone === "nape")).toEqual({ zone: "nape", state: "not_placed" });

    const afterNotVisible = await applySpatialBindingEdits(ownerUserId, binding.id, [
      { op: "set_zone_not_visible", zone: "occipital" },
    ]);
    expect(afterNotVisible?.payload.zones.find((z) => z.zone === "occipital")).toEqual({ zone: "occipital", state: "not_visible" });

    const afterPerimeter = await applySpatialBindingEdits(ownerUserId, binding.id, [
      { op: "set_perimeter", points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }] },
    ]);
    expect(afterPerimeter?.payload.perimeter).toEqual({
      state: "placed", points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], source: "professional",
    });

    const row = await prisma.technicalVisualMapSpatialBinding.findUniqueOrThrow({ where: { id: binding.id } });
    expect(row.payload).toEqual(afterPerimeter?.payload);
  });

  it("rejects a malformed edit operation before any write", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const binding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");

    const bad = { op: "set_zone_anchor", zone: "nape", x: 5, y: 0.5 } as unknown as SpatialBindingEditOperation;
    await expect(applySpatialBindingEdits(ownerUserId, binding.id, [bad])).rejects.toBeInstanceOf(
      TechnicalVisualMapSpatialBindingValidationError,
    );
    const row = await prisma.technicalVisualMapSpatialBinding.findUniqueOrThrow({ where: { id: binding.id } });
    expect(row.payload).toEqual(binding.payload);
  });

  it("38. editing a CONFIRMED binding is rejected, no write", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const binding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    await confirmSpatialBinding(ownerUserId, binding.id, null);

    const error = await applySpatialBindingEdits(ownerUserId, binding.id, [
      { op: "set_zone_anchor", zone: "top", x: 0.5, y: 0.1 },
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalVisualMapSpatialBindingStateError);
  });

  it("39. editing a SUPERSEDED binding is rejected, no write", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const bindingA = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    const bindingB = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    await confirmSpatialBinding(ownerUserId, bindingA.id, null);
    await confirmSpatialBinding(ownerUserId, bindingB.id, bindingA.id);

    await expect(
      applySpatialBindingEdits(ownerUserId, bindingA.id, [{ op: "set_zone_anchor", zone: "top", x: 0.5, y: 0.1 }]),
    ).rejects.toBeInstanceOf(TechnicalVisualMapSpatialBindingStateError);
  });

  // -------------------------------------------------------------------------
  // findCurrentConfirmedSpatialBinding
  // -------------------------------------------------------------------------

  it("40/41/42. current resolver is exact by (image, view): different views and different images each get their own independent current", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const assetA = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const assetB = await createImageAsset(ownerUserId, clientId, { width: 800, height: 600 });

    const frontA = await createDraftSpatialBinding(ownerUserId, clientId, map.id, assetA.id, "front");
    const backA = await createDraftSpatialBinding(ownerUserId, clientId, map.id, assetA.id, "back");
    const frontB = await createDraftSpatialBinding(ownerUserId, clientId, map.id, assetB.id, "front");

    await confirmSpatialBinding(ownerUserId, frontA.id, null);
    await confirmSpatialBinding(ownerUserId, backA.id, null);
    await confirmSpatialBinding(ownerUserId, frontB.id, null);

    await expect(findCurrentConfirmedSpatialBinding(ownerUserId, clientId, map.id, assetA.id, "front")).resolves.toMatchObject({ id: frontA.id });
    await expect(findCurrentConfirmedSpatialBinding(ownerUserId, clientId, map.id, assetA.id, "back")).resolves.toMatchObject({ id: backA.id });
    await expect(findCurrentConfirmedSpatialBinding(ownerUserId, clientId, map.id, assetB.id, "front")).resolves.toMatchObject({ id: frontB.id });
    await expect(findCurrentConfirmedSpatialBinding(ownerUserId, clientId, map.id, assetA.id, "left_profile")).resolves.toBeNull();
  });

  // -------------------------------------------------------------------------
  // confirmSpatialBinding -- CAS
  // -------------------------------------------------------------------------

  it("43. first confirmation with expected null succeeds when nothing is confirmed yet", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const binding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");

    const confirmed = await confirmSpatialBinding(ownerUserId, binding.id, null);
    expect(confirmed?.status).toBe("CONFIRMED");
    expect(confirmed?.confirmedAt).not.toBeNull();
  });

  it("44/45. intentional replacement succeeds and the previous current becomes SUPERSEDED", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const bindingA = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    const bindingB = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");

    const confirmedA = await confirmSpatialBinding(ownerUserId, bindingA.id, null);
    const confirmedB = await confirmSpatialBinding(ownerUserId, bindingB.id, confirmedA?.id ?? null);
    expect(confirmedB?.status).toBe("CONFIRMED");

    const aAfter = await prisma.technicalVisualMapSpatialBinding.findUniqueOrThrow({ where: { id: bindingA.id } });
    expect(aAfter.status).toBe("SUPERSEDED");
    expect(aAfter.supersededBySpatialBindingId).toBe(bindingB.id);

    const current = await findCurrentConfirmedSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    expect(current?.id).toBe(bindingB.id);
  });

  it("46/47/48. a stale expected id is rejected with the concurrency error, performs zero writes, loser stays DRAFT", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const bindingA = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    const bindingB = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    await confirmSpatialBinding(ownerUserId, bindingA.id, null);

    const before = await prisma.technicalVisualMapSpatialBinding.findUniqueOrThrow({ where: { id: bindingB.id } });
    const error = await confirmSpatialBinding(ownerUserId, bindingB.id, randomUUID()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalVisualMapSpatialBindingConcurrencyError);

    const after = await prisma.technicalVisualMapSpatialBinding.findUniqueOrThrow({ where: { id: bindingB.id } });
    expect(after).toEqual(before);
    expect(after.status).toBe("DRAFT");
  });

  it("49. a real concurrent confirmation race: exactly one wins, the loser gets the concurrency error and is left an untouched DRAFT", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const a = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    const b = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");

    const rowsBefore = await prisma.technicalVisualMapSpatialBinding.findMany({
      where: { ownerUserId, clientId, technicalVisualMapId: map.id, sourceImageAssetId: asset.id, viewLabel: "front" },
      orderBy: { id: "asc" },
    });
    const snapshotBefore = new Map(rowsBefore.map((r) => [r.id, r] as const));

    const settled = await Promise.allSettled([
      confirmSpatialBinding(ownerUserId, a.id, null),
      confirmSpatialBinding(ownerUserId, b.id, null),
    ]);
    const fulfilled = settled.filter(
      (r): r is PromiseFulfilledResult<TechnicalVisualMapSpatialBindingRecord | null> => r.status === "fulfilled",
    );
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0].value?.status).toBe("CONFIRMED");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(TechnicalVisualMapSpatialBindingConcurrencyError);

    const winnerId = fulfilled[0].value?.id ?? "";
    const loserId = winnerId === a.id ? b.id : a.id;
    const loserAfter = await prisma.technicalVisualMapSpatialBinding.findUniqueOrThrow({ where: { id: loserId } });
    expect(loserAfter.status).toBe("DRAFT");
    expect(loserAfter).toEqual(snapshotBefore.get(loserId));

    const current = await findCurrentConfirmedSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    expect(current?.id).toBe(winnerId);
  });

  it("the partial unique CONFIRMED index is the real backstop -- a second CONFIRMED row for one scope cannot be written even outside the repository", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const a = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    const b = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    await confirmSpatialBinding(ownerUserId, a.id, null);

    await expect(
      prisma.technicalVisualMapSpatialBinding.update({ where: { id: b.id }, data: { status: "CONFIRMED", confirmedAt: new Date() } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("50. a historical SUPERSEDED binding remains fully readable", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const a = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    const b = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");
    const confirmedA = await confirmSpatialBinding(ownerUserId, a.id, null);
    await confirmSpatialBinding(ownerUserId, b.id, confirmedA?.id ?? null);

    const historical = await findSpatialBindingForOwner(ownerUserId, a.id);
    expect(historical?.status).toBe("SUPERSEDED");
    expect(historical?.payload).toEqual(a.payload);

    const history = await listSpatialBindingsForMap(ownerUserId, clientId, map.id);
    expect(history.map((h) => h.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("51. ownership/IDOR-safe resolution -- a foreign owner never resolves another owner's binding", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();
    const map = await createConfirmedMap(ownerUserId, clientId);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });
    const binding = await createDraftSpatialBinding(ownerUserId, clientId, map.id, asset.id, "front");

    await expect(findSpatialBindingForOwner(other.ownerUserId, binding.id)).resolves.toBeNull();
    await expect(applySpatialBindingEdits(other.ownerUserId, binding.id, [{ op: "reset_zone", zone: "crown" }])).resolves.toBeNull();
    await expect(confirmSpatialBinding(other.ownerUserId, binding.id, null)).resolves.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Parent map eligibility at confirm time (Stage 5B requirement #19)
  // -------------------------------------------------------------------------

  it("a DRAFT spatial binding whose parent map has since become SUPERSEDED can no longer be confirmed", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const mapA = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    const mapB = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    await confirmDraftMap(ownerUserId, mapA.id, null);
    const asset = await createImageAsset(ownerUserId, clientId, { width: 1080, height: 1440 });

    // Drafted while mapA was still CONFIRMED.
    const binding = await createDraftSpatialBinding(ownerUserId, clientId, mapA.id, asset.id, "front");

    // mapA is now superseded by mapB, AFTER the spatial binding was drafted.
    await confirmDraftMap(ownerUserId, mapB.id, mapA.id);

    const error = await confirmSpatialBinding(ownerUserId, binding.id, null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalVisualMapSpatialBindingDependencyError);
    expect(error).toMatchObject({ code: "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_INELIGIBLE", httpStatus: 409 });

    // The historical DRAFT remains readable, untouched.
    const stillDraft = await findSpatialBindingForOwner(ownerUserId, binding.id);
    expect(stillDraft?.status).toBe("DRAFT");
  });

  // -------------------------------------------------------------------------
  // Fail-closed
  // -------------------------------------------------------------------------

  it("fails closed with a persistence error when the database is not configured", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(findSpatialBindingForOwner(randomUUID(), randomUUID())).rejects.toBeInstanceOf(
        TechnicalVisualMapSpatialBindingPersistenceError,
      );
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
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
    data: { id: ownerUserId, email: `${ownerUserId}@tvm-spatial-repository.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "TVM Spatial Repository Client" } });
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
