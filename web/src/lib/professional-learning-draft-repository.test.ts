import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import {
  createCorrectionDraft,
  createDraft,
  findDraftBySourceEvidenceAndExtractorVersion,
  findDraftForOwner,
  listDraftsForOwner,
  ProfessionalLearningDraftStateError,
  transitionDraftStatus,
} from "@/lib/professional-learning-draft-repository";

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
