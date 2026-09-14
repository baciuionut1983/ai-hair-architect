import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import {
  createReview,
  findReviewBySourceEvidenceAndVersion,
  findReviewForOwner,
  listReviewsForOwner,
} from "@/lib/professional-learning-review-repository";
import type { ProfessionalLearningReviewApprovalDetail } from "@/lib/professional-learning-review-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R2 -- durable
// repository layer tests for ProfessionalLearningReview, real Postgres, no
// mocks. Mirrors professional-learning-draft-repository.test.ts's own IDOR
// pattern exactly (a tracked `owners` Set cleaned up in afterEach; `findX`
// returns null cross-owner rather than throwing).
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("professional-learning-review-repository (durable domain layer)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalLearningReview.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("creates a review and reads it back for its owner", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);

    const review = await createReview(ownerUserId, randomUUID(), input(evidence.id, ownerUserId));
    expect(review.status).toBe("PROFESSIONALLY_VALIDATED");
    expect(review.sourceEvidenceId).toBe(evidence.id);
    expect(review.approvalDetail.provenance).toBe("PROFESSIONAL_INPUT");

    const found = await findReviewForOwner(ownerUserId, review.id);
    expect(found).toEqual(review);
  });

  it("another user cannot retrieve a review owned by User A (fails closed, indistinguishable from not-found)", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB } = await createOwner();
    const evidence = await createEvidence(userA);
    const review = await createReview(userA, randomUUID(), input(evidence.id, userA));

    expect(await findReviewForOwner(userA, review.id)).not.toBeNull();
    expect(await findReviewForOwner(userB, review.id)).toBeNull();
  });

  it("another user's listReviewsForOwner never includes User A's reviews", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB } = await createOwner();
    const evidence = await createEvidence(userA);
    await createReview(userA, randomUUID(), input(evidence.id, userA));

    expect(await listReviewsForOwner(userA)).toHaveLength(1);
    expect(await listReviewsForOwner(userB)).toHaveLength(0);
  });

  it("idempotent creation: a second createReview with the same (sourceEvidenceId, reviewedExtractionVersion) returns the existing row, not a duplicate", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);

    const first = await createReview(ownerUserId, randomUUID(), input(evidence.id, ownerUserId));
    const second = await createReview(ownerUserId, randomUUID(), input(evidence.id, ownerUserId));

    expect(second.id).toBe(first.id);
    expect(await prisma.professionalLearningReview.count({ where: { sourceEvidenceId: evidence.id } })).toBe(1);
  });

  it("a review for a different reviewedExtractionVersion on the same evidence is a genuinely separate row (never overwrites the prior review)", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);

    const v1 = await createReview(ownerUserId, randomUUID(), input(evidence.id, ownerUserId));
    const v2 = await createReview(ownerUserId, randomUUID(), { ...input(evidence.id, ownerUserId), reviewedExtractionVersion: "l5r2-long-video-v2" });

    expect(v2.id).not.toBe(v1.id);
    expect(await prisma.professionalLearningReview.count({ where: { sourceEvidenceId: evidence.id } })).toBe(2);
    // The prior review row is byte-for-byte unchanged by the second creation.
    expect((await findReviewForOwner(ownerUserId, v1.id))?.approvalDetail).toEqual(v1.approvalDetail);
  });

  it("findReviewBySourceEvidenceAndVersion is owner-scoped and version-scoped", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB } = await createOwner();
    const evidence = await createEvidence(userA);
    await createReview(userA, randomUUID(), input(evidence.id, userA));

    expect(await findReviewBySourceEvidenceAndVersion(userA, evidence.id, "l5r2-long-video-v1")).not.toBeNull();
    expect(await findReviewBySourceEvidenceAndVersion(userB, evidence.id, "l5r2-long-video-v1")).toBeNull();
    expect(await findReviewBySourceEvidenceAndVersion(userA, evidence.id, "some-other-version")).toBeNull();
  });

  it("creating a review never creates or mutates a draft or a registry row", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);

    await createReview(ownerUserId, randomUUID(), input(evidence.id, ownerUserId));

    expect(await prisma.professionalLearningDraft.count({ where: { ownerUserId } })).toBe(0);
    expect(await prisma.professionalSkillDefinition.count()).toBe(0);
  });
});

function approvalDetail(): ProfessionalLearningReviewApprovalDetail {
  return {
    provenance: "PROFESSIONAL_INPUT",
    confirmedThemes: ["progressive_elevation", "stationary_guide"],
    reviewerNote: "Confirmed accurate against the source video.",
    fieldsChanged: false,
    unknownsRemoved: false,
    registryMutated: false,
    skillsCreated: false,
    falseStatementsFound: false,
  };
}

function input(sourceEvidenceId: string, reviewedByUserId: string) {
  return {
    sourceEvidenceId,
    reviewedExtractionVersion: "l5r2-long-video-v1",
    approvedResultHash: "a".repeat(64),
    approvalDetail: approvalDetail(),
    reviewedByUserId,
    reviewedAt: new Date().toISOString(),
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
    data: { id: ownerUserId, email: `${ownerUserId}@learning-review-repository.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  return { ownerUserId };
}
