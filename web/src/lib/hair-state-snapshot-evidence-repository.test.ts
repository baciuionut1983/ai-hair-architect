import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { createProposalForOwner, confirmProposal } from "@/lib/proposal-repository";
import { createDraftFromConfirmedProposal } from "@/lib/technical-visual-map-repository";
import { createCaptureSet, createReplacementCaptureSet } from "@/lib/capture-set-repository";
import { createCurrentSnapshotFromAnalysis, createManualSnapshot, createTargetSnapshotFromTechnicalVisualMap } from "@/lib/hair-state-snapshot-repository";
import { HairStateSnapshotEvidenceDependencyError, listResolvedEvidenceForSnapshot } from "@/lib/hair-state-snapshot-evidence-repository";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import type { TechnicalCutPlan } from "@/lib/contracts";

// Professional Skill Engine, Stage 3 -- VISUAL EVIDENCE BINDING, real
// Postgres, no mocks. Mirrors hair-state-snapshot-repository.test.ts's own
// conventions exactly. Skips (never fails) when no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("hair-state-snapshot-evidence-repository (real Postgres)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.hairStateSnapshotEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.hairStateSnapshot.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSetImage.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSet.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.technicalVisualMap.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.analysisProposal.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.analysis.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  // 1. CURRENT snapshot binds to one source image (auto-derived from Analysis.imageAssetId)
  it("1. a CURRENT snapshot auto-derives a PRIMARY_CAPTURE evidence row from Analysis's own imageAssetId", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const { analysisId } = await createOwnerClientAnalysisWithImage(ownerUserId, clientId, image.id);

    const created = await createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId);
    expect(created.evidence).toHaveLength(1);
    expect(created.evidence[0].evidenceKind).toBe("IMAGE_ASSET");
    expect(created.evidence[0].evidenceRole).toBe("PRIMARY_CAPTURE");
    expect(created.evidence[0].imageAssetId).toBe(image.id);

    const resolved = await listResolvedEvidenceForSnapshot(ownerUserId, created.id);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].resolvedImages).toEqual([{ imageAssetId: image.id, viewLabel: null }]);
  });

  // 2. CURRENT snapshot binds to multi-view evidence via a CaptureSet
  it("2. a CURRENT snapshot can bind to a whole multi-view CaptureSet as its evidence", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const front = await createImageAsset(ownerUserId, clientId);
    const back = await createImageAsset(ownerUserId, clientId);
    const captureSet = await createCaptureSet(ownerUserId, clientId, [
      { viewLabel: "FRONT", imageAssetId: front.id },
      { viewLabel: "BACK", imageAssetId: back.id },
    ]);
    const { analysisId } = await createOwnerClientAnalysisWithImage(ownerUserId, clientId, null);

    const created = await createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId, [
      { evidenceKind: "CAPTURE_SET", evidenceRole: "PRIMARY_CAPTURE", captureSetId: captureSet.id },
    ]);

    const resolved = await listResolvedEvidenceForSnapshot(ownerUserId, created.id);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].evidenceKind).toBe("CAPTURE_SET");
    const resolvedIds = resolved[0].resolvedImages.map((r) => r.imageAssetId).sort();
    expect(resolvedIds).toEqual([back.id, front.id].sort());
    const viewLabels = resolved[0].resolvedImages.map((r) => r.viewLabel).sort();
    expect(viewLabels).toEqual(["BACK", "FRONT"]);
  });

  // 3. exact source images round-trip correctly
  it("3. exact source image identity round-trips correctly through real Postgres", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const { analysisId } = await createOwnerClientAnalysisWithImage(ownerUserId, clientId, image.id);
    const created = await createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId);

    const resolved = await listResolvedEvidenceForSnapshot(ownerUserId, created.id);
    expect(resolved[0].resolvedImages[0].imageAssetId).toBe(image.id);
    // Same read twice is byte-identical -- deterministic, no drift.
    const resolvedAgain = await listResolvedEvidenceForSnapshot(ownerUserId, created.id);
    expect(resolved).toEqual(resolvedAgain);
  });

  // 4. old snapshot keeps old evidence after new client image becomes current
  it("4. an old snapshot's evidence keeps pointing at its original CaptureSet after a replacement CaptureSet is created", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const originalFront = await createImageAsset(ownerUserId, clientId);
    const originalCaptureSet = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: originalFront.id }]);
    const { analysisId } = await createOwnerClientAnalysisWithImage(ownerUserId, clientId, null);
    const oldSnapshot = await createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId, [
      { evidenceKind: "CAPTURE_SET", evidenceRole: "PRIMARY_CAPTURE", captureSetId: originalCaptureSet.id },
    ]);

    const newFront = await createImageAsset(ownerUserId, clientId);
    await createReplacementCaptureSet(ownerUserId, clientId, originalCaptureSet.id, [{ viewLabel: "FRONT", imageAssetId: newFront.id }]);

    const resolved = await listResolvedEvidenceForSnapshot(ownerUserId, oldSnapshot.id);
    expect(resolved[0].captureSetId).toBe(originalCaptureSet.id);
    expect(resolved[0].resolvedImages).toEqual([{ imageAssetId: originalFront.id, viewLabel: "FRONT" }]);
  });

  // 5. TARGET snapshot can reference a reference image without pretending it is professional truth
  it("5. a TARGET snapshot can bind a TARGET_REFERENCE image while its own per-fact source stays honestly 'reference_image', never 'professional_input'", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const referenceImage = await createImageAsset(ownerUserId, clientId);

    const payload: HairStateSnapshotPayload = {
      globalState: buildUnassessedGlobalEntry(),
      zones: HEAD_ZONES.map((zone) => ({
        ...buildUnassessedZoneEntry(zone),
        lengthIntent: { value: "shorten", source: "reference_image" as const },
      })),
    };

    const created = await createManualSnapshot(ownerUserId, clientId, "TARGET", payload, {}, [
      { evidenceKind: "IMAGE_ASSET", evidenceRole: "TARGET_REFERENCE", imageAssetId: referenceImage.id },
    ]);

    expect(created.payload.zones.every((z) => z.lengthIntent.source === "reference_image")).toBe(true);
    expect(created.payload.zones.some((z) => z.lengthIntent.source === "professional_input")).toBe(false);
    const resolved = await listResolvedEvidenceForSnapshot(ownerUserId, created.id);
    expect(resolved[0].evidenceRole).toBe("TARGET_REFERENCE");
    expect(resolved[0].resolvedImages[0].imageAssetId).toBe(referenceImage.id);
  });

  // 6. RESULT snapshot can distinguish real observed evidence from generated/reference evidence
  it("6. a RESULT snapshot's evidenceRole distinguishes a real observed after-photo from a generated preview -- never conflated", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const observedPhoto = await createImageAsset(ownerUserId, clientId);
    const generatedPreview = await prisma.imageAsset.create({
      data: { id: randomUUID(), fileName: "preview.jpg", mimeType: "image/jpeg", sizeBytes: 1, ownerUserId, clientId, storagePath: "pending", origin: "ai_generated" },
    });

    const payload: HairStateSnapshotPayload = { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((z) => buildUnassessedZoneEntry(z)) };

    const observedResult = await createManualSnapshot(ownerUserId, clientId, "RESULT", payload, {}, [
      { evidenceKind: "IMAGE_ASSET", evidenceRole: "RESULT_OBSERVED", imageAssetId: observedPhoto.id },
    ]);
    const generatedResult = await createManualSnapshot(ownerUserId, clientId, "RESULT", payload, {}, [
      { evidenceKind: "IMAGE_ASSET", evidenceRole: "RESULT_GENERATED_PREVIEW", imageAssetId: generatedPreview.id },
    ]);

    const observedEvidence = (await listResolvedEvidenceForSnapshot(ownerUserId, observedResult.id))[0];
    const generatedEvidence = (await listResolvedEvidenceForSnapshot(ownerUserId, generatedResult.id))[0];
    expect(observedEvidence.evidenceRole).toBe("RESULT_OBSERVED");
    expect(generatedEvidence.evidenceRole).toBe("RESULT_GENERATED_PREVIEW");

    const observedAsset = await prisma.imageAsset.findUniqueOrThrow({ where: { id: observedEvidence.imageAssetId as string } });
    const generatedAsset = await prisma.imageAsset.findUniqueOrThrow({ where: { id: generatedEvidence.imageAssetId as string } });
    expect(observedAsset.origin).toBe("upload");
    expect(generatedAsset.origin).toBe("ai_generated");
  });

  // 7. per-fact provenance remains independent of evidence linkage
  it("7. per-fact provenance (payload.*.source) is unaffected by whether/how evidence is bound", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const payload: HairStateSnapshotPayload = {
      globalState: { ...buildUnassessedGlobalEntry(), density: { value: "medium", source: "observed" } },
      zones: HEAD_ZONES.map((z) => buildUnassessedZoneEntry(z)),
    };

    const withEvidence = await createManualSnapshot(ownerUserId, clientId, "CURRENT", payload, {}, [
      { evidenceKind: "IMAGE_ASSET", evidenceRole: "PRIMARY_CAPTURE", imageAssetId: image.id },
    ]);
    const withoutEvidence = await createManualSnapshot(ownerUserId, clientId, "CURRENT", payload, {}, []);

    expect(withEvidence.payload.globalState.density).toEqual(withoutEvidence.payload.globalState.density);
    expect(withEvidence.evidence).toHaveLength(1);
    expect(withoutEvidence.evidence).toHaveLength(0);
  });

  // 8. no duplicate TechnicalVisualMap zone authority introduced
  it("8. evidence binding introduces no second zone vocabulary -- viewLabel is CaptureSetViewLabel, never a HeadZone", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const { analysisId } = await createOwnerClientAnalysisWithImage(ownerUserId, clientId, null);
    const created = await createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId, [
      { evidenceKind: "IMAGE_ASSET", evidenceRole: "PRIMARY_CAPTURE", imageAssetId: image.id, viewLabel: "FRONT" },
    ]);
    const resolved = await listResolvedEvidenceForSnapshot(ownerUserId, created.id);
    // "FRONT" is a real CaptureSetViewLabel, and NOT a member of HEAD_ZONES
    // (nape/crown/top/sides/back/fringe-style zone vocabulary) -- proves
    // the two vocabularies stay structurally distinct, never merged.
    expect((HEAD_ZONES as readonly string[]).includes(resolved[0].viewLabel as string)).toBe(false);
  });

  // 9. invalid evidence references fail closed
  it("9. a nonexistent imageAssetId/captureSetId reference fails closed -- never silently creates a dangling pointer", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { analysisId } = await createOwnerClientAnalysisWithImage(ownerUserId, clientId, null);

    await expect(
      createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId, [
        { evidenceKind: "IMAGE_ASSET", evidenceRole: "PRIMARY_CAPTURE", imageAssetId: randomUUID() },
      ]),
    ).rejects.toBeInstanceOf(HairStateSnapshotEvidenceDependencyError);

    await expect(
      createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId, [
        { evidenceKind: "CAPTURE_SET", evidenceRole: "PRIMARY_CAPTURE", captureSetId: randomUUID() },
      ]),
    ).rejects.toBeInstanceOf(HairStateSnapshotEvidenceDependencyError);

    // No snapshot row was left behind by the failed attempts (atomic with
    // the parent transaction -- never a half-created snapshot+evidence pair).
    const remaining = await prisma.hairStateSnapshot.count({ where: { ownerUserId, clientId } });
    expect(remaining).toBe(0);
  });

  // 10. deletion/replacement semantics preserve historical provenance
  it("10. superseding a CaptureSet never mutates its own historical CaptureSetImage rows -- old evidence stays byte-identical", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const originalBack = await createImageAsset(ownerUserId, clientId);
    const originalCaptureSet = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "BACK", imageAssetId: originalBack.id }]);
    const beforeImages = await prisma.captureSetImage.findMany({ where: { captureSetId: originalCaptureSet.id } });

    const newBack = await createImageAsset(ownerUserId, clientId);
    await createReplacementCaptureSet(ownerUserId, clientId, originalCaptureSet.id, [{ viewLabel: "BACK", imageAssetId: newBack.id }]);

    const afterImages = await prisma.captureSetImage.findMany({ where: { captureSetId: originalCaptureSet.id } });
    expect(afterImages).toEqual(beforeImages);
  });

  it("bonus: evidenceRole illegal for the snapshot's own role fails closed (e.g. TARGET_REFERENCE on a CURRENT snapshot)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const { analysisId } = await createOwnerClientAnalysisWithImage(ownerUserId, clientId, null);
    await expect(
      createCurrentSnapshotFromAnalysis(ownerUserId, clientId, analysisId, [
        { evidenceKind: "IMAGE_ASSET", evidenceRole: "TARGET_REFERENCE", imageAssetId: image.id },
      ]),
    ).rejects.toThrow();
  });

  it("evidence binding never mutates the source TechnicalVisualMap row a TARGET snapshot was assembled from", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const referenceImage = await createImageAsset(ownerUserId, clientId);
    const { analysisId } = await createOwnerClientAnalysisWithImage(ownerUserId, clientId, null);
    const confirmed = await confirmedProposalFor(ownerUserId, clientId, analysisId);
    const draftMap = await createDraftFromConfirmedProposal(ownerUserId, clientId, confirmed.id);
    const before = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: draftMap.id } });

    await createTargetSnapshotFromTechnicalVisualMap(ownerUserId, clientId, draftMap.id, [
      { evidenceKind: "IMAGE_ASSET", evidenceRole: "TARGET_REFERENCE", imageAssetId: referenceImage.id },
    ]).catch(() => null); // draftMap is DRAFT, not CONFIRMED -- expected to reject before any evidence write

    const after = await prisma.technicalVisualMap.findUniqueOrThrow({ where: { id: draftMap.id } });
    expect(after.payload).toEqual(before.payload);
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
    data: { id: ownerUserId, email: `${ownerUserId}@hair-state-snapshot-evidence-repository.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Hair State Snapshot Evidence Repository Client" } });
  return { ownerUserId, clientId };
}

async function createImageAsset(ownerUserId: string, clientId: string) {
  return prisma.imageAsset.create({
    data: { id: randomUUID(), fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 12345, ownerUserId, clientId, storagePath: "pending" },
  });
}

async function createOwnerClientAnalysisWithImage(ownerUserId: string, clientId: string, imageAssetId: string | null) {
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
    ...(imageAssetId ? { imageAssetId } : {}),
  });
  await prisma.analysis.update({ where: { id: analysis.id }, data: { hairLength: "long", hairTexture: "wavy", hairCondition: "virgin_healthy" } });
  return { analysisId: analysis.id };
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
