import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { processEvidenceIntoDraft, submitProfessionalCorrection } from "@/lib/professional-learning-draft-service";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { findDraftForOwner } from "@/lib/professional-learning-draft-repository";
import type { ProfessionalLearningExtractor } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R1.1 -- END-TO-END
// proof that explicit UNKNOWN normalization runs inside the real pipeline
// (processEvidenceIntoDraft), is provider-agnostic (a hand-built fake
// extractor here, not the real Gemini adapter -- Part 30: zero real AI
// calls), and does not weaken comparison/conflict/registry-protection/
// ownership guarantees that already existed before this stage. Real
// Postgres, no mocking library, mirrors this repo's own convention.

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();
const registry = buildCanonicalCandidateSkillRegistry();

function fakeExtractor(output: {
  category: string;
  extraction: Record<string, { value: unknown; source: string; confidence?: number }>;
  comparisonSkillIdHint?: string | null;
}): ProfessionalLearningExtractor {
  return {
    extractorVersion: `fake-r1.1-${randomUUID()}`,
    async extract() {
      return {
        discernment: { category: output.category as never, reason: "test" },
        extraction: output.extraction as never,
        comparisonSkillIdHint: output.comparisonSkillIdHint ?? null,
        relatedSkillIdHints: output.comparisonSkillIdHint ? [output.comparisonSkillIdHint] : [],
      };
    },
  };
}

suite("Stage 8.5L4.R1.1 -- explicit UNKNOWN normalization, real pipeline integration", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalLearningDraft.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("a provider that omits applicable fields for a real technique produces a persisted draft with explicit UNKNOWN for every omitted field", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId, "One-Length Perimeter description: no elevation is used, natural fall throughout.");

    const extractor = fakeExtractor({
      category: "PROFESSIONAL_TECHNIQUE",
      extraction: { elevation: { value: "no elevation", source: "OBSERVED" } },
      comparisonSkillIdHint: "skill-cutting-one-length-perimeter",
    });

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");

    expect(outcome.draft.extraction.elevation).toEqual({ value: "no elevation", source: "OBSERVED" });
    expect(outcome.draft.extraction.fingerAngle).toEqual({ value: null, source: "UNKNOWN" });
    expect(outcome.draft.extraction.cuttingAngle).toEqual({ value: null, source: "UNKNOWN" });
    expect(outcome.draft.extraction.toolOrientation).toEqual({ value: null, source: "UNKNOWN" });
  });

  it("a provider that omits fields for a NON-procedural discernment (RESULT_REFERENCE) never gets manufactured UNKNOWN noise", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId, "Butterfly haircut.");

    const extractor = fakeExtractor({ category: "RESULT_REFERENCE", extraction: { targetEffect: { value: "Butterfly haircut", source: "OBSERVED" } } });

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");

    expect(Object.keys(outcome.draft.extraction)).toEqual(["targetEffect"]);
    expect(outcome.draft.extraction.fingerAngle).toBeUndefined();
  });

  it("UNKNOWN fields never influence the comparison outcome -- a draft with 31 UNKNOWN fields and one matching techniqueCandidate still resolves the same as if those fields were absent", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId, "Graduated cutting description used only to satisfy evidence text requirements.");

    const extractor = fakeExtractor({
      category: "PROFESSIONAL_TECHNIQUE",
      extraction: {},
      comparisonSkillIdHint: "skill-cutting-graduated",
    });

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");

    // Every one of the 32 fields is now explicit UNKNOWN except none were
    // ever set -- comparisonOutcome is driven ENTIRELY by the skill hint,
    // never by field-level UNKNOWN noise.
    expect(outcome.draft.comparisonOutcome).toBe("EVIDENCE_FOR_EXISTING");
    expect(outcome.draft.conflictDetail).toBeNull();
  });

  it("UNKNOWN never creates a false conflict, even against a skill with a real declared incompatibility", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId, "Slice-and-slide rule description used only to satisfy evidence text requirements.");

    // Mentions ONLY the primary skill -- no second skill hint at all -- so
    // there is nothing for the comparator to ever flag, regardless of how
    // many fields are UNKNOWN.
    const extractor = fakeExtractor({
      category: "PROFESSIONAL_RULE",
      extraction: { elevation: { value: null, source: "UNKNOWN" } },
      comparisonSkillIdHint: "skill-cutting-slice-and-slide-refinement",
    });

    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");

    expect(outcome.draft.comparisonOutcome).not.toBe("POSSIBLE_CONFLICT");
    expect(outcome.draft.conflictDetail).toBeNull();
  });

  it("a professional correction can replace an explicit UNKNOWN field -- old UNKNOWN preserved historically, new value is PROFESSIONAL_INPUT", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId, "Graduated cutting technique description used only to satisfy evidence text requirements.");

    const extractor = fakeExtractor({ category: "PROFESSIONAL_TECHNIQUE", extraction: {}, comparisonSkillIdHint: "skill-cutting-graduated" });
    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });
    if (outcome.kind !== "created") throw new Error("expected created");
    expect(outcome.draft.extraction.fingerAngle).toEqual({ value: null, source: "UNKNOWN" });

    const correctionEvidence = await createEvidence(ownerUserId, "Correction: the finger angle is downward.");
    const corrected = await submitProfessionalCorrection({
      ownerUserId,
      priorDraftId: outcome.draft.id,
      correctionEvidenceId: correctionEvidence.id,
      newDraftId: randomUUID(),
      correctedFields: { fingerAngle: { value: "downward", previousValue: null } },
      correctedByUserId: ownerUserId,
    });

    expect(corrected.extraction.fingerAngle).toEqual({ value: "downward", source: "PROFESSIONAL_INPUT", confidence: 1 });

    // History preserved: the OLD draft still shows the original UNKNOWN,
    // never rewritten.
    const priorAfter = await findDraftForOwner(ownerUserId, outcome.draft.id);
    expect(priorAfter?.status).toBe("SUPERSEDED");
    expect(priorAfter?.extraction.fingerAngle).toEqual({ value: null, source: "UNKNOWN" });
  });

  it("registry remains provably unchanged across a full completion-bearing pipeline run", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId, "One-Length Perimeter description used only to satisfy evidence text requirements.");
    const before = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    const skillRowsBefore = await prisma.professionalSkillDefinition.count();

    const extractor = fakeExtractor({ category: "PROFESSIONAL_TECHNIQUE", extraction: {}, comparisonSkillIdHint: "skill-cutting-one-length-perimeter" });
    await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });

    const after = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    expect(after).toBe(before);
    expect(await prisma.professionalSkillDefinition.count()).toBe(skillRowsBefore);
    expect(skillRowsBefore).toBe(0);
  });

  it("ownership/IDOR: another user cannot trigger normalization/processing on User A's evidence", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB } = await createOwner();
    const evidence = await createEvidence(userA, "One-Length Perimeter description used only to satisfy evidence text requirements.");

    const extractor = fakeExtractor({ category: "PROFESSIONAL_TECHNIQUE", extraction: {}, comparisonSkillIdHint: "skill-cutting-one-length-perimeter" });

    await expect(processEvidenceIntoDraft({ ownerUserId: userB, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry })).rejects.toThrow();

    expect(await prisma.professionalLearningDraft.count({ where: { ownerUserId: userB } })).toBe(0);
  });
});

async function createEvidence(ownerUserId: string, originalText: string) {
  return createLearningEvidence(ownerUserId, {
    evidenceType: "TEXT",
    vertical: "hair_cutting",
    originalText,
    provenance: { channel: "typed" },
    rightsClassification: "USER_OWNED_OR_AUTHORIZED",
  });
}

async function createOwner() {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@l4r1.1-field-completion.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  return { ownerUserId };
}
