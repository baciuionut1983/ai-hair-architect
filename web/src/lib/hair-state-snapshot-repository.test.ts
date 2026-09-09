import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { createProposalForOwner, confirmProposal } from "@/lib/proposal-repository";
import { createDraftFromConfirmedProposal, confirmDraftMap } from "@/lib/technical-visual-map-repository";
import {
  confirmDraftSnapshot,
  createCurrentSnapshotFromAnalysis,
  createManualSnapshot,
  createTargetSnapshotFromTechnicalVisualMap,
  findCurrentConfirmedSnapshot,
  findSnapshotForOwner,
  HairStateSnapshotConcurrencyError,
  HairStateSnapshotDependencyError,
  HairStateSnapshotStateError,
  listSnapshotsForClient,
} from "@/lib/hair-state-snapshot-repository";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import type { TechnicalCutPlan } from "@/lib/contracts";

// Professional Skill Engine, Stage 2 -- real Postgres, no mocks. Mirrors
// technical-visual-map-repository.test.ts's own conventions exactly. Skips
// (never fails) when no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("hair-state-snapshot-repository (real Postgres)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.hairStateSnapshot.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.technicalVisualMap.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.analysisProposal.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.analysis.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  // -------------------------------------------------------------------------
  // 1. CURRENT and TARGET coexist
  // -------------------------------------------------------------------------

  it("1. a CURRENT and a TARGET snapshot coexist for the same client without colliding", async () => {
    const { ownerUserId, clientId, analysisId } = await createOwnerClientAnalysis();
    const current = await createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId);
    const mapId = await createConfirmedMap(ownerUserId, clientId, analysisId);
    const target = await createTargetSnapshotFromTechnicalVisualMap(ownerUserId, clientId, mapId);

    expect(current.role).toBe("CURRENT");
    expect(target.role).toBe("TARGET");
    expect(current.id).not.toBe(target.id);

    const currentList = await listSnapshotsForClient(ownerUserId, clientId, "CURRENT");
    const targetList = await listSnapshotsForClient(ownerUserId, clientId, "TARGET");
    expect(currentList.map((r) => r.id)).toEqual([current.id]);
    expect(targetList.map((r) => r.id)).toEqual([target.id]);
  });

  // -------------------------------------------------------------------------
  // 2. Versioning/history preserved
  // -------------------------------------------------------------------------

  it("2. confirming a second CURRENT snapshot supersedes the first -- history is preserved, never overwritten", async () => {
    const { ownerUserId, clientId, analysisId } = await createOwnerClientAnalysis();
    const first = await createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId);
    const confirmedFirst = await confirmDraftSnapshot(ownerUserId, first.id, null);
    expect(confirmedFirst?.status).toBe("CONFIRMED");
    expect(confirmedFirst?.snapshotVersion).toBe(1);

    const second = await createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId);
    expect(second.snapshotVersion).toBe(2);
    const confirmedSecond = await confirmDraftSnapshot(ownerUserId, second.id, confirmedFirst!.id);
    expect(confirmedSecond?.status).toBe("CONFIRMED");

    const historicalFirst = await findSnapshotForOwner(ownerUserId, first.id);
    expect(historicalFirst?.status).toBe("SUPERSEDED");
    expect(historicalFirst?.supersededBySnapshotId).toBe(second.id);
    // The historical row's own payload/snapshotVersion are never mutated.
    expect(historicalFirst?.snapshotVersion).toBe(1);

    const currentConfirmed = await findCurrentConfirmedSnapshot(ownerUserId, clientId, "CURRENT");
    expect(currentConfirmed?.id).toBe(second.id);
  });

  it("2b. a stale expectedCurrentConfirmedSnapshotId is rejected -- concurrency-safe", async () => {
    const { ownerUserId, clientId, analysisId } = await createOwnerClientAnalysis();
    const first = await createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId);
    await confirmDraftSnapshot(ownerUserId, first.id, null);

    const second = await createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId);
    await expect(confirmDraftSnapshot(ownerUserId, second.id, null)).rejects.toBeInstanceOf(HairStateSnapshotConcurrencyError);
  });

  it("2c. confirming a non-DRAFT snapshot is rejected", async () => {
    const { ownerUserId, clientId, analysisId } = await createOwnerClientAnalysis();
    const snapshot = await createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId);
    await confirmDraftSnapshot(ownerUserId, snapshot.id, null);
    await expect(confirmDraftSnapshot(ownerUserId, snapshot.id, snapshot.id)).rejects.toBeInstanceOf(HairStateSnapshotStateError);
  });

  // -------------------------------------------------------------------------
  // 3. Per-zone state stored and retrieved deterministically
  // -------------------------------------------------------------------------

  it("3. per-zone state round-trips deterministically through real Postgres", async () => {
    const { ownerUserId, clientId, analysisId } = await createOwnerClientAnalysis();
    const mapId = await createConfirmedMap(ownerUserId, clientId, analysisId, { nape: { lengthIntent: "shorten", weightIntent: "reduce" } });
    const created = await createTargetSnapshotFromTechnicalVisualMap(ownerUserId, clientId, mapId);

    const reread = await findSnapshotForOwner(ownerUserId, created.id);
    expect(reread?.payload.zones.length).toBe(HEAD_ZONES.length);
    const nape = reread?.payload.zones.find((z) => z.zone === "nape");
    expect(nape?.lengthIntent.value).toBe("shorten");
    expect(nape?.weightIntent.value).toBe("reduce");
  });

  // -------------------------------------------------------------------------
  // 4. Provenance/authority survives round-trip
  // -------------------------------------------------------------------------

  it("4. provenance (analysisId, technicalVisualMapId, generatorVersion) survives a real round-trip", async () => {
    const { ownerUserId, clientId, analysisId } = await createOwnerClientAnalysis();
    const created = await createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId);
    const reread = await findSnapshotForOwner(ownerUserId, created.id);

    expect(reread?.analysisId).toBe(analysisId);
    expect(reread?.generatorVersion).toBe("1.0.0-hss2");
    expect(reread?.technicalVisualMapId).toBeNull();
  });

  it("4b. a manual (professional-authored) snapshot has no generatorVersion", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const payload: HairStateSnapshotPayload = { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((z) => buildUnassessedZoneEntry(z)) };
    const created = await createManualSnapshot(ownerUserId, clientId, "RESULT", payload);
    expect(created.generatorVersion).toBeNull();
    expect(created.role).toBe("RESULT");
  });

  // -------------------------------------------------------------------------
  // 5. Fail-closed on unknown/invalid vocabulary (repository level)
  // -------------------------------------------------------------------------

  it("5. createManualSnapshot rejects an invalid role and an invalid payload -- never silently coerced", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const payload: HairStateSnapshotPayload = { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((z) => buildUnassessedZoneEntry(z)) };
    await expect(createManualSnapshot(ownerUserId, clientId, "BEFORE", payload)).rejects.toThrow();
    await expect(createManualSnapshot(ownerUserId, clientId, "RESULT", { not: "a payload" })).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // 6. Existing TechnicalVisualMap authority is not duplicated or corrupted
  // -------------------------------------------------------------------------

  it("6. creating a TARGET snapshot never mutates the source TechnicalVisualMap row", async () => {
    const { ownerUserId, clientId, analysisId } = await createOwnerClientAnalysis();
    const mapId = await createConfirmedMap(ownerUserId, clientId, analysisId);
    const before = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: mapId } });

    await createTargetSnapshotFromTechnicalVisualMap(ownerUserId, clientId, mapId);

    const after = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: mapId } });
    expect(after.payload).toEqual(before.payload);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.status).toBe(before.status);
  });

  it("6b. a TARGET snapshot cannot be created from a non-CONFIRMED (DRAFT) map", async () => {
    const { ownerUserId, clientId, analysisId } = await createOwnerClientAnalysis();
    const confirmed = await confirmedProposalFor(ownerUserId, clientId, analysisId);
    const draftMap = await createDraftFromConfirmedProposal(ownerUserId, clientId, confirmed.id);
    await expect(createTargetSnapshotFromTechnicalVisualMap(ownerUserId, clientId, draftMap.id)).rejects.toBeInstanceOf(HairStateSnapshotDependencyError);
  });

  it("rejects creating a CURRENT snapshot for an Analysis belonging to a different client", async () => {
    const { ownerUserId, analysisId } = await createOwnerClientAnalysis();
    const otherClientId = randomUUID();
    await prisma.client.create({ data: { id: otherClientId, ownerUserId, fullName: "Other Client" } });
    await expect(createCurrentSnapshotFromAnalysis(ownerUserId, otherClientId, analysisId)).rejects.toBeInstanceOf(HairStateSnapshotDependencyError);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@hair-state-snapshot-repository.test`, passwordHash: "test", role: "professional", locale: "en" } });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Hair State Snapshot Repository Client" } });
  return { ownerUserId, clientId };
}

async function createOwnerClientAnalysis() {
  const { ownerUserId, clientId } = await createOwnerAndClient();
  const analysis = await createAnalysisForOwner(ownerUserId, clientId, {
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
  });
  await prisma.analysis.update({ where: { id: analysis.id }, data: { hairLength: "long", hairTexture: "wavy", hairCondition: "virgin_healthy" } });
  return { ownerUserId, clientId, analysisId: analysis.id };
}

function cuttingPayload(overrides: Partial<TechnicalCutPlan> = {}): TechnicalCutPlan {
  return {
    structuralTechnique: "one_length",
    cuttingTechnique: "blunt_line",
    sectioning: "diagonal_back",
    elevation: "0_deg_blunt",
    distribution: "natural_fall",
    guideline: "stationary",
    cuttingSteps: [{ stepNumber: 1, zone: "nape", action: "Establish the guideline", elevationAngle: "0_deg_blunt", toolRequired: "shears" }],
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

function evidenceSnapshot() {
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
    derivedSafety: { safetyNotes: [], contraindications: [] },
  };
}

async function confirmedProposalFor(ownerUserId: string, clientId: string, analysisId: string) {
  const draft = await createProposalForOwner(ownerUserId, clientId, analysisId, "cutting", cuttingPayload(), evidenceSnapshot(), "1.0.0-m8");
  const confirmed = await confirmProposal(ownerUserId, draft.id, ownerUserId, null);
  if (!confirmed) throw new Error("fixture setup error: expected confirmed proposal");
  return confirmed;
}

async function createConfirmedMap(
  ownerUserId: string,
  clientId: string,
  analysisId: string,
  zoneOverrides: Partial<Record<string, { lengthIntent?: string; weightIntent?: string }>> = {},
): Promise<string> {
  const confirmed = await confirmedProposalFor(ownerUserId, clientId, analysisId);
  const draftMap = await createDraftFromConfirmedProposal(ownerUserId, clientId, confirmed.id);

  // Apply any real zone overrides directly at the DB level for this test
  // fixture only -- the repository under test never writes payload this
  // way itself; this mirrors the assembler's own real output shape so the
  // fixture stays honest about what a real confirmed map looks like.
  if (Object.keys(zoneOverrides).length > 0) {
    const payload = draftMap.payload as { zones: { zone: string; lengthIntent: string; weightIntent: string }[] };
    const zones = payload.zones.map((z) => (zoneOverrides[z.zone] ? { ...z, ...zoneOverrides[z.zone] } : z));
    await prisma.technicalVisualMap.update({ where: { id: draftMap.id }, data: { payload: { ...payload, zones } } });
  }

  const confirmedMap = await confirmDraftMap(ownerUserId, draftMap.id, null);
  if (!confirmedMap) throw new Error("fixture setup error: expected confirmed map");
  return confirmedMap.id;
}
