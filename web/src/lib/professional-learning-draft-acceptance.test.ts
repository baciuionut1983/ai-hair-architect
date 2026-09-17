import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createLearningEvidence, revokeLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { processEvidenceIntoDraft, submitProfessionalCorrection } from "@/lib/professional-learning-draft-service";
import { mockProfessionalLearningExtractor } from "@/lib/professional-learning-mock-extractor";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { findDraftForOwner, transitionDraftStatus } from "@/lib/professional-learning-draft-repository";
import type { ProfessionalLearningExtractor, ProfessionalLearningExtractorInput, ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

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

  // T1.2.R1 -- EXPLICIT REANALYSIS SEMANTICS.
  describe("explicit reanalysis (mode: REANALYZE)", () => {
    it("reaches the extractor exactly once, reuses the SAME draft id, and returns kind='reanalyzed' -- never a second row", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createLearningEvidence(ownerUserId, textInput("Graduated cutting reanalysis-test example with sectioning and elevation."));
      const extractor = countingExtractor(mockProfessionalLearningExtractor);

      const first = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });
      if (first.kind !== "created") throw new Error("expected created");
      expect(extractor.callCount).toBe(1);

      const second = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry, mode: "REANALYZE" });

      expect(second.kind).toBe("reanalyzed");
      if (second.kind !== "reanalyzed") throw new Error("expected reanalyzed");
      expect(second.draft.id).toBe(first.draft.id);
      expect(extractor.callCount).toBe(2);
      // Never a second row for this (evidence, extractorVersion) pair --
      // the schema's own unique constraint is never bypassed.
      expect(await prisma.professionalLearningDraft.count({ where: { sourceEvidenceId: evidence.id } })).toBe(1);
      // Never required reuploading evidence or deleting it.
      expect(await prisma.professionalLearningEvidence.count({ where: { id: evidence.id } })).toBe(1);
    });

    it("REANALYZE with no existing draft behaves exactly like a first ANALYZE (no special-casing, no error)", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createLearningEvidence(ownerUserId, textInput("Graduated cutting example, reanalyze-with-nothing-yet."));

      const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry, mode: "REANALYZE" });

      expect(outcome.kind).toBe("created");
    });

    it("a normal ANALYZE request against existing evidence still reuses the cached draft -- REANALYZE did not weaken the existing idempotent default", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createLearningEvidence(ownerUserId, textInput("Graduated cutting example, normal-analyze-still-idempotent."));
      const extractor = countingExtractor(mockProfessionalLearningExtractor);

      await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });
      const second = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry }); // mode omitted -- defaults to ANALYZE

      expect(second.kind).toBe("already_processed");
      expect(extractor.callCount).toBe(1);
    });

    it("cannot reanalyze a draft that has already been professionally APPROVED -- fails closed, approved content is completely unchanged", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createLearningEvidence(ownerUserId, textInput("Graduated cutting example for approved-reanalysis-safety."));
      const created = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry });
      if (created.kind !== "created") throw new Error("expected created");
      await transitionDraftStatus(ownerUserId, created.draft.id, "READY_FOR_REVIEW");
      const approved = await transitionDraftStatus(ownerUserId, created.draft.id, "APPROVED");

      await expect(
        processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry, mode: "REANALYZE" }),
      ).rejects.toMatchObject({ code: "DRAFT_NOT_REANALYZABLE" });

      const stillApproved = await findDraftForOwner(ownerUserId, created.draft.id);
      expect(stillApproved).toEqual(approved);
    });

    it("two concurrent explicit reanalysis attempts: exactly one reaches the extractor, the other fails closed with DRAFT_REANALYSIS_IN_PROGRESS -- never two provider calls for one action", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createLearningEvidence(ownerUserId, textInput("Graduated cutting example for concurrency-safety."));
      const created = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry });
      if (created.kind !== "created") throw new Error("expected created");

      const gate = deferredGateExtractor(mockProfessionalLearningExtractor);
      const attempt1 = processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: gate.extractor, registry, mode: "REANALYZE" });
      await gate.waitUntilEntered();
      // The second attempt is issued while the first is still holding the
      // claim (blocked inside its own extract() call, not yet resolved).
      const attempt2Result = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry, mode: "REANALYZE" }).catch(
        (error: unknown) => error,
      );
      gate.release();
      const attempt1Result = await attempt1;

      expect(attempt1Result.kind).toBe("reanalyzed");
      expect(attempt2Result).toMatchObject({ code: "DRAFT_REANALYSIS_IN_PROGRESS" });
      expect(gate.callCount).toBe(1);
    });

    it("provider failure during REANALYZE is fail-honest: throws, never a false success, and the PRIOR valid content is left completely untouched", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createLearningEvidence(ownerUserId, textInput("Graduated cutting example for reanalysis-failure-safety."));
      const created = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry });
      if (created.kind !== "created") throw new Error("expected created");

      const failingExtractor: ProfessionalLearningExtractor = {
        extractorVersion: mockProfessionalLearningExtractor.extractorVersion,
        async extract() {
          throw Object.assign(new Error("simulated provider failure"), { code: "PROVIDER_ERROR", retryable: true });
        },
      };

      await expect(
        processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: failingExtractor, registry, mode: "REANALYZE" }),
      ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });

      // The draft is never left stuck in REANALYZING, and the prior,
      // still-valid content is completely unchanged -- never presented
      // as if a fresh reanalysis had succeeded.
      const reverted = await findDraftForOwner(ownerUserId, created.draft.id);
      expect(reverted?.status).toBe("DRAFT");
      expect(reverted?.extraction).toEqual(created.draft.extraction);

      // A subsequent, genuine retry is still possible.
      const retried = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry, mode: "REANALYZE" });
      expect(retried.kind).toBe("reanalyzed");

      // No Professional Knowledge activation occurred at any point.
      expect(await prisma.professionalSkillDefinition.count()).toBe(0);
    });

    it("REANALYZE on non-ACTIVE (revoked) evidence is skipped, never reaching the extractor", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createLearningEvidence(ownerUserId, textInput("Graduated cutting example for revoked-reanalysis-safety."));
      const created = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: mockProfessionalLearningExtractor, registry });
      if (created.kind !== "created") throw new Error("expected created");
      await revokeLearningEvidence(ownerUserId, evidence.id);

      const extractor = countingExtractor(mockProfessionalLearningExtractor);
      const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry, mode: "REANALYZE" });

      expect(outcome).toEqual({ kind: "skipped", reason: "EVIDENCE_NOT_ACTIVE" });
      expect(extractor.callCount).toBe(0);
    });

    it("a caller-supplied mode is never trusted as a generic provider-call bypass -- only the literal string 'REANALYZE' has any effect", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createLearningEvidence(ownerUserId, textInput("Graduated cutting example for mode-bypass-safety."));
      const extractor = countingExtractor(mockProfessionalLearningExtractor);

      const first = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });
      if (first.kind !== "created") throw new Error("expected created");

      // @ts-expect-error -- deliberately an invalid mode value, exactly
      // what a malformed/malicious request body could produce.
      const second = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry, mode: "force" });

      expect(second.kind).toBe("already_processed");
      expect(extractor.callCount).toBe(1);
    });
  });
});

// T1.2.R1 test helper -- wraps a real ProfessionalLearningExtractor to
// count real extract() invocations, without altering its behavior at
// all. Never a mocking library; a hand-built delegate, matching this
// file's own established convention.
function countingExtractor(delegate: ProfessionalLearningExtractor): ProfessionalLearningExtractor & { callCount: number } {
  const wrapped = {
    extractorVersion: delegate.extractorVersion,
    callCount: 0,
    async extract(input: ProfessionalLearningExtractorInput): Promise<ProfessionalLearningExtractorOutput> {
      wrapped.callCount += 1;
      return delegate.extract(input);
    },
  };
  return wrapped;
}

// T1.2.R1 test helper -- wraps a real extractor so its extract() call
// blocks until the test explicitly releases it, letting a test
// deterministically interleave two concurrent processEvidenceIntoDraft
// calls around the exact moment the first one is mid-extraction (i.e.
// already holding the REANALYZING claim).
function deferredGateExtractor(delegate: ProfessionalLearningExtractor): {
  extractor: ProfessionalLearningExtractor;
  waitUntilEntered: () => Promise<void>;
  release: () => void;
  callCount: number;
} {
  let entered = false;
  let resolveEntered: () => void;
  const enteredPromise = new Promise<void>((resolve) => (resolveEntered = resolve));
  let release: () => void = () => undefined;
  const state = { callCount: 0 };

  const extractor: ProfessionalLearningExtractor = {
    extractorVersion: delegate.extractorVersion,
    async extract(input) {
      state.callCount += 1;
      entered = true;
      resolveEntered();
      await new Promise<void>((resolve) => (release = resolve));
      return delegate.extract(input);
    },
  };

  return {
    extractor,
    waitUntilEntered: () => (entered ? Promise.resolve() : enteredPromise),
    release: () => release(),
    get callCount() {
      return state.callCount;
    },
  };
}

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
