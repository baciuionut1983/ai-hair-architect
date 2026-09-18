import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import {
  claimDraftForReanalysis,
  completeReanalysis,
  createCorrectionDraft,
  createDraft,
  findDraftBySourceEvidenceAndExtractorVersion,
  findDraftForOwner,
  listDraftsForOwner,
  ProfessionalLearningDraftStateError,
  ProfessionalLearningProceduralReviewStateError,
  recordProceduralClaimReview,
  revertFailedReanalysis,
  transitionDraftStatus,
} from "@/lib/professional-learning-draft-repository";
import type { ProceduralClaimReviewEntry } from "@/lib/professional-learning-procedural-review-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4 -- durable
// repository layer tests, real Postgres, no mocks. Mirrors
// professional-learning-evidence-repository.test.ts's own IDOR pattern
// exactly (a tracked `owners` Set cleaned up in afterEach; `findX`
// returns null cross-owner rather than throwing).
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("professional-learning-draft-repository (durable domain layer)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalLearningDraft.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("creates a draft and reads it back for its owner", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);

    const draft = await createDraft(ownerUserId, randomUUID(), input(evidence.id));
    expect(draft.status).toBe("DRAFT");
    expect(draft.sourceEvidenceId).toBe(evidence.id);

    const found = await findDraftForOwner(ownerUserId, draft.id);
    expect(found).toEqual(draft);
  });

  it("another user cannot retrieve a draft owned by User A", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB } = await createOwner();
    const evidence = await createEvidence(userA);
    const draft = await createDraft(userA, randomUUID(), input(evidence.id));

    expect(await findDraftForOwner(userA, draft.id)).not.toBeNull();
    expect(await findDraftForOwner(userB, draft.id)).toBeNull();
  });

  it("another user's listDraftsForOwner never includes User A's drafts", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB } = await createOwner();
    const evidence = await createEvidence(userA);
    await createDraft(userA, randomUUID(), input(evidence.id));

    expect(await listDraftsForOwner(userA)).toHaveLength(1);
    expect(await listDraftsForOwner(userB)).toHaveLength(0);
  });

  it("another user cannot transition a draft owned by User A -- fails closed as NOT_FOUND, never revealing the row exists", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB } = await createOwner();
    const evidence = await createEvidence(userA);
    const draft = await createDraft(userA, randomUUID(), input(evidence.id));

    await expect(transitionDraftStatus(userB, draft.id, "READY_FOR_REVIEW")).rejects.toThrow(ProfessionalLearningDraftStateError);

    const stillDraft = await findDraftForOwner(userA, draft.id);
    expect(stillDraft?.status).toBe("DRAFT");
  });

  it("another user cannot submit a correction against User A's draft (IDOR on the correction pathway)", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB } = await createOwner();
    const evidenceA = await createEvidence(userA);
    const draftA = await createDraft(userA, randomUUID(), input(evidenceA.id));
    const evidenceB = await createEvidence(userB);

    await expect(
      createCorrectionDraft(userB, randomUUID(), {
        priorDraftId: draftA.id,
        correctionEvidenceId: evidenceB.id,
        extractorVersion: draftA.extractorVersion,
        extraction: {},
        correctionNote: { previousInterpretation: {}, correction: {}, correctedByUserId: userB, correctedAt: new Date().toISOString() },
        createdByUserId: userB,
      }),
    ).rejects.toThrow(ProfessionalLearningDraftStateError);

    // No cross-owner leakage: User B gains zero drafts from the attempt.
    expect(await listDraftsForOwner(userB)).toHaveLength(0);
    expect((await findDraftForOwner(userA, draftA.id))?.status).toBe("DRAFT");
  });

  it("enforces the legal transition table at the repository layer, not just the pure validator", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);
    const draft = await createDraft(ownerUserId, randomUUID(), input(evidence.id));

    await expect(transitionDraftStatus(ownerUserId, draft.id, "APPROVED")).rejects.toThrow(ProfessionalLearningDraftStateError);

    const readyForReview = await transitionDraftStatus(ownerUserId, draft.id, "READY_FOR_REVIEW");
    expect(readyForReview.status).toBe("READY_FOR_REVIEW");

    const approved = await transitionDraftStatus(ownerUserId, draft.id, "APPROVED");
    expect(approved.status).toBe("APPROVED");

    // APPROVED never silently activates a skill -- there is no
    // registry-mutation side effect anywhere in this call.
    expect(await prisma.professionalSkillDefinition.count()).toBe(0);

    await expect(transitionDraftStatus(ownerUserId, draft.id, "READY_FOR_REVIEW")).rejects.toThrow(ProfessionalLearningDraftStateError);
  });

  it("idempotent creation: a second createDraft with the same (sourceEvidenceId, extractorVersion) returns the existing row, not a duplicate", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);

    const first = await createDraft(ownerUserId, randomUUID(), input(evidence.id));
    const second = await createDraft(ownerUserId, randomUUID(), input(evidence.id));

    expect(second.id).toBe(first.id);
    expect(await prisma.professionalLearningDraft.count({ where: { sourceEvidenceId: evidence.id } })).toBe(1);
  });

  it("findDraftBySourceEvidenceAndExtractorVersion is owner-scoped", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB } = await createOwner();
    const evidence = await createEvidence(userA);
    await createDraft(userA, randomUUID(), input(evidence.id));

    expect(await findDraftBySourceEvidenceAndExtractorVersion(userA, evidence.id, "mock-deterministic-v1")).not.toBeNull();
    expect(await findDraftBySourceEvidenceAndExtractorVersion(userB, evidence.id, "mock-deterministic-v1")).toBeNull();
  });

  // T1.2 -- TEMPORAL OBSERVATION PRESERVATION.
  it("a draft created without temporalEvidence persists/loads with it null -- existing historical draft shape remains fully compatible", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);

    const draft = await createDraft(ownerUserId, randomUUID(), input(evidence.id));

    expect(draft.temporalEvidence).toBeNull();
    const found = await findDraftForOwner(ownerUserId, draft.id);
    expect(found?.temporalEvidence).toBeNull();
  });

  it("persists and round-trips temporal evidence with provenance and ordering intact", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);
    const temporalEvidence = {
      observations: [
        { timeStartSeconds: 0, timeEndSeconds: 5, observation: "comb passes through a section of hair", source: "OBSERVED" as const },
        { timeStartSeconds: 5, timeEndSeconds: 9, observation: "scissors visibly close near the ends", source: "OBSERVED" as const },
      ],
      actions: [{ timeStartSeconds: 5, timeEndSeconds: 9, kind: "CUTTING_ACTION", source: "INFERRED" as const }],
      editGaps: [{ beforeTimeSeconds: 9, afterTimeSeconds: 40, source: "OBSERVED" as const }],
    };

    const draft = await createDraft(ownerUserId, randomUUID(), { ...input(evidence.id), temporalEvidence });

    expect(draft.temporalEvidence).toEqual(temporalEvidence);

    const found = await findDraftForOwner(ownerUserId, draft.id);
    expect(found?.temporalEvidence).toEqual(temporalEvidence);
    // Never flattened into / never overwrites the existing scalar fields.
    expect(found?.extraction).toEqual(input(evidence.id).extraction);
  });

  // T1.2.R1 -- EXPLICIT REANALYSIS SEMANTICS.
  describe("claimDraftForReanalysis / completeReanalysis / revertFailedReanalysis", () => {
    it("claims a DRAFT-status row, completes it in place (same id, same unique key), never a second row", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createEvidence(ownerUserId);
      const original = await createDraft(ownerUserId, randomUUID(), input(evidence.id));

      expect(await claimDraftForReanalysis(ownerUserId, original.id)).toBe(true);
      const claimedRow = await prisma.professionalLearningDraft.findUniqueOrThrow({ where: { id: original.id } });
      expect(claimedRow.status).toBe("REANALYZING");

      const newTemporalEvidence = { observations: [{ timeStartSeconds: 0, timeEndSeconds: 5, observation: "x", source: "OBSERVED" as const }], actions: [], editGaps: [] };
      const completed = await completeReanalysis(ownerUserId, original.id, {
        discernmentCategory: "PROFESSIONAL_VARIATION",
        comparisonOutcome: "POSSIBLE_NEW_SKILL",
        comparedSkillId: null,
        extraction: { elevation: { value: "45 degrees", source: "OBSERVED" } },
        temporalEvidence: newTemporalEvidence,
        conflictDetail: null,
      });

      expect(completed.id).toBe(original.id);
      expect(completed.status).toBe("DRAFT");
      expect(completed.discernmentCategory).toBe("PROFESSIONAL_VARIATION");
      expect(completed.extraction).toEqual({ elevation: { value: "45 degrees", source: "OBSERVED" } });
      expect(completed.temporalEvidence).toEqual(newTemporalEvidence);
      // Same row -- never a second draft for this (sourceEvidenceId, extractorVersion) pair.
      expect(await prisma.professionalLearningDraft.count({ where: { sourceEvidenceId: evidence.id } })).toBe(1);
    });

    it("a second concurrent claim attempt fails (count 0) while the first is still REANALYZING -- at most one caller ever wins", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createEvidence(ownerUserId);
      const original = await createDraft(ownerUserId, randomUUID(), input(evidence.id));

      expect(await claimDraftForReanalysis(ownerUserId, original.id)).toBe(true);
      expect(await claimDraftForReanalysis(ownerUserId, original.id)).toBe(false);
    });

    it("cannot claim a draft that has already been APPROVED -- professional authority is never silently reopened", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createEvidence(ownerUserId);
      const original = await createDraft(ownerUserId, randomUUID(), input(evidence.id));
      await transitionDraftStatus(ownerUserId, original.id, "READY_FOR_REVIEW");
      await transitionDraftStatus(ownerUserId, original.id, "APPROVED");

      expect(await claimDraftForReanalysis(ownerUserId, original.id)).toBe(false);
      const row = await prisma.professionalLearningDraft.findUniqueOrThrow({ where: { id: original.id } });
      expect(row.status).toBe("APPROVED");
    });

    it("cannot claim another owner's draft (IDOR)", async () => {
      const { ownerUserId: userA } = await createOwner();
      const userB = (await createOwner()).ownerUserId;
      const evidence = await createEvidence(userA);
      const original = await createDraft(userA, randomUUID(), input(evidence.id));

      expect(await claimDraftForReanalysis(userB, original.id)).toBe(false);
      const row = await prisma.professionalLearningDraft.findUniqueOrThrow({ where: { id: original.id } });
      expect(row.status).toBe("DRAFT");
    });

    it("revertFailedReanalysis returns a claimed draft to DRAFT, leaving the PRIOR scalar/temporal content completely untouched", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createEvidence(ownerUserId);
      const original = await createDraft(ownerUserId, randomUUID(), input(evidence.id));
      await claimDraftForReanalysis(ownerUserId, original.id);

      await revertFailedReanalysis(ownerUserId, original.id);

      const reverted = await findDraftForOwner(ownerUserId, original.id);
      expect(reverted?.status).toBe("DRAFT");
      expect(reverted?.extraction).toEqual(original.extraction);
      expect(reverted?.temporalEvidence).toBeNull();
    });

    it("a stale (>15 min old) REANALYZING claim can be re-claimed -- a crashed attempt never permanently blocks reanalysis", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createEvidence(ownerUserId);
      const original = await createDraft(ownerUserId, randomUUID(), input(evidence.id));
      await claimDraftForReanalysis(ownerUserId, original.id);

      // Simulate the claim having gone stale (a crashed/abandoned attempt)
      // by directly backdating updatedAt -- never done by any real code
      // path. Uses Prisma's own typed update (never $executeRawUnsafe):
      // a raw parameterized Date binding was empirically found to pick up
      // a timezone conversion this local Postgres server applies that
      // Prisma's own typed client does not -- claimDraftForReanalysis's
      // real `now` parameter and Prisma's own `@updatedAt` mechanism are
      // BOTH populated from the Node process's clock via the SAME typed
      // path, so this is the simulation that actually matches how the
      // real code behaves.
      const staleTimestamp = new Date(Date.now() - 20 * 60 * 1000);
      await prisma.professionalLearningDraft.update({ where: { id: original.id }, data: { updatedAt: staleTimestamp } });

      expect(await claimDraftForReanalysis(ownerUserId, original.id)).toBe(true);
    });

    it("a fresh (<15 min old) REANALYZING claim cannot be re-claimed by a second caller", async () => {
      const { ownerUserId } = await createOwner();
      const evidence = await createEvidence(ownerUserId);
      const original = await createDraft(ownerUserId, randomUUID(), input(evidence.id));
      await claimDraftForReanalysis(ownerUserId, original.id);

      expect(await claimDraftForReanalysis(ownerUserId, original.id)).toBe(false);
    });
  });

  describe("recordProceduralClaimReview (Stage 8.5T1.4.b.1)", () => {
    function confirmedEntry(overrides: Partial<ProceduralClaimReviewEntry> = {}): ProceduralClaimReviewEntry {
      return {
        claimId: "COMBING",
        claimType: "PROCEDURAL_PATTERN",
        decision: "PROFESSIONALLY_CONFIRMED",
        originalValue: { kind: "COMBING", occurrenceCount: 5 },
        originalProvenance: "INFERRED",
        reviewedByUserId: "reviewer-1",
        reviewedAt: new Date().toISOString(),
        ...overrides,
      };
    }

    async function createApprovedDraft(ownerUserId: string) {
      const evidence = await createEvidence(ownerUserId);
      const original = await createDraft(ownerUserId, randomUUID(), input(evidence.id));
      await transitionDraftStatus(ownerUserId, original.id, "READY_FOR_REVIEW");
      return transitionDraftStatus(ownerUserId, original.id, "APPROVED");
    }

    it("DRAFT/READY_FOR_REVIEW/REJECTED drafts cannot receive procedural review -- only APPROVED can", async () => {
      const { ownerUserId } = await createOwner();

      const draftEvidence = await createEvidence(ownerUserId);
      const draftDraft = await createDraft(ownerUserId, randomUUID(), input(draftEvidence.id));
      await expect(recordProceduralClaimReview(ownerUserId, draftDraft.id, { claimId: "COMBING", entry: confirmedEntry() })).rejects.toBeInstanceOf(
        ProfessionalLearningProceduralReviewStateError,
      );

      const readyEvidence = await createEvidence(ownerUserId);
      const readyDraft = await createDraft(ownerUserId, randomUUID(), input(readyEvidence.id));
      await transitionDraftStatus(ownerUserId, readyDraft.id, "READY_FOR_REVIEW");
      await expect(recordProceduralClaimReview(ownerUserId, readyDraft.id, { claimId: "COMBING", entry: confirmedEntry() })).rejects.toMatchObject({
        code: "DRAFT_NOT_APPROVED",
      });

      const rejectedEvidence = await createEvidence(ownerUserId);
      const rejectedDraft = await createDraft(ownerUserId, randomUUID(), input(rejectedEvidence.id));
      await transitionDraftStatus(ownerUserId, rejectedDraft.id, "READY_FOR_REVIEW");
      await transitionDraftStatus(ownerUserId, rejectedDraft.id, "REJECTED");
      await expect(recordProceduralClaimReview(ownerUserId, rejectedDraft.id, { claimId: "COMBING", entry: confirmedEntry() })).rejects.toMatchObject({
        code: "DRAFT_NOT_APPROVED",
      });
    });

    it("an APPROVED draft can receive procedural review, persisted and readable afterward", async () => {
      const { ownerUserId } = await createOwner();
      const approved = await createApprovedDraft(ownerUserId);
      const theEntry = confirmedEntry();

      const result = await recordProceduralClaimReview(ownerUserId, approved.id, { claimId: "COMBING", entry: theEntry });
      expect(result.proceduralReview).toEqual({ claims: { COMBING: theEntry } });

      const reloaded = await findDraftForOwner(ownerUserId, approved.id);
      expect(reloaded?.proceduralReview).toEqual({ claims: { COMBING: theEntry } });
    });

    it("PROFESSIONALLY_CORRECTED preserves the original AI-derived value alongside the professional's own correction -- never overwritten", async () => {
      const { ownerUserId } = await createOwner();
      const approved = await createApprovedDraft(ownerUserId);

      const result = await recordProceduralClaimReview(ownerUserId, approved.id, {
        claimId: "CUTTING_ACTION",
        entry: confirmedEntry({ claimId: "CUTTING_ACTION", decision: "PROFESSIONALLY_CORRECTED", correctedValue: "45 Interior", originalValue: { kind: "CUTTING_ACTION", occurrenceCount: 4 } }),
      });

      const stored = result.proceduralReview?.claims.CUTTING_ACTION;
      expect(stored?.decision).toBe("PROFESSIONALLY_CORRECTED");
      expect(stored?.correctedValue).toBe("45 Interior");
      // The original AI-derived value is NEVER rewritten into the correction.
      expect(stored?.originalValue).toEqual({ kind: "CUTTING_ACTION", occurrenceCount: 4 });
    });

    it("PROFESSIONALLY_REJECTED and PROFESSIONALLY_UNKNOWN persist as distinct decisions", async () => {
      const { ownerUserId } = await createOwner();
      const approved = await createApprovedDraft(ownerUserId);

      await recordProceduralClaimReview(ownerUserId, approved.id, { claimId: "COMBING", entry: confirmedEntry({ decision: "PROFESSIONALLY_REJECTED" }) });
      const afterReject = await recordProceduralClaimReview(ownerUserId, approved.id, {
        claimId: "CUTTING_ACTION",
        entry: confirmedEntry({ claimId: "CUTTING_ACTION", decision: "PROFESSIONALLY_UNKNOWN" }),
      });

      expect(afterReject.proceduralReview?.claims.COMBING.decision).toBe("PROFESSIONALLY_REJECTED");
      expect(afterReject.proceduralReview?.claims.CUTTING_ACTION.decision).toBe("PROFESSIONALLY_UNKNOWN");
      // UNKNOWN is never the same value as REJECTED.
      expect(afterReject.proceduralReview?.claims.CUTTING_ACTION.decision).not.toBe(afterReject.proceduralReview?.claims.COMBING.decision);
    });

    it("submitting the exact same decision twice is idempotent -- no error, no duplicate/altered content", async () => {
      const { ownerUserId } = await createOwner();
      const approved = await createApprovedDraft(ownerUserId);
      const claim = { claimId: "COMBING", entry: confirmedEntry() };

      const first = await recordProceduralClaimReview(ownerUserId, approved.id, claim);
      const second = await recordProceduralClaimReview(ownerUserId, approved.id, claim);

      expect(second.proceduralReview).toEqual(first.proceduralReview);
    });

    it("two genuinely concurrent writes to DIFFERENT claims never corrupt/lose either decision -- a lost race fails closed, never silently, and a client retry always succeeds", async () => {
      const { ownerUserId } = await createOwner();
      const approved = await createApprovedDraft(ownerUserId);

      // Real, simultaneous concurrency (not simulated) -- two real
      // overlapping calls against the same row, each for a DIFFERENT
      // claim. Whichever one loses the optimistic-concurrency race must
      // fail with the recognized CONCURRENT_MODIFICATION error and
      // nothing else (never corrupt the row, never silently vanish).
      const [combingResult, cuttingResult] = await Promise.allSettled([
        recordProceduralClaimReview(ownerUserId, approved.id, { claimId: "COMBING", entry: confirmedEntry({ decision: "PROFESSIONALLY_CONFIRMED" }) }),
        recordProceduralClaimReview(ownerUserId, approved.id, { claimId: "CUTTING_ACTION", entry: confirmedEntry({ claimId: "CUTTING_ACTION", decision: "PROFESSIONALLY_REJECTED" }) }),
      ]);

      for (const outcome of [combingResult, cuttingResult]) {
        if (outcome.status === "rejected") {
          expect(outcome.reason).toBeInstanceOf(ProfessionalLearningProceduralReviewStateError);
          expect((outcome.reason as ProfessionalLearningProceduralReviewStateError).code).toBe("CONCURRENT_MODIFICATION");
        }
      }

      // A real client retries a CONCURRENT_MODIFICATION exactly like it
      // already retries a normal "reload and try again" conflict
      // elsewhere in this codebase -- never a new mechanism.
      if (combingResult.status === "rejected") {
        await recordProceduralClaimReview(ownerUserId, approved.id, { claimId: "COMBING", entry: confirmedEntry({ decision: "PROFESSIONALLY_CONFIRMED" }) });
      }
      if (cuttingResult.status === "rejected") {
        await recordProceduralClaimReview(ownerUserId, approved.id, { claimId: "CUTTING_ACTION", entry: confirmedEntry({ claimId: "CUTTING_ACTION", decision: "PROFESSIONALLY_REJECTED" }) });
      }

      // After settling (with retry where needed), BOTH decisions exist --
      // neither was silently lost by the other's concurrent write.
      const reloaded = await findDraftForOwner(ownerUserId, approved.id);
      expect(reloaded?.proceduralReview?.claims.COMBING.decision).toBe("PROFESSIONALLY_CONFIRMED");
      expect(reloaded?.proceduralReview?.claims.CUTTING_ACTION.decision).toBe("PROFESSIONALLY_REJECTED");
    });

    it("cannot review another owner's draft (IDOR)", async () => {
      const { ownerUserId: userA } = await createOwner();
      const userB = (await createOwner()).ownerUserId;
      const approved = await createApprovedDraft(userA);

      await expect(recordProceduralClaimReview(userB, approved.id, { claimId: "COMBING", entry: confirmedEntry() })).rejects.toBeInstanceOf(ProfessionalLearningProceduralReviewStateError);
      const row = await findDraftForOwner(userA, approved.id);
      expect(row?.proceduralReview).toBeNull();
    });

    it("procedural review never mutates the original extraction/temporalEvidence -- Layer 1/2 stay exactly as they were", async () => {
      const { ownerUserId } = await createOwner();
      const approved = await createApprovedDraft(ownerUserId);
      const beforeExtraction = approved.extraction;
      const beforeTemporalEvidence = approved.temporalEvidence;

      const result = await recordProceduralClaimReview(ownerUserId, approved.id, { claimId: "COMBING", entry: confirmedEntry() });

      expect(result.extraction).toEqual(beforeExtraction);
      expect(result.temporalEvidence).toEqual(beforeTemporalEvidence);
    });

    it("an APPROVED draft that has received procedural review remains permanently protected from reanalysis", async () => {
      const { ownerUserId } = await createOwner();
      const approved = await createApprovedDraft(ownerUserId);
      await recordProceduralClaimReview(ownerUserId, approved.id, { claimId: "COMBING", entry: confirmedEntry() });

      expect(await claimDraftForReanalysis(ownerUserId, approved.id)).toBe(false);
      const row = await prisma.professionalLearningDraft.findUniqueOrThrow({ where: { id: approved.id } });
      expect(row.status).toBe("APPROVED");
    });
  });
});

function input(sourceEvidenceId: string) {
  return {
    sourceEvidenceId,
    extractorVersion: "mock-deterministic-v1",
    discernmentCategory: "PROFESSIONAL_TECHNIQUE" as const,
    comparisonOutcome: "EVIDENCE_FOR_EXISTING" as const,
    comparedSkillId: "skill-cutting-one-length-perimeter",
    extraction: { elevation: { value: "0 degrees", source: "OBSERVED" as const } },
    conflictDetail: null,
    createdByUserId: sourceEvidenceId,
  };
}

async function createEvidence(ownerUserId: string) {
  return createLearningEvidence(ownerUserId, {
    evidenceType: "TEXT",
    vertical: "hair_cutting",
    originalText: "A professional teaching note.",
    provenance: { channel: "typed" },
    rightsClassification: "USER_OWNED_OR_AUTHORIZED",
  });
}

async function createOwner() {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@learning-draft-repository.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  return { ownerUserId };
}
