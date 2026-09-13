import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { deleteImageFile, saveImageFile } from "@/lib/image-storage";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { processEvidenceIntoDraft, submitProfessionalCorrection } from "@/lib/professional-learning-draft-service";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { findDraftForOwner } from "@/lib/professional-learning-draft-repository";
import type { ProfessionalLearningExtractor } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R2.1 -- END-TO-END
// proof that the elevation semantic guard runs inside the REAL pipeline
// (processEvidenceIntoDraft), using hand-built fake extractors (zero real
// AI calls, Part 36). Real Postgres + a real local image file, no mocks.

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();
const localPaths = new Set<string>();
const registry = buildCanonicalCandidateSkillRegistry();
const REAL_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 7]);

function fakeExtractor(extraction: Record<string, { value: unknown; source: string; note?: string }>, comparisonSkillIdHint: string | null = null): ProfessionalLearningExtractor {
  return {
    extractorVersion: `fake-r2.1-${randomUUID()}`,
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

suite("Stage 8.5L4.R2.1 -- elevation semantic guard, real pipeline integration", () => {
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

  it("Part 16 replay through the real pipeline: the exact real R2 elevation misclassification is downgraded to UNKNOWN, other fields untouched, no false conflict/support/new-skill distortion", async () => {
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

    expect(outcome.draft.extraction.elevation).toEqual({ value: null, source: "UNKNOWN" });
    expect(outcome.draft.extraction.cuttingLine).toEqual({ value: "Curved line parallel to head shape for round layers", source: "OBSERVED" });
    expect(outcome.draft.comparisonOutcome).toBe("POSSIBLE_NEW_SKILL");
    expect(outcome.draft.comparedSkillId).toBeNull();
    expect(outcome.draft.conflictDetail).toBeNull();

    const after = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    expect(after).toBe(before);
    expect(await prisma.professionalSkillDefinition.count()).toBe(0);
  });

  it("Part 19 positive control: a genuinely grounded visual elevation claim survives as KNOWN through the real pipeline", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);

    const extractor = fakeExtractor({
      elevation: { value: "90 degrees", source: "OBSERVED", note: "The diagram explicitly labels a hair strand lifted 90 degrees away from the head." },
    });

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");
    expect(outcome.draft.extraction.elevation).toEqual({ value: "90 degrees", source: "OBSERVED", note: "The diagram explicitly labels a hair strand lifted 90 degrees away from the head." });
  });

  it("Part 20 negative control: ambiguous generic geometry claiming elevation is downgraded; observation-adjacent fields remain UNKNOWN too since none were separately extracted", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);

    const extractor = fakeExtractor({ elevation: { value: "steep angle", source: "OBSERVED", note: "Angled radial lines are visible in the diagram." } });

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");
    expect(outcome.draft.extraction.elevation).toEqual({ value: null, source: "UNKNOWN" });
  });

  it("Parts 21-24: distribution/overdirection/sectioning/guide claims survive untouched even when an unrelated elevation claim in the SAME draft is downgraded", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);

    const extractor = fakeExtractor({
      distribution: { value: "natural fall", source: "OBSERVED" },
      overdirection: { value: "directed forward toward the face", source: "OBSERVED" },
      sectioning: { value: "horizontal partings visible", source: "OBSERVED" },
      guideType: { value: "a stationary guide is visible at the nape", source: "OBSERVED" },
      elevation: { value: "generic diagram geometry", source: "OBSERVED", note: "Angled projection lines are drawn on the diagram." },
    });

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");

    expect(outcome.draft.extraction.distribution).toEqual({ value: "natural fall", source: "OBSERVED" });
    expect(outcome.draft.extraction.overdirection).toEqual({ value: "directed forward toward the face", source: "OBSERVED" });
    expect(outcome.draft.extraction.sectioning).toEqual({ value: "horizontal partings visible", source: "OBSERVED" });
    expect(outcome.draft.extraction.guideType).toEqual({ value: "a stationary guide is visible at the nape", source: "OBSERVED" });
    expect(outcome.draft.extraction.elevation).toEqual({ value: null, source: "UNKNOWN" });
  });

  it("Part 18 professional correction: an ambiguous elevation now UNKNOWN can be corrected by the professional to a real value, history preserved", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);

    const extractor = fakeExtractor({ elevation: { value: "generic geometry", source: "OBSERVED", note: "Angled lines visible in the diagram." } });
    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");
    expect(outcome.draft.extraction.elevation).toEqual({ value: null, source: "UNKNOWN" });

    const correctionEvidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "TEXT",
      vertical: "hair_cutting",
      originalText: "Correction: this represents distribution, not elevation.",
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
    // Elevation's own ambiguous-but-honest UNKNOWN state is preserved
    // unchanged, not silently rewritten by the correction.
    expect(corrected.extraction.elevation).toEqual({ value: null, source: "UNKNOWN" });

    const priorAfter = await findDraftForOwner(ownerUserId, outcome.draft.id);
    expect(priorAfter?.status).toBe("SUPERSEDED");
    expect(priorAfter?.extraction.elevation).toEqual({ value: null, source: "UNKNOWN" });
  });

  it("IDOR/ownership unaffected by the new guard -- another user still cannot process User A's image evidence", async () => {
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
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@l4r2.1-elevation-guard.test`, passwordHash: "test", role: "professional", locale: "en" } });
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "L4.R2.1 Test Client" } });
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
