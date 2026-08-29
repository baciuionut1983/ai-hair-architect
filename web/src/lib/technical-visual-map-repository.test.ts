import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { prisma } from "@/lib/prisma";
import { confirmProposal, createProposalForOwner, type ProposalRecord } from "@/lib/proposal-repository";
import { TechnicalVisualMapAssemblyError } from "@/lib/technical-visual-map-assembler";
import {
  TechnicalVisualMapConcurrencyError,
  TechnicalVisualMapDependencyError,
  TechnicalVisualMapPersistenceError,
  TechnicalVisualMapStateError,
  TechnicalVisualMapValidationError,
  applyAdjustmentsToDraft,
  confirmDraftMap,
  createDraftFromConfirmedProposal,
  findCurrentConfirmedMap,
  findMapForOwner,
  listMapsForProposal,
  resolveEffectiveMapForRecord,
  type TechnicalVisualMapRecord,
} from "@/lib/technical-visual-map-repository";
import type { MapAdjustmentEntry } from "@/lib/technical-visual-map-validators";

// Technical Visual Map, Stage 2 -- real Postgres, no mocks, mirroring
// proposal-repository.test.ts's own conventions exactly (real transactions,
// real concurrency races, a tracked `owners` Set cleaned up in afterEach).
// Skips (never fails) when no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("technical-visual-map-repository (durable TechnicalVisualMap domain layer)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.technicalVisualMap.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.analysisProposal.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.analysis.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  // -------------------------------------------------------------------------
  // createDraftFromConfirmedProposal
  // -------------------------------------------------------------------------

  it("28. creates a DRAFT map from an owned CONFIRMED proposal, assembled deterministically, mapVersion 1", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);

    const map = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    expect(map).toMatchObject({
      ownerUserId,
      clientId,
      analysisProposalId: proposal.id,
      vertical: "cutting",
      status: "DRAFT",
      mapVersion: 1,
      sourceImageAssetId: proposal.sourceImageAssetId,
      sourceImageAnalysisId: proposal.sourceImageAnalysisId,
    });
    expect(map.payload.zones).toHaveLength(6);
    expect(map.payload.globalIntent.structuralTechnique).toBe(proposal.payload.structuralTechnique);
    expect(map.professionalAdjustments).toEqual([]);
    expect(map.confirmedAt).toBeNull();
    expect(map.supersededAt).toBeNull();
    expect(map.supersededByMapId).toBeNull();

    const row = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: map.id } });
    expect(row).toMatchObject({ ownerUserId, clientId, analysisProposalId: proposal.id, status: "DRAFT", mapVersion: 1 });
  });

  it("29. rejects assembly from a DRAFT (not yet confirmed) proposal, with a propagated TechnicalVisualMapAssemblyError and no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const draft = await draftProposal(ownerUserId, clientId, analysis.id);

    const error = await createDraftFromConfirmedProposal(ownerUserId, clientId, draft.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalVisualMapAssemblyError);
    expect((error as TechnicalVisualMapAssemblyError).code).toBe("TECHNICAL_VISUAL_MAP_ASSEMBLY_PROPOSAL_NOT_CONFIRMED");

    await expect(prisma.technicalVisualMap.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("30. rejects for a client not owned by the caller, with no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);

    const error = await createDraftFromConfirmedProposal(other.ownerUserId, clientId, proposal.id).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TechnicalVisualMapDependencyError);
    expect(error).toMatchObject({ code: "TECHNICAL_VISUAL_MAP_CLIENT_NOT_FOUND", httpStatus: 404 });
    await expect(
      prisma.technicalVisualMap.count({ where: { ownerUserId: { in: [ownerUserId, other.ownerUserId] } } }),
    ).resolves.toBe(0);
  });

  it("31. rejects an unknown or foreign-owner proposal id, with no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();

    const error = await createDraftFromConfirmedProposal(ownerUserId, clientId, randomUUID()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalVisualMapDependencyError);
    expect(error).toMatchObject({ code: "TECHNICAL_VISUAL_MAP_PROPOSAL_NOT_FOUND", httpStatus: 404 });
    await expect(prisma.technicalVisualMap.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("32. rejects a proposal that belongs to a different client of the same owner, with no row written", async () => {
    const { ownerUserId, clientId: clientOne } = await createOwnerAndClient();
    const clientTwo = randomUUID();
    await prisma.client.create({ data: { id: clientTwo, ownerUserId, fullName: "Second Client" } });
    const analysisOne = await createAnalysis(ownerUserId, clientOne);
    const proposalOne = await confirmedProposal(ownerUserId, clientOne, analysisOne.id);

    const error = await createDraftFromConfirmedProposal(ownerUserId, clientTwo, proposalOne.id).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TechnicalVisualMapDependencyError);
    expect(error).toMatchObject({ code: "TECHNICAL_VISUAL_MAP_PROPOSAL_CLIENT_MISMATCH" });
    await expect(prisma.technicalVisualMap.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("33. mapVersion increments transaction-safely across repeated creates for the same (owner, client, proposal, vertical) scope", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);

    const first = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    const second = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    const third = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    expect([first.mapVersion, second.mapVersion, third.mapVersion]).toEqual([1, 2, 3]);
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  });

  it("34. a real concurrent create race for the same proposal allocates two distinct mapVersions, never a duplicate", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);

    const [a, b] = await Promise.all([
      createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id),
      createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id),
    ]);

    expect(new Set([a.mapVersion, b.mapVersion])).toEqual(new Set([1, 2]));
    const rows = await prisma.technicalVisualMap.findMany({ where: { ownerUserId, clientId, analysisProposalId: proposal.id } });
    expect(rows).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // findMapForOwner / listMapsForProposal
  // -------------------------------------------------------------------------

  it("35. findMapForOwner is owner-scoped and returns null (never throws) for a map that is not the caller's", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const map = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    await expect(findMapForOwner(ownerUserId, map.id)).resolves.toMatchObject({ id: map.id });
    await expect(findMapForOwner(other.ownerUserId, map.id)).resolves.toBeNull();
    await expect(findMapForOwner(ownerUserId, randomUUID())).resolves.toBeNull();
  });

  it("36. listMapsForProposal returns the full version history, newest mapVersion first", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);

    const first = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    const second = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    const history = await listMapsForProposal(ownerUserId, clientId, proposal.id, "cutting");
    expect(history.map((m) => m.id)).toEqual([second.id, first.id]);
    expect(history.map((m) => m.mapVersion)).toEqual([2, 1]);
  });

  // -------------------------------------------------------------------------
  // findCurrentConfirmedMap
  // -------------------------------------------------------------------------

  it("37. findCurrentConfirmedMap returns null before any confirmation, then the confirmed row afterward", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const map = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    await expect(findCurrentConfirmedMap(ownerUserId, clientId, proposal.id, "cutting")).resolves.toBeNull();

    await confirmDraftMap(ownerUserId, map.id, null);
    const current = await findCurrentConfirmedMap(ownerUserId, clientId, proposal.id, "cutting");
    expect(current?.id).toBe(map.id);
    expect(current?.status).toBe("CONFIRMED");
  });

  it("38. the partial unique CONFIRMED index is the real backstop -- a second CONFIRMED row for one scope cannot be written even outside the repository", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const mapA = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    const mapB = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    await confirmDraftMap(ownerUserId, mapA.id, null);

    const rawWrite = prisma.technicalVisualMap.update({
      where: { id: mapB.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
    await expect(rawWrite).rejects.toMatchObject({ code: "P2002" });

    const current = await findCurrentConfirmedMap(ownerUserId, clientId, proposal.id, "cutting");
    expect(current?.id).toBe(mapA.id);
  });

  // -------------------------------------------------------------------------
  // applyAdjustmentsToDraft
  // -------------------------------------------------------------------------

  it("39. rejects an empty adjustments array before any database round-trip", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const map = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    await expect(applyAdjustmentsToDraft(ownerUserId, map.id, [])).rejects.toBeInstanceOf(
      TechnicalVisualMapValidationError,
    );
  });

  it("40. rejects a structurally malformed adjustment entry, with no write", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const map = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    const malformed = { target: "zone_length_intent", zone: "crown", source: "professional" } as unknown as MapAdjustmentEntry;
    await expect(applyAdjustmentsToDraft(ownerUserId, map.id, [malformed])).rejects.toMatchObject({
      code: "TECHNICAL_VISUAL_MAP_INVALID_ADJUSTMENT",
    });

    const row = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: map.id } });
    expect(row.professionalAdjustments).toBeNull();
  });

  it("41. rejects an adjustment shaped to target a proposal-global field -- the closed target vocabulary makes this a validation error, not a silent no-op", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const map = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    const globalFieldAttempt = {
      target: "structuralTechnique",
      newValue: "one_length",
      source: "professional",
    } as unknown as MapAdjustmentEntry;

    await expect(applyAdjustmentsToDraft(ownerUserId, map.id, [globalFieldAttempt])).rejects.toBeInstanceOf(
      TechnicalVisualMapValidationError,
    );
    const row = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: map.id } });
    expect(row.payload).toEqual(map.payload);
  });

  it("42. applies and accumulates adjustments across separate calls without ever mutating the frozen baseline payload", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const map = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    const first: MapAdjustmentEntry = {
      target: "zone_length_intent",
      zone: "crown",
      previousValue: "unspecified",
      newValue: "preserve",
      source: "professional",
    };
    const afterFirst = await applyAdjustmentsToDraft(ownerUserId, map.id, [first]);
    expect(afterFirst?.professionalAdjustments).toHaveLength(1);
    expect(afterFirst?.payload).toEqual(map.payload);

    const second: MapAdjustmentEntry = {
      target: "zone_preserve",
      zone: "nape",
      previousValue: false,
      newValue: true,
      source: "professional",
      reason: "Client wants to keep the nape length exactly as is.",
    };
    const afterSecond = await applyAdjustmentsToDraft(ownerUserId, map.id, [second]);
    expect(afterSecond?.professionalAdjustments).toHaveLength(2);
    expect(afterSecond?.payload).toEqual(map.payload);

    const effective = resolveEffectiveMapForRecord(expectRecord(afterSecond));
    const crown = effective.zones.find((z) => z.zone === "crown");
    const nape = effective.zones.find((z) => z.zone === "nape");
    expect(crown?.lengthIntent).toBe("preserve");
    expect(crown?.lengthIntentSource).toBe("professional_adjustment");
    expect(nape?.preserve).toBe(true);
    expect(nape?.preserveSource).toBe("professional_adjustment");

    const row = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: map.id } });
    expect(row.payload).toEqual(map.payload);
    expect(Array.isArray(row.professionalAdjustments)).toBe(true);
    expect(row.professionalAdjustments).toHaveLength(2);
  });

  it("43. rejects adjustment application on a CONFIRMED map, with no write", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const map = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    await confirmDraftMap(ownerUserId, map.id, null);

    const adjustment: MapAdjustmentEntry = {
      target: "zone_preserve",
      zone: "fringe",
      previousValue: false,
      newValue: true,
      source: "professional",
    };
    const error = await applyAdjustmentsToDraft(ownerUserId, map.id, [adjustment]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalVisualMapStateError);
    expect((error as TechnicalVisualMapStateError).attempted).toBe("adjust");
    const row = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: map.id } });
    expect(row.professionalAdjustments).toBeNull();
  });

  it("44. rejects adjustment application on a SUPERSEDED map, with no write", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const mapA = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    const mapB = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    await confirmDraftMap(ownerUserId, mapA.id, null);
    await confirmDraftMap(ownerUserId, mapB.id, mapA.id);

    const adjustment: MapAdjustmentEntry = {
      target: "zone_preserve",
      zone: "fringe",
      previousValue: false,
      newValue: true,
      source: "professional",
    };
    await expect(applyAdjustmentsToDraft(ownerUserId, mapA.id, [adjustment])).rejects.toBeInstanceOf(
      TechnicalVisualMapStateError,
    );
  });

  it("45. applyAdjustmentsToDraft returns null (never throws) for a non-owned or nonexistent map", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const map = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    const adjustment: MapAdjustmentEntry = {
      target: "zone_preserve",
      zone: "fringe",
      previousValue: false,
      newValue: true,
      source: "professional",
    };
    await expect(applyAdjustmentsToDraft(other.ownerUserId, map.id, [adjustment])).resolves.toBeNull();
    await expect(applyAdjustmentsToDraft(ownerUserId, randomUUID(), [adjustment])).resolves.toBeNull();
  });

  // -------------------------------------------------------------------------
  // confirmDraftMap
  // -------------------------------------------------------------------------

  it("46. confirmDraftMap moves a DRAFT to CONFIRMED when nothing is confirmed yet for the scope", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const map = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    const confirmed = await confirmDraftMap(ownerUserId, map.id, null);
    expect(confirmed?.status).toBe("CONFIRMED");
    expect(confirmed?.confirmedAt).not.toBeNull();

    await expect(
      prisma.technicalVisualMap.count({ where: { ownerUserId, clientId, analysisProposalId: proposal.id, status: "CONFIRMED" } }),
    ).resolves.toBe(1);
  });

  it("47. confirming an already-CONFIRMED map is illegal and performs no write", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const map = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    const confirmed = await confirmDraftMap(ownerUserId, map.id, null);

    const error = await confirmDraftMap(ownerUserId, map.id, confirmed?.id ?? null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalVisualMapStateError);
    expect((error as TechnicalVisualMapStateError).attempted).toBe("confirm");
  });

  it("48. intentional replacement: confirming a successor with the incumbent's real id supersedes it cleanly (not a race)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const mapA = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    const mapB = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    const confirmedA = await confirmDraftMap(ownerUserId, mapA.id, null);
    expect(confirmedA?.status).toBe("CONFIRMED");

    const confirmedB = await confirmDraftMap(ownerUserId, mapB.id, mapA.id);
    expect(confirmedB?.status).toBe("CONFIRMED");

    const aAfter = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: mapA.id } });
    const bAfter = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: mapB.id } });
    expect(aAfter.status).toBe("SUPERSEDED");
    expect(aAfter.supersededByMapId).toBe(mapB.id);
    expect(aAfter.supersededAt).not.toBeNull();
    expect(bAfter.status).toBe("CONFIRMED");
    expect(bAfter.supersededByMapId).toBeNull();

    await expect(
      prisma.technicalVisualMap.count({ where: { ownerUserId, clientId, analysisProposalId: proposal.id, status: "CONFIRMED" } }),
    ).resolves.toBe(1);
    const current = await findCurrentConfirmedMap(ownerUserId, clientId, proposal.id, "cutting");
    expect(current?.id).toBe(mapB.id);

    // The historical, superseded row remains fully readable, unmutated apart
    // from the supersession fields themselves.
    const historical = await findMapForOwner(ownerUserId, mapA.id);
    expect(historical?.status).toBe("SUPERSEDED");
    expect(historical?.payload).toEqual(mapA.payload);
  });

  it("49. a stale expectedCurrentConfirmedMapId is rejected with TechnicalVisualMapConcurrencyError and performs zero writes", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const mapA = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    const mapB = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    await confirmDraftMap(ownerUserId, mapA.id, null);

    const staleId = randomUUID();
    const before = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: mapB.id } });
    await expect(confirmDraftMap(ownerUserId, mapB.id, staleId)).rejects.toBeInstanceOf(TechnicalVisualMapConcurrencyError);

    const after = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: mapB.id } });
    expect(after).toEqual(before);
    expect(after.status).toBe("DRAFT");
    const aAfter = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: mapA.id } });
    expect(aAfter.status).toBe("CONFIRMED");
  });

  it("50. confirmDraftMap returns null (never throws) for a non-owned or nonexistent map", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const map = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    await expect(confirmDraftMap(other.ownerUserId, map.id, null)).resolves.toBeNull();
    await expect(confirmDraftMap(ownerUserId, randomUUID(), null)).resolves.toBeNull();
  });

  it("51. a real concurrent confirmation race: exactly one wins, the loser gets TechnicalVisualMapConcurrencyError and is left an untouched DRAFT", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);

    // Two DRAFT maps for the SAME scope, both racing to be the first
    // confirmation -- nothing confirmed yet, so both callers observe the
    // same baseline (null).
    const a = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);
    const b = await createDraftFromConfirmedProposal(ownerUserId, clientId, proposal.id);

    const rowsBefore = await prisma.technicalVisualMap.findMany({
      where: { ownerUserId, clientId, analysisProposalId: proposal.id },
      orderBy: { mapVersion: "asc" },
    });
    const snapshotBefore = new Map(rowsBefore.map((r) => [r.id, r] as const));

    const settled = await Promise.allSettled([
      confirmDraftMap(ownerUserId, a.id, null),
      confirmDraftMap(ownerUserId, b.id, null),
    ]);

    const fulfilled = settled.filter(
      (r): r is PromiseFulfilledResult<TechnicalVisualMapRecord | null> => r.status === "fulfilled",
    );
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0].value?.status).toBe("CONFIRMED");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(TechnicalVisualMapConcurrencyError);

    const winnerId = fulfilled[0].value?.id ?? "";
    const loserId = winnerId === a.id ? b.id : a.id;

    const confirmedRows = await prisma.technicalVisualMap.findMany({
      where: { ownerUserId, clientId, analysisProposalId: proposal.id, status: "CONFIRMED" },
    });
    expect(confirmedRows).toHaveLength(1);
    expect(confirmedRows[0].id).toBe(winnerId);

    const loserAfter = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: loserId } });
    expect(loserAfter.status).toBe("DRAFT");
    expect(loserAfter).toEqual(snapshotBefore.get(loserId));

    const current = await findCurrentConfirmedMap(ownerUserId, clientId, proposal.id, "cutting");
    expect(current?.id).toBe(winnerId);
  });

  // -------------------------------------------------------------------------
  // Fail-closed
  // -------------------------------------------------------------------------

  it("52. fails closed with a TechnicalVisualMapPersistenceError when the database is not configured", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(findMapForOwner(randomUUID(), randomUUID())).rejects.toBeInstanceOf(TechnicalVisualMapPersistenceError);
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
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@technical-visual-map-repository.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Technical Visual Map Repository Client" } });
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

async function draftProposal(ownerUserId: string, clientId: string, analysisId: string): Promise<ProposalRecord> {
  return createProposalForOwner(
    ownerUserId,
    clientId,
    analysisId,
    "cutting",
    cuttingPayload(),
    evidenceSnapshot(),
    "1.0.0-m8",
  );
}

async function confirmedProposal(
  ownerUserId: string,
  clientId: string,
  analysisId: string,
  evidenceOverrides: Record<string, unknown> = {},
): Promise<ProposalRecord> {
  const draft = await createProposalForOwner(
    ownerUserId,
    clientId,
    analysisId,
    "cutting",
    cuttingPayload(),
    evidenceSnapshot(evidenceOverrides),
    "1.0.0-m8",
  );
  const confirmed = await confirmProposal(ownerUserId, draft.id, ownerUserId, null);
  return expectRecord(confirmed);
}

function expectRecord(record: ProposalRecord | null): ProposalRecord;
function expectRecord(record: TechnicalVisualMapRecord | null): TechnicalVisualMapRecord;
function expectRecord(record: unknown): unknown {
  if (!record) throw new Error("expected a record, received null");
  return record;
}

function cuttingPayload(overrides: Partial<TechnicalCutPlan> = {}): TechnicalCutPlan {
  return {
    structuralTechnique: "graduation",
    cuttingTechnique: "slice_cutting",
    texturizingTechnique: "point_cutting",
    sectioning: "diagonal_back",
    elevation: "45_deg_graduation",
    distribution: "overdirected_back",
    guideline: "stationary",
    cuttingSteps: [
      {
        stepNumber: 1,
        zone: "nape",
        action: "Establish the guideline",
        elevationAngle: "45_deg_graduation",
        toolRequired: "shears",
      },
    ],
    stylistExplanation: "Explain the sectioning.",
    clientExplanation: "Explain the shape.",
    professionalReason: "Control weight through the interior.",
    warnings: [],
    contraindications: [],
    assumptions: [],
    missingData: [],
    confidence: 0.9,
    stylistValidationDisclaimer: "Validate before cutting.",
    version: "1.0.0-m8",
    ...overrides,
  };
}

function evidenceSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    observations: {
      hairType: "medium",
      density: "medium",
      porosity: "low",
      hairCondition: "virgin_healthy",
      hairTexture: "wavy",
      hairLength: "long",
      growthPattern: null,
      faceShape: "oval",
      headShape: "flat_occipital",
    },
    derivedSafety: {
      safetyNotes: ["Perform a strand test before any chemical service."],
      contraindications: [],
    },
    ...overrides,
  };
}
