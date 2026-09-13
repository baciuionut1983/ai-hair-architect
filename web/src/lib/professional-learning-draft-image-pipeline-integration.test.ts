import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { deleteImageFile, saveImageFile } from "@/lib/image-storage";
import { createLearningEvidence, revokeLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { processEvidenceIntoDraft, submitProfessionalCorrection, ProfessionalLearningDraftServiceError } from "@/lib/professional-learning-draft-service";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { findDraftForOwner } from "@/lib/professional-learning-draft-repository";
import type { ProfessionalLearningExtractor, ProfessionalLearningExtractorInput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R2 -- END-TO-END
// proof that the IMAGE/DIAGRAM pipeline (evidence -> ownership-checked
// media resolution -> extractor -> validation with visual grounding
// rules -> UNKNOWN completion -> comparison -> draft) works through the
// REAL service, with a hand-built fake extractor (zero real AI calls,
// Part 26/30). Real Postgres + a real local image file, no mocks.

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();
const localPaths = new Set<string>();
const registry = buildCanonicalCandidateSkillRegistry();
const REAL_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);

function fakeImageExtractor(output: {
  category: string;
  extraction: Record<string, { value: unknown; source: string; confidence?: number }>;
  comparisonSkillIdHint?: string | null;
}): ProfessionalLearningExtractor & { receivedInput?: ProfessionalLearningExtractorInput } {
  const holder: { receivedInput?: ProfessionalLearningExtractorInput } = {};
  return {
    extractorVersion: `fake-image-r2-${randomUUID()}`,
    get receivedInput() {
      return holder.receivedInput;
    },
    async extract(input: ProfessionalLearningExtractorInput) {
      holder.receivedInput = input;
      return {
        discernment: { category: output.category as never, reason: "test" },
        extraction: output.extraction as never,
        comparisonSkillIdHint: output.comparisonSkillIdHint ?? null,
        relatedSkillIdHints: output.comparisonSkillIdHint ? [output.comparisonSkillIdHint] : [],
      };
    },
  };
}

suite("Stage 8.5L4.R2 -- image/diagram pipeline, real service integration", () => {
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

  it("resolves real image bytes ownership-checked and passes them to the extractor, producing a valid draft with OBSERVED visual fields never rejected for lack of text grounding", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);

    const extractor = fakeImageExtractor({
      category: "PROFESSIONAL_TECHNIQUE",
      extraction: { sectioning: { value: "horizontal partings visible in the frame", source: "OBSERVED" }, tool: { value: "scissors", source: "OBSERVED" } },
      comparisonSkillIdHint: "skill-cutting-one-length-perimeter",
    });

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error(`expected created, got ${JSON.stringify(outcome)}`);

    // The extractor genuinely received the real, ownership-checked bytes.
    expect(extractor.receivedInput?.imageMedia?.mimeType).toBe("image/jpeg");
    expect(Buffer.compare(extractor.receivedInput!.imageMedia!.buffer, REAL_JPEG_BYTES)).toBe(0);

    // OBSERVED visual claims survive validation even though
    // evidence.originalText is structurally null for IMAGE evidence.
    expect(outcome.draft.extraction.sectioning).toEqual({ value: "horizontal partings visible in the frame", source: "OBSERVED" });
    expect(outcome.draft.extraction.tool).toEqual({ value: "scissors", source: "OBSERVED" });
    expect(outcome.draft.comparisonOutcome).toBe("EVIDENCE_FOR_EXISTING");

    // UNKNOWN completion still runs identically for image-derived
    // procedural drafts.
    expect(outcome.draft.extraction.fingerAngle).toEqual({ value: null, source: "UNKNOWN" });
  });

  it("Part 21: a finished-look image classified RESULT_REFERENCE never becomes a procedure or a new skill", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);

    const extractor = fakeImageExtractor({ category: "RESULT_REFERENCE", extraction: { targetEffect: { value: "a finished layered look", source: "OBSERVED" } } });

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");

    expect(outcome.draft.comparisonOutcome).toBe("INSUFFICIENT_INFORMATION");
    expect(Object.keys(outcome.draft.extraction)).toEqual(["targetEffect"]);
    expect(await prisma.professionalSkillDefinition.count()).toBe(0);
  });

  it("Part 40 conflict regression (image-shaped, mock/fake only): a rule image proposing Slice-and-Slide on pure One-Length is flagged POSSIBLE_CONFLICT", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);

    const extractor: ProfessionalLearningExtractor = {
      extractorVersion: `fake-conflict-${randomUUID()}`,
      async extract() {
        return {
          discernment: { category: "PROFESSIONAL_RULE", reason: "test" },
          extraction: {},
          comparisonSkillIdHint: "skill-cutting-slice-and-slide-refinement",
          relatedSkillIdHints: ["skill-cutting-slice-and-slide-refinement", "skill-cutting-one-length-perimeter"],
        };
      },
    };

    const before = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");

    expect(outcome.draft.comparisonOutcome).toBe("POSSIBLE_CONFLICT");
    expect(outcome.draft.conflictDetail).not.toBeNull();
    const after = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    expect(after).toBe(before);
  });

  it("Part 46: revoked evidence never reaches media resolution -- the extractor is never called", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);
    await revokeLearningEvidence(ownerUserId, evidenceId);

    let called = false;
    const extractor: ProfessionalLearningExtractor = {
      extractorVersion: "should-not-run",
      async extract() {
        called = true;
        throw new Error("must never be called for revoked evidence");
      },
    };

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    expect(outcome).toEqual({ kind: "skipped", reason: "EVIDENCE_NOT_ACTIVE" });
    expect(called).toBe(false);
  });

  it("Part 45 IDOR: another user cannot process User A's image evidence -- fails closed before media resolution", async () => {
    const { ownerUserId: userA, clientId } = await createOwnerAndClient();
    const { ownerUserId: userB } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(userA, clientId);

    let called = false;
    const extractor: ProfessionalLearningExtractor = {
      extractorVersion: "should-not-run",
      async extract() {
        called = true;
        throw new Error("must never be called cross-owner");
      },
    };

    await expect(processEvidenceIntoDraft({ ownerUserId: userB, evidenceId, draftId: randomUUID(), extractor, registry })).rejects.toThrow(ProfessionalLearningDraftServiceError);
    expect(called).toBe(false);
    expect(await prisma.professionalLearningDraft.count({ where: { ownerUserId: userB } })).toBe(0);
  });

  it("throws IMAGE_MEDIA_UNAVAILABLE (never silently proceeds) when the referenced image bytes cannot actually be read", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    // ImageAsset row exists and is ACTIVE, but its bytes were never stored.
    const assetId = randomUUID();
    await prisma.imageAsset.create({
      data: { id: assetId, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 10, ownerUserId, clientId, storagePath: "pending", storageBackend: null },
    });
    const evidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "IMAGE",
      vertical: "hair_cutting",
      imageAssetId: assetId,
      provenance: { channel: "upload" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const extractor: ProfessionalLearningExtractor = { extractorVersion: "x", async extract() { throw new Error("must not be called"); } };

    await expect(processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry })).rejects.toThrow(
      expect.objectContaining({ code: "IMAGE_MEDIA_UNAVAILABLE" }),
    );
  });

  it("Part 41 professional correction from a visual field: an INFERRED guideType can be corrected to PROFESSIONAL_INPUT, history preserved", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { evidenceId } = await createImageEvidence(ownerUserId, clientId);

    const extractor = fakeImageExtractor({ category: "PROFESSIONAL_TECHNIQUE", extraction: { guideType: { value: "possibly a stationary guide", source: "INFERRED" } }, comparisonSkillIdHint: "skill-cutting-graduated" });
    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");
    expect(outcome.draft.extraction.guideType?.source).toBe("INFERRED");

    const correctionEvidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "TEXT",
      vertical: "hair_cutting",
      originalText: "Correction: no, this is a travelling guide.",
      provenance: { channel: "typed" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const corrected = await submitProfessionalCorrection({
      ownerUserId,
      priorDraftId: outcome.draft.id,
      correctionEvidenceId: correctionEvidence.id,
      newDraftId: randomUUID(),
      correctedFields: { guideType: { value: "a travelling guide", previousValue: "possibly a stationary guide" } },
      correctedByUserId: ownerUserId,
    });

    expect(corrected.extraction.guideType).toEqual({ value: "a travelling guide", source: "PROFESSIONAL_INPUT", confidence: 1 });

    const priorAfter = await findDraftForOwner(ownerUserId, outcome.draft.id);
    expect(priorAfter?.status).toBe("SUPERSEDED");
    expect(priorAfter?.extraction.guideType).toEqual({ value: "possibly a stationary guide", source: "INFERRED" });
  });
});

async function createOwnerAndClient(): Promise<{ ownerUserId: string; clientId: string }> {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@l4r2-image-pipeline.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "L4.R2 Test Client" } });
  return { ownerUserId, clientId };
}

async function createImageEvidence(ownerUserId: string, clientId: string): Promise<{ evidenceId: string; assetId: string }> {
  const assetId = randomUUID();
  const storagePath = await saveImageFile(ownerUserId, assetId, "technique.jpg", REAL_JPEG_BYTES);
  localPaths.add(storagePath);
  await prisma.imageAsset.create({
    data: { id: assetId, fileName: "technique.jpg", mimeType: "image/jpeg", sizeBytes: REAL_JPEG_BYTES.length, ownerUserId, clientId, storagePath, storageBackend: null },
  });
  const evidence = await createLearningEvidence(ownerUserId, {
    evidenceType: "IMAGE",
    vertical: "hair_cutting",
    imageAssetId: assetId,
    provenance: { channel: "upload" },
    rightsClassification: "USER_OWNED_OR_AUTHORIZED",
  });
  return { evidenceId: evidence.id, assetId };
}
