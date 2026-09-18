import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { createDraft, transitionDraftStatus } from "@/lib/professional-learning-draft-repository";
import { ProfessionalLearningProceduralReviewServiceError, submitProceduralClaimReview } from "@/lib/professional-learning-procedural-review-service";
import type { ProfessionalLearningTemporalEvidence } from "@/lib/professional-learning-video-temporal-evidence";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.4.b.1 --
// service-layer tests, real Postgres, no mocks, ZERO real Gemini calls
// (this entire file never constructs or imports any extractor/provider
// client at all).
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

const REAL_SHAPED_TEMPORAL_EVIDENCE: ProfessionalLearningTemporalEvidence = {
  observations: [],
  actions: [
    { timeStartSeconds: 0, timeEndSeconds: 6, kind: "COMBING", source: "INFERRED" },
    { timeStartSeconds: 7, timeEndSeconds: 14, kind: "CUTTING_ACTION", source: "INFERRED" },
    { timeStartSeconds: 15, timeEndSeconds: 20, kind: "COMBING", source: "INFERRED" },
    { timeStartSeconds: 21, timeEndSeconds: 27, kind: "CUTTING_ACTION", source: "INFERRED" },
  ],
  editGaps: [],
  sourceDurationSeconds: 30,
};

suite("submitProceduralClaimReview (Stage 8.5T1.4.b.1)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalLearningDraft.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("CONFIRM/CORRECT/REJECT/UNKNOWN all persist end-to-end against a real APPROVED draft", async () => {
    const { ownerUserId } = await createOwner();
    const approved = await createApprovedDraftWithTemporalEvidence(ownerUserId);

    const confirmed = await submitProceduralClaimReview({ expectedProceduralReviewRevision: 0, ownerUserId, draftId: approved.id, claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED", reviewedByUserId: ownerUserId });
    expect(confirmed.proceduralReview?.claims.COMBING.decision).toBe("PROFESSIONALLY_CONFIRMED");
    expect(confirmed.proceduralReview?.claims.COMBING.originalValue).toEqual({ kind: "COMBING", occurrenceCount: 2 });

    const corrected = await submitProceduralClaimReview({ expectedProceduralReviewRevision: confirmed.proceduralReviewRevision,
      ownerUserId,
      draftId: approved.id,
      claimId: "CUTTING_ACTION",
      decision: "PROFESSIONALLY_CORRECTED",
      correctedValue: "45 Interior",
      reviewedByUserId: ownerUserId,
    });
    expect(corrected.proceduralReview?.claims.CUTTING_ACTION.decision).toBe("PROFESSIONALLY_CORRECTED");
    expect(corrected.proceduralReview?.claims.CUTTING_ACTION.correctedValue).toBe("45 Interior");
    // The AI's own original value survives, uncorrupted, alongside the correction.
    expect(corrected.proceduralReview?.claims.CUTTING_ACTION.originalValue).toEqual({ kind: "CUTTING_ACTION", occurrenceCount: 2 });
  });

  it("PROFESSIONALLY_CORRECTED without a non-empty correctedValue is rejected before any write", async () => {
    const { ownerUserId } = await createOwner();
    const approved = await createApprovedDraftWithTemporalEvidence(ownerUserId);

    await expect(
      submitProceduralClaimReview({ expectedProceduralReviewRevision: 0, ownerUserId, draftId: approved.id, claimId: "COMBING", decision: "PROFESSIONALLY_CORRECTED", reviewedByUserId: ownerUserId }),
    ).rejects.toMatchObject({ code: "MISSING_CORRECTED_VALUE" });

    const row = await prisma.professionalLearningDraft.findUniqueOrThrow({ where: { id: approved.id } });
    expect(row.proceduralReview).toBeNull();
  });

  it("an unrecognized decision string is rejected", async () => {
    const { ownerUserId } = await createOwner();
    const approved = await createApprovedDraftWithTemporalEvidence(ownerUserId);

    await expect(
      submitProceduralClaimReview({ expectedProceduralReviewRevision: 0, ownerUserId, draftId: approved.id, claimId: "COMBING", decision: "MADE_UP_DECISION", reviewedByUserId: ownerUserId }),
    ).rejects.toMatchObject({ code: "INVALID_DECISION" });
  });

  it("an arbitrary/invented claimId that does not exist in the current procedural interpretation is rejected -- a client cannot attach authority to a claim it invented", async () => {
    const { ownerUserId } = await createOwner();
    const approved = await createApprovedDraftWithTemporalEvidence(ownerUserId);

    await expect(
      submitProceduralClaimReview({ expectedProceduralReviewRevision: 0, ownerUserId, draftId: approved.id, claimId: "FABRICATED_CLAIM_ID", decision: "PROFESSIONALLY_CONFIRMED", reviewedByUserId: ownerUserId }),
    ).rejects.toMatchObject({ code: "PROCEDURAL_CLAIM_NOT_FOUND" });
  });

  it("a draft with no temporal evidence at all has no reviewable claims -- every claimId is rejected", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);
    const draft = await createDraft(ownerUserId, randomUUID(), draftInput(evidence.id));
    await transitionDraftStatus(ownerUserId, draft.id, "READY_FOR_REVIEW");
    const approved = await transitionDraftStatus(ownerUserId, draft.id, "APPROVED");

    await expect(
      submitProceduralClaimReview({ expectedProceduralReviewRevision: 0, ownerUserId, draftId: approved.id, claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED", reviewedByUserId: ownerUserId }),
    ).rejects.toMatchObject({ code: "PROCEDURAL_CLAIM_NOT_FOUND" });
  });

  it("a nonexistent draft is rejected", async () => {
    const { ownerUserId } = await createOwner();
    await expect(
      submitProceduralClaimReview({ expectedProceduralReviewRevision: 0, ownerUserId, draftId: randomUUID(), claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED", reviewedByUserId: ownerUserId }),
    ).rejects.toMatchObject({ code: "DRAFT_NOT_FOUND" });
  });

  it("a DRAFT-status (not yet approved) draft is rejected", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);
    const draft = await createDraft(ownerUserId, randomUUID(), { ...draftInput(evidence.id), temporalEvidence: REAL_SHAPED_TEMPORAL_EVIDENCE });

    await expect(
      submitProceduralClaimReview({ expectedProceduralReviewRevision: 0, ownerUserId, draftId: draft.id, claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED", reviewedByUserId: ownerUserId }),
    ).rejects.toMatchObject({ code: "DRAFT_NOT_APPROVED" });
  });

  it("cannot review another owner's draft (IDOR) -- indistinguishable from not found", async () => {
    const { ownerUserId: userA } = await createOwner();
    const userB = (await createOwner()).ownerUserId;
    const approved = await createApprovedDraftWithTemporalEvidence(userA);

    await expect(
      submitProceduralClaimReview({ expectedProceduralReviewRevision: 0, ownerUserId: userB, draftId: approved.id, claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED", reviewedByUserId: userB }),
    ).rejects.toMatchObject({ code: "DRAFT_NOT_FOUND" });
  });

  it("errors thrown by this service are always ProfessionalLearningProceduralReviewServiceError instances with a recognized httpStatus", async () => {
    const { ownerUserId } = await createOwner();
    try {
      await submitProceduralClaimReview({ expectedProceduralReviewRevision: 0, ownerUserId, draftId: randomUUID(), claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED", reviewedByUserId: ownerUserId });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ProfessionalLearningProceduralReviewServiceError);
      expect((error as ProfessionalLearningProceduralReviewServiceError).httpStatus).toBe(404);
    }
  });
});

function draftInput(sourceEvidenceId: string) {
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

async function createApprovedDraftWithTemporalEvidence(ownerUserId: string) {
  const evidence = await createEvidence(ownerUserId);
  const draft = await createDraft(ownerUserId, randomUUID(), { ...draftInput(evidence.id), temporalEvidence: REAL_SHAPED_TEMPORAL_EVIDENCE });
  await transitionDraftStatus(ownerUserId, draft.id, "READY_FOR_REVIEW");
  return transitionDraftStatus(ownerUserId, draft.id, "APPROVED");
}

async function createEvidence(ownerUserId: string) {
  return createLearningEvidence(ownerUserId, {
    evidenceType: "TEXT",
    vertical: "hair_cutting",
    originalText: "Vertical section cutting demonstration.",
    provenance: { channel: "typed" },
    rightsClassification: "USER_OWNED_OR_AUTHORIZED",
  });
}

async function createOwner() {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@procedural-review-service.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  return { ownerUserId };
}
