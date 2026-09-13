import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { deleteImageFile, saveImageFile } from "@/lib/image-storage";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { processEvidenceIntoDraft, submitProfessionalCorrection } from "@/lib/professional-learning-draft-service";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { findDraftForOwner } from "@/lib/professional-learning-draft-repository";
import type { ProfessionalLearningExtractor, ProfessionalLearningExtractorInput, ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";
import type { ProfessionalLearningExtractedField } from "@/lib/professional-learning-draft-validators";
import { L5R1_REAL_CAPTURED_OUTPUT } from "@/lib/professional-learning-video-l5r1-real-fixture";
import { assessRepetition, assessZoneCompletion, createActionCandidate } from "@/lib/professional-learning-video-temporal-reasoning";
import type { ReferenceDependencyRelationship } from "@/lib/professional-learning-reference-dependency";
import type { ReviewedComparisonResult } from "@/lib/professional-learning-reviewed-comparison";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R1.1 -- PROFESSIONAL
// GUIDE RELATIONSHIP / REFERENCE DEPENDENCY integration acceptance
// (Section 28/29). Real Postgres, ZERO real AI calls anywhere -- reuses
// the exact captured L5.R1 fixture (professional-learning-video-l5r1-
// real-fixture.ts) via a call-counting fake extractor, then layers
// Ionuț's real post-hoc professional review on top via the EXISTING
// submitProfessionalCorrection pathway (Stage 8.5L4's own mechanism,
// extended, never replaced).
//
// ABSOLUTE PROVENANCE RULE (Section 2): this file proves the ORIGINAL
// blind draft's own `extraction` JSON is never mutated by the
// correction -- a NEW row is created, the old one is marked SUPERSEDED
// (status change only), never rewritten.

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();
const localPaths = new Set<string>();
const DUMMY_MP4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4]);

class CountingReplayExtractor implements ProfessionalLearningExtractor {
  readonly extractorVersion = "gemini-real-v1:gemini-3.6-flash";
  callCount = 0;
  async extract(_input: ProfessionalLearningExtractorInput): Promise<ProfessionalLearningExtractorOutput> {
    this.callCount += 1;
    return L5R1_REAL_CAPTURED_OUTPUT;
  }
}

suite("Stage 8.5L5.R1.1 -- professional guide/reference correction integrated over the real L5.R1 fixture (ZERO AI calls)", () => {
  afterEach(async () => {
    for (const p of localPaths) await deleteImageFile(p).catch(() => undefined);
    localPaths.clear();
    const ownerUserIds = [...owners];
    await prisma.professionalLearningDraft.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("Section 28: professional review adds 0deg + guide relationship as PROFESSIONAL_INPUT without rewriting the original blind draft", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const assetId = randomUUID();
    const storagePath = await saveImageFile(ownerUserId, assetId, "video.mp4", DUMMY_MP4);
    localPaths.add(storagePath);
    await prisma.videoAsset.create({ data: { id: assetId, ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: DUMMY_MP4.length, storagePath, storageBackend: null, origin: "uploaded_source" } });

    const evidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "VIDEO",
      vertical: "hair_cutting",
      videoAssetId: assetId,
      provenance: { channel: "upload", purpose: "PROFESSIONAL_LEARNING" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const registry = buildCanonicalCandidateSkillRegistry();
    const beforeSnapshot = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    const skillRowsBefore = await prisma.professionalSkillDefinition.count();

    // --- Step 1: reproduce the original blind draft, zero AI calls. ---
    const blindExtractor = new CountingReplayExtractor();
    const originalOutcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: blindExtractor, registry, domainHint: "HAIR / CUTTING" });
    expect(blindExtractor.callCount).toBe(1);
    if (originalOutcome.kind !== "created") throw new Error("expected created");
    const originalDraft = originalOutcome.draft;

    // 8/9/10 (checklist #1-3): original provider result -- no elevation,
    // no guide (both explicit UNKNOWN via R1.1's own normalization, never
    // a concrete value), POSSIBLE_NEW_SKILL, exactly matching the
    // captured fixture.
    expect(originalDraft.comparisonOutcome).toBe("POSSIBLE_NEW_SKILL");
    expect(originalDraft.extraction.elevation).toEqual({ value: null, source: "UNKNOWN" });
    expect(originalDraft.extraction.guideType).toEqual({ value: null, source: "UNKNOWN" });
    expect(originalDraft.extraction.guideSource).toEqual({ value: null, source: "UNKNOWN" });
    const originalExtractionSnapshot = JSON.stringify(originalDraft.extraction);

    // --- Step 2: Ionuț's professional review, submitted as a correction. ---
    const correctionEvidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "TEXT",
      vertical: "hair_cutting",
      originalText: "Professional review: hair is combed downward, cut at 0 degrees. A guide strand is established, and the next strand is cut to that guide.",
      provenance: { channel: "typed" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const correctedDraft = await submitProfessionalCorrection({
      ownerUserId,
      priorDraftId: originalDraft.id,
      correctionEvidenceId: correctionEvidence.id,
      newDraftId: randomUUID(),
      correctedFields: {
        elevation: { value: "0 degrees (no elevation)", previousValue: null },
        startingState: { value: "Hair combed downward", previousValue: null },
        guideType: { value: "Guide strand established and used to control the next strand", previousValue: null },
        guideSource: { value: "Established during this procedure (not a pre-existing structural authority)", previousValue: null },
      },
      referenceDependencies: [
        {
          sourceEntity: { ref: "establish-guide-action", kind: "PROFESSIONAL_STATEMENT" },
          targetEntity: { ref: "guide-strand", kind: "PROFESSIONAL_STATEMENT", label: "guide strand" },
          relationshipType: "ESTABLISHES_REFERENCE",
          referenceRole: "CONTINUATION_GUIDE",
          note: "A guide strand is established/selected.",
        },
        {
          sourceEntity: { ref: "guide-strand", kind: "PROFESSIONAL_STATEMENT", label: "guide strand" },
          targetEntity: { ref: "next-strand", kind: "PROFESSIONAL_STATEMENT", label: "next strand" },
          relationshipType: "CUTS_TO_REFERENCE",
          referenceRole: "CONTINUATION_GUIDE",
          note: "The next strand is cut using the established guide strand.",
        },
      ],
      registry,
      correctedByUserId: ownerUserId,
    });

    // --- Checklist item 1-3: original draft's own extraction is byte-for-byte unchanged. ---
    const reloadedOriginal = await findDraftForOwner(ownerUserId, originalDraft.id);
    expect(reloadedOriginal?.status).toBe("SUPERSEDED");
    expect(JSON.stringify(reloadedOriginal?.extraction)).toBe(originalExtractionSnapshot);
    expect(reloadedOriginal?.extraction.elevation).toEqual({ value: null, source: "UNKNOWN" });
    expect(reloadedOriginal?.extraction.guideType).toEqual({ value: null, source: "UNKNOWN" });

    // --- Checklist item 4: 0deg is PROFESSIONAL_INPUT on the NEW draft. ---
    expect(correctedDraft.extraction.elevation).toEqual({ value: "0 degrees (no elevation)", source: "PROFESSIONAL_INPUT", confidence: 1 });

    // --- Checklist item 5/6: guide establishment + guide use are PROFESSIONAL_INPUT relationships. ---
    const referenceDependencies = (correctedDraft.correctionNote?.referenceDependencies ?? []) as readonly ReferenceDependencyRelationship[];
    expect(referenceDependencies).toHaveLength(2);
    const establishes = referenceDependencies.find((r) => r.relationshipType === "ESTABLISHES_REFERENCE");
    const cutsTo = referenceDependencies.find((r) => r.relationshipType === "CUTS_TO_REFERENCE");
    expect(establishes?.provenance).toBe("PROFESSIONAL_INPUT");
    expect(establishes?.established).toBe(true);
    expect(cutsTo?.provenance).toBe("PROFESSIONAL_INPUT");
    expect(cutsTo?.established).toBe(true);

    // --- Checklist item 7: no unsupported field becomes OBSERVED; fields
    // never touched by the correction remain exactly as before (UNKNOWN
    // where the original left them, never silently filled). ---
    for (const field of Object.values(correctedDraft.extraction) as readonly ProfessionalLearningExtractedField[]) {
      if (field.source === "OBSERVED") {
        // Every OBSERVED field must trace back to the ORIGINAL draft --
        // this correction never manufactures a new OBSERVED claim.
        expect(originalExtractionSnapshot).toContain(JSON.stringify(field.value));
      }
    }
    // Untouched by this correction -- inherited unchanged from the prior
    // draft's own R1.1-normalized UNKNOWN entries, never silently filled
    // with a guessed value by this stage.
    expect(correctedDraft.extraction.distribution).toEqual({ value: null, source: "UNKNOWN" });
    expect(correctedDraft.extraction.overdirection).toEqual({ value: null, source: "UNKNOWN" });
    expect(correctedDraft.extraction.cuttingAngle).toEqual({ value: null, source: "UNKNOWN" });
    expect(correctedDraft.extraction.fingerAngle).toEqual({ value: null, source: "UNKNOWN" });

    // --- Checklist item 8: zero new AI calls anywhere in this step. ---
    expect(blindExtractor.callCount).toBe(1); // unchanged since step 1 -- submitProfessionalCorrection takes no extractor at all.

    // --- Checklist item 9: registry snapshot unchanged. ---
    const afterSnapshot = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    expect(afterSnapshot).toBe(beforeSnapshot);
    expect(await prisma.professionalSkillDefinition.count()).toBe(skillRowsBefore);
    expect(skillRowsBefore).toBe(0);

    // --- Checklist item 10 / Section 16: even with an established guide
    // relationship, zone completion remains conservative -- one use of a
    // guide, with no declared scope, is NOT completion. ---
    const cuttingAction = createActionCandidate(["seg-1"], ["obs-1"], "CUTS_TO_REFERENCE", "APPROXIMATE", "APPROXIMATE");
    const repetition = assessRepetition([cuttingAction], "CUTS_TO_REFERENCE");
    const zoneCompletion = assessZoneCompletion({ repetition, progression: { status: "UNKNOWN", zoneSequence: [] }, resultObservationPresent: false, validationPresent: false });
    expect(zoneCompletion).not.toBe("COMPLETED");

    // --- Section 33: the reviewed draft remains DRAFT, never auto-approved/activated. ---
    expect(correctedDraft.status).toBe("DRAFT");

    // --- Section 29/46/47: reclassification review -- does the reviewed
    // evidence support Construct One-Length Perimeter? ---
    const reviewedComparison = correctedDraft.correctionNote?.reviewedComparison as ReviewedComparisonResult | undefined;
    expect(reviewedComparison?.outcome).toBe("VARIATION_OF_EXISTING");
    expect(reviewedComparison?.comparedSkillId).toBe("skill-cutting-one-length-perimeter");

    // Section 21: the row's OWN comparisonOutcome column is untouched by
    // this new mechanism -- still the existing, unmodified
    // createCorrectionDraft behavior (hardcoded POSSIBLE_CORRECTION),
    // never overwritten with the reviewed outcome.
    expect(correctedDraft.comparisonOutcome).toBe("POSSIBLE_CORRECTION");
  });

  it("Section 33: submitProfessionalCorrection never creates or mutates a ProfessionalSkillDefinition row, even when reviewedComparison finds a strong match", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const assetId = randomUUID();
    const storagePath = await saveImageFile(ownerUserId, assetId, "video.mp4", DUMMY_MP4);
    localPaths.add(storagePath);
    await prisma.videoAsset.create({ data: { id: assetId, ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: DUMMY_MP4.length, storagePath, storageBackend: null, origin: "uploaded_source" } });
    const evidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "VIDEO",
      vertical: "hair_cutting",
      videoAssetId: assetId,
      provenance: { channel: "upload" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });
    const registry = buildCanonicalCandidateSkillRegistry();
    const extractor = new CountingReplayExtractor();
    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");

    const correctionEvidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "TEXT",
      vertical: "hair_cutting",
      originalText: "0 degrees, guide established and used.",
      provenance: { channel: "typed" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    await submitProfessionalCorrection({
      ownerUserId,
      priorDraftId: outcome.draft.id,
      correctionEvidenceId: correctionEvidence.id,
      newDraftId: randomUUID(),
      correctedFields: { elevation: { value: "0 degrees", previousValue: null } },
      referenceDependencies: [
        { sourceEntity: { ref: "a", kind: "PROFESSIONAL_STATEMENT" }, targetEntity: { ref: "b", kind: "PROFESSIONAL_STATEMENT" }, relationshipType: "ESTABLISHES_REFERENCE" },
        { sourceEntity: { ref: "b", kind: "PROFESSIONAL_STATEMENT" }, targetEntity: { ref: "c", kind: "PROFESSIONAL_STATEMENT" }, relationshipType: "CUTS_TO_REFERENCE" },
      ],
      registry,
      correctedByUserId: ownerUserId,
    });

    expect(await prisma.professionalSkillDefinition.count()).toBe(0);
  });
});

async function createOwnerAndClient(): Promise<{ ownerUserId: string; clientId: string }> {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@l5r1-1-correction.test`, passwordHash: "test", role: "professional", locale: "en" } });
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "L5.R1.1 Correction Client" } });
  return { ownerUserId, clientId };
}
