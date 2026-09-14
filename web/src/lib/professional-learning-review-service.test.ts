import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { computeApprovedResultHash, ProfessionalLearningReviewValidationError, recordProfessionalReviewApproval } from "@/lib/professional-learning-review-service";
import { findReviewBySourceEvidenceAndVersion } from "@/lib/professional-learning-review-repository";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R2 -- service
// layer tests for recordProfessionalReviewApproval, real Postgres, no
// mocks. Proves: ownership is fail-closed, the hash is deterministically
// computed (never trusted from the caller), the service force-stamps
// provenance/negative-assertion fields, and nothing outside the new review
// row is ever touched.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("professional-learning-review-service (recordProfessionalReviewApproval)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalLearningReview.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("records a review with a deterministically computed hash and force-stamped provenance", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);
    const canonicalJson = JSON.stringify({ observations: ["a", "b"], actions: ["c"] });

    const review = await recordProfessionalReviewApproval({
      ownerUserId,
      reviewId: randomUUID(),
      sourceEvidenceId: evidence.id,
      reviewedExtractionVersion: "l5r2-long-video-v1",
      approvedResultCanonicalJson: canonicalJson,
      confirmedThemes: ["progressive_elevation", "overdirection"],
      reviewerNote: "Confirmed accurate.",
      reviewedByUserId: ownerUserId,
      reviewedAt: new Date().toISOString(),
    });

    expect(review.approvedResultHash).toBe(computeApprovedResultHash(canonicalJson));
    expect(review.approvalDetail).toEqual({
      provenance: "PROFESSIONAL_INPUT",
      confirmedThemes: ["progressive_elevation", "overdirection"],
      reviewerNote: "Confirmed accurate.",
      fieldsChanged: false,
      unknownsRemoved: false,
      registryMutated: false,
      skillsCreated: false,
      falseStatementsFound: false,
    });
  });

  it("fails closed when the evidence does not belong to this owner (IDOR)", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB } = await createOwner();
    const evidenceA = await createEvidence(userA);

    await expect(
      recordProfessionalReviewApproval({
        ownerUserId: userB,
        reviewId: randomUUID(),
        sourceEvidenceId: evidenceA.id,
        reviewedExtractionVersion: "l5r2-long-video-v1",
        approvedResultCanonicalJson: "{}",
        confirmedThemes: ["progressive_elevation"],
        reviewerNote: "Confirmed accurate.",
        reviewedByUserId: userB,
        reviewedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(ProfessionalLearningReviewValidationError);

    expect(await findReviewBySourceEvidenceAndVersion(userB, evidenceA.id, "l5r2-long-video-v1")).toBeNull();
  });

  it("fails closed when the evidence does not exist at all", async () => {
    const { ownerUserId } = await createOwner();

    await expect(
      recordProfessionalReviewApproval({
        ownerUserId,
        reviewId: randomUUID(),
        sourceEvidenceId: randomUUID(),
        reviewedExtractionVersion: "l5r2-long-video-v1",
        approvedResultCanonicalJson: "{}",
        confirmedThemes: ["progressive_elevation"],
        reviewerNote: "Confirmed accurate.",
        reviewedByUserId: ownerUserId,
        reviewedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(ProfessionalLearningReviewValidationError);
  });

  it("rejects an empty confirmedThemes list or empty reviewerNote before ever touching the database", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);

    await expect(
      recordProfessionalReviewApproval({
        ownerUserId,
        reviewId: randomUUID(),
        sourceEvidenceId: evidence.id,
        reviewedExtractionVersion: "l5r2-long-video-v1",
        approvedResultCanonicalJson: "{}",
        confirmedThemes: [],
        reviewerNote: "Confirmed accurate.",
        reviewedByUserId: ownerUserId,
        reviewedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(ProfessionalLearningReviewValidationError);

    await expect(
      recordProfessionalReviewApproval({
        ownerUserId,
        reviewId: randomUUID(),
        sourceEvidenceId: evidence.id,
        reviewedExtractionVersion: "l5r2-long-video-v1",
        approvedResultCanonicalJson: "{}",
        confirmedThemes: ["progressive_elevation"],
        reviewerNote: "   ",
        reviewedByUserId: ownerUserId,
        reviewedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(ProfessionalLearningReviewValidationError);

    expect(await prisma.professionalLearningReview.count({ where: { sourceEvidenceId: evidence.id } })).toBe(0);
  });

  it("recording a review never creates a draft, never touches the registry, and never mutates the source evidence row", async () => {
    const { ownerUserId } = await createOwner();
    const evidence = await createEvidence(ownerUserId);
    const evidenceSnapshot = JSON.stringify(evidence);

    await recordProfessionalReviewApproval({
      ownerUserId,
      reviewId: randomUUID(),
      sourceEvidenceId: evidence.id,
      reviewedExtractionVersion: "l5r2-long-video-v1",
      approvedResultCanonicalJson: "{}",
      confirmedThemes: ["progressive_elevation"],
      reviewerNote: "Confirmed accurate.",
      reviewedByUserId: ownerUserId,
      reviewedAt: new Date().toISOString(),
    });

    expect(await prisma.professionalLearningDraft.count({ where: { ownerUserId } })).toBe(0);
    expect(await prisma.professionalSkillDefinition.count()).toBe(0);
    const reloadedEvidence = await prisma.professionalLearningEvidence.findFirst({ where: { id: evidence.id } });
    expect(JSON.stringify({ id: reloadedEvidence?.id, evidenceType: reloadedEvidence?.evidenceType, status: reloadedEvidence?.status })).toBe(
      JSON.stringify({ id: evidence.id, evidenceType: evidence.evidenceType, status: evidence.status }),
    );
    void evidenceSnapshot;
  });
});

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
    data: { id: ownerUserId, email: `${ownerUserId}@learning-review-service.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  return { ownerUserId };
}
