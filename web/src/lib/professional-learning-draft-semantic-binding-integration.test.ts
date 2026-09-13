import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { deleteImageFile, saveImageFile } from "@/lib/image-storage";
import { createLearningEvidence, revokeLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { processEvidenceIntoDraft, submitProfessionalCorrection } from "@/lib/professional-learning-draft-service";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { findDraftForOwner } from "@/lib/professional-learning-draft-repository";
import type { ProfessionalLearningExtractor } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R2.2 -- END-TO-END
// proof that the GENERAL semantic-binding guard runs inside the REAL
// pipeline (processEvidenceIntoDraft), using hand-built fake extractors
// (zero real AI calls, Part 41). Real Postgres + a real local image
// file, no mocks. Supersedes L4.R2.1's own elevation-only integration
// test -- every case that file proved still holds (replayed here too),
// generalized across multiple fields.

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();
const localPaths = new Set<string>();
const registry = buildCanonicalCandidateSkillRegistry();
const REAL_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 3, 3, 3, 3]);

function fakeExtractor(extraction: Record<string, { value: unknown; source: string; note?: string }>, comparisonSkillIdHint: string | null = null): ProfessionalLearningExtractor {
  return {
    extractorVersion: `fake-r2.2-${randomUUID()}`,
    async extract() {
      return {
        discernment: { category: "PROFESSIONAL_TECHNIQUE" as never, reason: "test" },
        extraction: extraction as never,
        comparisonSkillIdHint,
        relatedSkillIdHints: comparisonSkillIdHint ? [comparisonSkillIdHint] : [],
      };
    },
  };
}

suite("Stage 8.5L4.R2.2 -- general semantic binding guard, real pipeline integration", () => {
  afterEach(async () => {
    for (const path of localPaths) {
      await deleteImageFile(path).catch(() => undefined);
    }
    localPaths.clear();
    const ownerUserIds = [...owners];
    await prisma.professionalLearningDraft.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("Part 17 replay through the real pipeline: the exact real R2 Layers elevation misclassification is downgraded, observation preserved, sibling fields untouched, no false conflict/support/new-skill distortion", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);

    const extractor = fakeExtractor(
      {
        techniqueCandidate: { value: "Layering variations", source: "OBSERVED" },
        cuttingLine: { value: "Curved line parallel to head shape for round layers", source: "OBSERVED" },
        elevation: {
          value: "Perpendicular radial projection for round layers; orthogonal/planar projection for square and triangular layers",
          source: "OBSERVED",
          note: "Represented visually by directional projection arrows extending from head contours.",
        },
      },
      null, // no registry match -- mirrors the real R2 POSSIBLE_NEW_SKILL result
    );

    const before = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");

    expect(outcome.draft.extraction.elevation?.source).toBe("UNKNOWN");
    expect(outcome.draft.extraction.elevation?.value).toBeNull();
    // Part 13 "Observation First" -- the original observation is preserved, not discarded.
    expect(outcome.draft.extraction.elevation?.rawObservation).toContain("directional projection arrows");
    expect(outcome.draft.extraction.cuttingLine).toEqual({ value: "Curved line parallel to head shape for round layers", source: "OBSERVED" });
    expect(outcome.draft.comparisonOutcome).toBe("POSSIBLE_NEW_SKILL");
    expect(outcome.draft.comparedSkillId).toBeNull();
    expect(outcome.draft.conflictDetail).toBeNull();

    const after = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    expect(after).toBe(before);
    expect(await prisma.professionalSkillDefinition.count()).toBe(0);
  });

  it("Part 18/19 cross-field misbinding: scalp divisions mislabeled overdirection, and a strand-lift observation mislabeled sectioning, are both rejected", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId: evidenceA } = await createImageEvidence(ownerUserId, clientId);
    const { evidenceId: evidenceB } = await createImageEvidence(ownerUserId, clientId);

    const outcomeA = await processEvidenceIntoDraft({
      ownerUserId,
      evidenceId: evidenceA,
      draftId: randomUUID(),
      extractor: fakeExtractor({ overdirection: { value: "generic divisions", source: "OBSERVED", note: "Visible scalp divisions with parting lines are shown." } }),
      registry,
    });
    if (outcomeA.kind !== "created") throw new Error("expected created");
    expect(outcomeA.draft.extraction.overdirection?.source).toBe("UNKNOWN");

    const outcomeB = await processEvidenceIntoDraft({
      ownerUserId,
      evidenceId: evidenceB,
      draftId: randomUUID(),
      extractor: fakeExtractor({ sectioning: { value: "generic lift", source: "OBSERVED", note: "A strand is visibly held away from the head at an angle." } }),
      registry,
    });
    if (outcomeB.kind !== "created") throw new Error("expected created");
    expect(outcomeB.draft.extraction.sectioning?.source).toBe("UNKNOWN");
  });

  it("Parts 20-24: positive controls for cuttingAngle, fingerAngle, toolOrientation, distribution, overdirection, sectioning, and guide all survive as KNOWN when properly grounded, and never leak into each other", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);

    const extractor = fakeExtractor({
      cuttingAngle: { value: "steep", source: "OBSERVED", note: "The scissors are shown cutting at a specific blade angle relative to the hair." },
      fingerAngle: { value: "angled", source: "OBSERVED", note: "Fingers are visibly positioned at a finger angle to control the strand." },
      toolOrientation: { value: "horizontal", source: "OBSERVED", note: "The scissors are visibly held horizontally near the section." },
      distribution: { value: "natural fall", source: "OBSERVED" },
      overdirection: { value: "toward the face", source: "OBSERVED", note: "The section is directed forward toward the face." },
      sectioning: { value: "horizontal partings", source: "OBSERVED" },
      guideType: { value: "stationary", source: "OBSERVED", note: "A visible guide strand establishes the continuation authority for the next section." },
    });

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");

    expect(outcome.draft.extraction.cuttingAngle?.source).toBe("OBSERVED");
    expect(outcome.draft.extraction.fingerAngle?.source).toBe("OBSERVED");
    expect(outcome.draft.extraction.toolOrientation?.source).toBe("OBSERVED");
    expect(outcome.draft.extraction.distribution?.source).toBe("OBSERVED");
    expect(outcome.draft.extraction.overdirection?.source).toBe("OBSERVED");
    expect(outcome.draft.extraction.sectioning?.source).toBe("OBSERVED");
    expect(outcome.draft.extraction.guideType?.source).toBe("OBSERVED");
  });

  it("Part 20 negative control: ambiguous generic geometry claiming elevation is downgraded with the observation preserved", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);

    const extractor = fakeExtractor({ elevation: { value: "steep angle", source: "OBSERVED", note: "Angled radial lines are visible in the diagram." } });

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");
    expect(outcome.draft.extraction.elevation?.source).toBe("UNKNOWN");
    expect(outcome.draft.extraction.elevation?.rawObservation).toBeDefined();
  });

  it("Part 28 explicit annotation binding: a 90° label bound to the strand/head relationship survives; an unbound 90° label does not", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId: boundEvidence } = await createImageEvidence(ownerUserId, clientId);
    const { evidenceId: unboundEvidence } = await createImageEvidence(ownerUserId, clientId);

    const bound = await processEvidenceIntoDraft({
      ownerUserId,
      evidenceId: boundEvidence,
      draftId: randomUUID(),
      extractor: fakeExtractor({ elevation: { value: "90 degrees", source: "OBSERVED", note: "The diagram explicitly labels the strand at 90 degrees from the head." } }),
      registry,
    });
    if (bound.kind !== "created") throw new Error("expected created");
    expect(bound.draft.extraction.elevation?.source).toBe("OBSERVED");

    const unbound = await processEvidenceIntoDraft({
      ownerUserId,
      evidenceId: unboundEvidence,
      draftId: randomUUID(),
      extractor: fakeExtractor({ elevation: { value: "90°", source: "OBSERVED", note: "A 90 degree angle mark is visible somewhere in the diagram." } }),
      registry,
    });
    if (unbound.kind !== "created") throw new Error("expected created");
    expect(unbound.draft.extraction.elevation?.source).toBe("UNKNOWN");
  });

  it("Part 29/30: PROFESSIONAL_INPUT elevation claims (positive AND negative) always survive, real authority never second-guessed", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId: positive } = await createImageEvidence(ownerUserId, clientId);
    const { evidenceId: negative } = await createImageEvidence(ownerUserId, clientId);

    const positiveOutcome = await processEvidenceIntoDraft({
      ownerUserId,
      evidenceId: positive,
      draftId: randomUUID(),
      extractor: fakeExtractor({ elevation: { value: "90 degrees", source: "PROFESSIONAL_INPUT" } }),
      registry,
    });
    if (positiveOutcome.kind !== "created") throw new Error("expected created");
    expect(positiveOutcome.draft.extraction.elevation).toEqual({ value: "90 degrees", source: "PROFESSIONAL_INPUT" });

    const negativeOutcome = await processEvidenceIntoDraft({
      ownerUserId,
      evidenceId: negative,
      draftId: randomUUID(),
      extractor: fakeExtractor({ elevation: { value: "No elevation, natural fall.", source: "PROFESSIONAL_INPUT" } }),
      registry,
    });
    if (negativeOutcome.kind !== "created") throw new Error("expected created");
    expect(negativeOutcome.draft.extraction.elevation).toEqual({ value: "No elevation, natural fall.", source: "PROFESSIONAL_INPUT" });
  });

  it("Part 15/18 professional correction over an ambiguous binding: old observation preserved historically, new value is PROFESSIONAL_INPUT, no destructive rewrite", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);

    const extractor = fakeExtractor({ elevation: { value: "generic geometry", source: "OBSERVED", note: "Angled lines visible in the diagram." } });
    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");
    expect(outcome.draft.extraction.elevation?.source).toBe("UNKNOWN");
    expect(outcome.draft.extraction.elevation?.rawObservation).toContain("Angled lines");

    const correctionEvidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "TEXT",
      vertical: "hair_cutting",
      originalText: "Correction: aceste linii reprezintă distribuția, nu elevația.",
      provenance: { channel: "typed" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const corrected = await submitProfessionalCorrection({
      ownerUserId,
      priorDraftId: outcome.draft.id,
      correctionEvidenceId: correctionEvidence.id,
      newDraftId: randomUUID(),
      correctedFields: { distribution: { value: "radial projection pattern", previousValue: null } },
      correctedByUserId: ownerUserId,
    });

    expect(corrected.extraction.distribution).toEqual({ value: "radial projection pattern", source: "PROFESSIONAL_INPUT", confidence: 1 });
    // The elevation field's own honest, ambiguous-but-preserved state is
    // untouched by an unrelated correction to a different field.
    expect(corrected.extraction.elevation?.source).toBe("UNKNOWN");
    expect(corrected.extraction.elevation?.rawObservation).toContain("Angled lines");

    const priorAfter = await findDraftForOwner(ownerUserId, outcome.draft.id);
    expect(priorAfter?.status).toBe("SUPERSEDED");
    expect(priorAfter?.extraction.elevation?.rawObservation).toContain("Angled lines");
  });

  it("Part 33: an ambiguous binding never increases registry support, never creates a conflict, and never triggers automatic new-skill creation", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);

    // Mentions a real registry skill by hint, but the ONLY extracted
    // technical field is an ambiguous, rejected elevation claim.
    const extractor = fakeExtractor(
      { elevation: { value: "generic geometry", source: "OBSERVED", note: "Angled lines are visible." } },
      "skill-cutting-one-length-perimeter",
    );

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");

    // Comparison is driven entirely by the skill-name hint, never by
    // field-level ambiguity -- still resolves the same as it would with
    // NO elevation claim at all.
    expect(outcome.draft.comparisonOutcome).toBe("EVIDENCE_FOR_EXISTING");
    expect(outcome.draft.conflictDetail).toBeNull();
    expect(await prisma.professionalSkillDefinition.count()).toBe(0);
  });

  it("Part 32/35 One-Length regression: real TEXT evidence's explicit 'no elevation' is never touched by the general guard", async () => {
    const { ownerUserId } = await createOwnerAndClient();
    const evidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "TEXT",
      vertical: "hair_cutting",
      originalText: "No elevation is used. Natural fall throughout. Posterior starting area, horizontal partings.",
      provenance: { channel: "typed" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const extractor = fakeExtractor({ elevation: { value: "0 degrees (natural fall)", source: "OBSERVED" } }, "skill-cutting-one-length-perimeter");
    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");

    expect(outcome.draft.extraction.elevation).toEqual({ value: "0 degrees (natural fall)", source: "OBSERVED" });
  });

  it("Part 38: revoked evidence never reaches the extractor or the semantic guard", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);
    await revokeLearningEvidence(ownerUserId, evidenceId);

    let called = false;
    const extractor: ProfessionalLearningExtractor = { extractorVersion: "x", async extract() { called = true; throw new Error("must not be called"); } };
    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });

    expect(outcome).toEqual({ kind: "skipped", reason: "EVIDENCE_NOT_ACTIVE" });
    expect(called).toBe(false);
  });

  it("Part 36/37 IDOR/ownership unaffected by the new guard -- another user still cannot process User A's image evidence", async () => {
    const { ownerUserId: userA, clientId } = await createOwnerAndClient();
    const { ownerUserId: userB } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(userA, clientId);

    let called = false;
    const extractor: ProfessionalLearningExtractor = { extractorVersion: "x", async extract() { called = true; throw new Error("must not be called"); } };

    await expect(processEvidenceIntoDraft({ ownerUserId: userB, evidenceId, draftId: randomUUID(), extractor, registry })).rejects.toThrow();
    expect(called).toBe(false);
  });
});

async function createOwnerAndClient(): Promise<{ ownerUserId: string; clientId: string }> {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@l4r2.2-semantic-binding.test`, passwordHash: "test", role: "professional", locale: "en" } });
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "L4.R2.2 Test Client" } });
  return { ownerUserId, clientId };
}

async function createImageEvidence(ownerUserId: string, clientId: string): Promise<{ evidenceId: string }> {
  const assetId = randomUUID();
  const storagePath = await saveImageFile(ownerUserId, assetId, "diagram.jpg", REAL_JPEG_BYTES);
  localPaths.add(storagePath);
  await prisma.imageAsset.create({
    data: { id: assetId, fileName: "diagram.jpg", mimeType: "image/jpeg", sizeBytes: REAL_JPEG_BYTES.length, ownerUserId, clientId, storagePath, storageBackend: null },
  });
  const evidence = await createLearningEvidence(ownerUserId, {
    evidenceType: "DIAGRAM",
    vertical: "hair_cutting",
    imageAssetId: assetId,
    provenance: { channel: "upload" },
    rightsClassification: "USER_OWNED_OR_AUTHORIZED",
  });
  return { evidenceId: evidence.id };
}
