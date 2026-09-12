import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { processEvidenceIntoDraft, submitProfessionalCorrection } from "@/lib/professional-learning-draft-service";
import { mockProfessionalLearningExtractor } from "@/lib/professional-learning-mock-extractor";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { findDraftForOwner } from "@/lib/professional-learning-draft-repository";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4 -- the five
// controlled acceptance fixtures this stage's own task requires (Parts
// 23-27), run end-to-end against a real Postgres database: real
// ProfessionalLearningEvidence rows, the real mock extractor, the real
// canonical skill registry, and real ProfessionalLearningDraft
// persistence. No mocking library -- real DB, matching this repo's own
// established convention.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();
const registry = buildCanonicalCandidateSkillRegistry();

suite("Stage 8.5L4 controlled acceptance fixtures", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalLearningDraft.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("Part 23 -- One-Length evidence SUPPORTS the existing approved skill (EVIDENCE_FOR_EXISTING), never a duplicate skill", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createLearningEvidence(ownerUserId, textInput(
      "We start in the posterior area, establishing the contour that carries the length authority for this One-Length Perimeter. " +
      "Sectioning is horizontal partings with natural fall, no elevation. Progression is strand by strand -- the previous cut strand " +
      "remains visible as the guide for continuation. The sides connect to the posterior guide. We verify symmetry and continuous line, " +
      "then recheck dry, natural fall.",
    ));

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry });

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") throw new Error("expected created");
    expect(outcome.draft.discernmentCategory).toBe("PROFESSIONAL_TECHNIQUE");
    expect(outcome.draft.comparisonOutcome).toBe("EVIDENCE_FOR_EXISTING");
    expect(outcome.draft.comparedSkillId).toBe("skill-cutting-one-length-perimeter");
    expect(outcome.draft.status).toBe("DRAFT");
    expect(outcome.draft.conflictDetail).toBeNull();

    // The approved skill row itself is never created, updated, or touched.
    const skillRows = await prisma.professionalSkillDefinition.count();
    expect(skillRows).toBe(0);
  });

  it("Part 24 -- a deliberate contradiction with an approved rule produces POSSIBLE_CONFLICT; the approved skill remains unchanged", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createLearningEvidence(ownerUserId, textInput("Use Slice-and-Slide across a pure One-Length structure as the normal finishing method."));

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry });

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") throw new Error("expected created");
    expect(outcome.draft.comparisonOutcome).toBe("POSSIBLE_CONFLICT");
    expect(outcome.draft.conflictDetail).not.toBeNull();
    expect(outcome.draft.conflictDetail?.reviewRequired).toBe(true);
    expect(outcome.draft.conflictDetail?.existingAuthority.skillId).toBe("skill-cutting-slice-and-slide-refinement");

    // The registry passed in (a plain in-memory snapshot) and the real DB
    // skill table are both untouched -- no automatic overwrite/winner.
    const skillRows = await prisma.professionalSkillDefinition.count();
    expect(skillRows).toBe(0);
  });

  it("Part 25 -- insufficient evidence ('make the haircut softer') never creates procedural fields or a comparable outcome", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createLearningEvidence(ownerUserId, textInput("Make the haircut softer."));

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry });

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") throw new Error("expected created");
    expect(outcome.draft.discernmentCategory).toBe("INSUFFICIENT_EVIDENCE");
    expect(outcome.draft.comparisonOutcome).toBe("INSUFFICIENT_INFORMATION");
    expect(outcome.draft.extraction).toEqual({});
    expect(outcome.draft.comparedSkillId).toBeNull();
  });

  it("Part 26 -- a hairstyle/look name ('Butterfly haircut') is never auto-promoted into a ProfessionalSkillDefinition", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createLearningEvidence(ownerUserId, textInput("Butterfly haircut."));

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry });

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") throw new Error("expected created");
    expect(outcome.draft.discernmentCategory).toBe("RESULT_REFERENCE");
    expect(outcome.draft.comparisonOutcome).toBe("INSUFFICIENT_INFORMATION");
    expect(outcome.draft.comparedSkillId).toBeNull();

    // The critical anti-template assertion: no skill named after this
    // look exists anywhere, before or after processing this evidence.
    const skillRows = await prisma.professionalSkillDefinition.count();
    expect(skillRows).toBe(0);
  });

  it("Part 27 -- a professional correction preserves history: old draft SUPERSEDED, new draft records the correction, distinguishable from AI inference", async () => {
    const { ownerUserId } = await createOwner();
    const originalEvidence = await createLearningEvidence(ownerUserId, textInput("Graduated cutting: fingers point upward while cutting, guide established at the crown."));

    const firstOutcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: originalEvidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry });
    if (firstOutcome.kind !== "created") throw new Error("expected created");
    const priorDraft = firstOutcome.draft;

    // The professional reviews and corrects a specific field -- an
    // explicit, professional-initiated action, never something inferred
    // from free text by this stage's mock extractor.
    const correctionEvidence = await createLearningEvidence(ownerUserId, textInput("Correction: for this technique the fingers point downward, not upward."));

    const correctedDraft = await submitProfessionalCorrection({
      ownerUserId,
      priorDraftId: priorDraft.id,
      correctionEvidenceId: correctionEvidence.id,
      newDraftId: randomUUID(),
      correctedFields: { fingerPosition: { value: "pointing downward", previousValue: "pointing upward" } },
      correctedByUserId: ownerUserId,
    });

    expect(correctedDraft.discernmentCategory).toBe("PROFESSIONAL_CORRECTION");
    expect(correctedDraft.comparisonOutcome).toBe("POSSIBLE_CORRECTION");
    expect(correctedDraft.correctsDraftId).toBe(priorDraft.id);
    expect(correctedDraft.extraction.fingerPosition).toEqual({ value: "pointing downward", source: "PROFESSIONAL_INPUT", confidence: 1 });
    expect(correctedDraft.correctionNote).toMatchObject({
      previousInterpretation: { fingerPosition: "pointing upward" },
      correction: { fingerPosition: "pointing downward" },
      correctedByUserId: ownerUserId,
    });

    // Old interpretation remains historically traceable -- never
    // destructively rewritten.
    const priorAfter = await findDraftForOwner(ownerUserId, priorDraft.id);
    expect(priorAfter?.status).toBe("SUPERSEDED");
    expect(priorAfter?.supersededByDraftId).toBe(correctedDraft.id);
    expect(priorAfter?.extraction).toEqual(priorDraft.extraction);
  });

  it("idempotency: reprocessing the exact same evidence with the same extractor version never creates a duplicate draft", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createLearningEvidence(ownerUserId, textInput("Graduated cutting example with elevation and sectioning described here for reprocessing."));

    const first = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry });
    const second = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry });

    expect(first.kind).toBe("created");
    expect(second.kind).toBe("already_processed");
    if (first.kind !== "created" || second.kind !== "already_processed") throw new Error("unexpected outcome kinds");
    expect(second.draft.id).toBe(first.draft.id);

    const count = await prisma.professionalLearningDraft.count({ where: { sourceEvidenceId: evidence.id } });
    expect(count).toBe(1);
  });

  it("revoked evidence is never (re)processed into a new draft, but a historical draft based on it is preserved unchanged", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createLearningEvidence(ownerUserId, textInput("Graduated cutting revocation-test example with sectioning and elevation."));

    const created = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry });
    if (created.kind !== "created") throw new Error("expected created");

    const { revokeLearningEvidence } = await import("@/lib/professional-learning-evidence-repository");
    await revokeLearningEvidence(ownerUserId, evidence.id);

    const secondEvidence = await createLearningEvidence(ownerUserId, textInput("Second attempt, different evidence, same revoked source concept."));
    await revokeLearningEvidence(ownerUserId, secondEvidence.id);
    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: secondEvidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry });

    expect(outcome.kind).toBe("skipped");
    if (outcome.kind !== "skipped") throw new Error("expected skipped");
    expect(outcome.reason).toBe("EVIDENCE_NOT_ACTIVE");

    // The EARLIER, already-created draft based on the (now revoked)
    // first evidence is preserved exactly as it was -- revocation never
    // silently destroys historical drafts (Part 33).
    const preserved = await findDraftForOwner(ownerUserId, created.draft.id);
    expect(preserved).toEqual(created.draft);
  });
});

function textInput(originalText: string) {
  return {
    evidenceType: "TEXT" as const,
    vertical: "hair_cutting",
    originalText,
    provenance: { channel: "typed" },
    rightsClassification: "USER_OWNED_OR_AUTHORIZED" as const,
  };
}

async function createOwner() {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@learning-draft-acceptance.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  return { ownerUserId };
}
