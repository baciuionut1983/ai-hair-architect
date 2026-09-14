import { describe, expect, it } from "vitest";

import { verifyApprovedKnowledgeSource, type EvidenceForEligibilityCheck, type ReviewForEligibilityCheck } from "@/lib/professional-knowledge-approved-source";
import { planLongVideoWindows } from "@/lib/professional-learning-video-long-window-planner";
import { reconcileLongVideoWindows } from "@/lib/professional-learning-video-cross-window-reconciliation";
import { buildProceduralCandidate } from "@/lib/professional-learning-video-procedural-candidate";
import { computeApprovedResultHash } from "@/lib/professional-learning-review-service";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3 -- pure
// authority-gate tests, no I/O, no database, no AI calls. Uses a small
// synthetic 2-window plan and a minimal fake extractor output so the
// whole hash-recompute chain is exercised deterministically without
// depending on the real L5.R2 fixture.

function fakeRawOutput(): ProfessionalLearningExtractorOutput {
  return {
    discernment: { category: "PROFESSIONAL_TECHNIQUE", reason: "test" },
    extraction: { techniqueCandidate: { value: "test technique", source: "INFERRED" } },
    comparisonSkillIdHint: null,
    relatedSkillIdHints: [],
  };
}

function buildPlan() {
  return planLongVideoWindows({ sourceEvidenceId: "ev-1", totalDurationSeconds: 60, windowCount: 2, contextMarginSeconds: 5, segmentationVersion: "test-v1" });
}

function computeRealHash() {
  const plan = buildPlan();
  const rawByWindowId = new Map(plan.windows.map((w) => [w.id, fakeRawOutput()]));
  const reconciliation = reconcileLongVideoWindows(plan.sourceEvidenceId, plan.windows, rawByWindowId, plan.segmentationVersion);
  const proceduralCandidate = buildProceduralCandidate({
    actionCandidates: reconciliation.actionCandidates,
    segments: reconciliation.segments,
    editGaps: reconciliation.editGaps,
    resultObservationPresent: false,
    validationCandidatePresent: false,
  });
  return computeApprovedResultHash(JSON.stringify({ reconciliation, proceduralCandidate }));
}

function baseEvidence(): EvidenceForEligibilityCheck {
  return { id: "ev-1", ownerUserId: "owner-1", status: "ACTIVE" };
}

function baseReview(hash: string): ReviewForEligibilityCheck {
  return { id: "review-1", ownerUserId: "owner-1", sourceEvidenceId: "ev-1", reviewedExtractionVersion: "test-v1", approvedResultHash: hash, status: "PROFESSIONALLY_VALIDATED" };
}

describe("professional-knowledge-approved-source (authority gate)", () => {
  it("Section 3-4: ELIGIBLE when hash matches, review validated, owner matches, evidence ACTIVE", () => {
    const plan = buildPlan();
    const rawByWindowId = new Map(plan.windows.map((w) => [w.id, fakeRawOutput()]));
    const hash = computeRealHash();

    const result = verifyApprovedKnowledgeSource({
      requestingOwnerUserId: "owner-1",
      evidence: baseEvidence(),
      review: baseReview(hash),
      windowPlan: plan,
      rawResultsByWindowId: rawByWindowId,
    });

    expect(result.eligibility).toBe("ELIGIBLE");
    expect(result.recomputedHash).toBe(hash);
    expect(result.source).not.toBeNull();
    expect(result.source?.approvedResultHash).toBe(hash);
  });

  it("Section 4: STOP condition -- recomputed hash mismatch is detected, never silently accepted", () => {
    const plan = buildPlan();
    const rawByWindowId = new Map(plan.windows.map((w) => [w.id, fakeRawOutput()]));

    const result = verifyApprovedKnowledgeSource({
      requestingOwnerUserId: "owner-1",
      evidence: baseEvidence(),
      review: baseReview("0".repeat(64)), // deliberately wrong stored hash
      windowPlan: plan,
      rawResultsByWindowId: rawByWindowId,
    });

    expect(result.eligibility).toBe("HASH_MISMATCH");
    expect(result.source).toBeNull();
    expect(result.recomputedHash).not.toBe("0".repeat(64));
  });

  it("Section 5: rejects a review that is not PROFESSIONALLY_VALIDATED (pending/rejected/superseded)", () => {
    const plan = buildPlan();
    const rawByWindowId = new Map(plan.windows.map((w) => [w.id, fakeRawOutput()]));
    const hash = computeRealHash();

    for (const status of ["PENDING", "REJECTED", "SUPERSEDED"]) {
      const result = verifyApprovedKnowledgeSource({
        requestingOwnerUserId: "owner-1",
        evidence: baseEvidence(),
        review: { ...baseReview(hash), status },
        windowPlan: plan,
        rawResultsByWindowId: rawByWindowId,
      });
      expect(result.eligibility).toBe("REVIEW_NOT_VALIDATED");
      expect(result.source).toBeNull();
    }
  });

  it("Section 5: rejects a review for a different extraction version", () => {
    const plan = buildPlan();
    const rawByWindowId = new Map(plan.windows.map((w) => [w.id, fakeRawOutput()]));
    const hash = computeRealHash();

    const result = verifyApprovedKnowledgeSource({
      requestingOwnerUserId: "owner-1",
      evidence: baseEvidence(),
      review: { ...baseReview(hash), reviewedExtractionVersion: "different-version" },
      windowPlan: plan,
      rawResultsByWindowId: rawByWindowId,
    });
    expect(result.eligibility).toBe("WRONG_EXTRACTION_VERSION");
  });

  it("Section 5/17: rejects a review belonging to another owner (IDOR)", () => {
    const plan = buildPlan();
    const rawByWindowId = new Map(plan.windows.map((w) => [w.id, fakeRawOutput()]));
    const hash = computeRealHash();

    const result = verifyApprovedKnowledgeSource({
      requestingOwnerUserId: "owner-2",
      evidence: baseEvidence(),
      review: baseReview(hash),
      windowPlan: plan,
      rawResultsByWindowId: rawByWindowId,
    });
    expect(result.eligibility).toBe("OWNER_MISMATCH");
    expect(result.source).toBeNull();
  });

  it("Section 74: rejects REVOKED or DELETED_SOURCE evidence -- historical review remains valid but source is not currently usable", () => {
    const plan = buildPlan();
    const rawByWindowId = new Map(plan.windows.map((w) => [w.id, fakeRawOutput()]));
    const hash = computeRealHash();

    for (const status of ["REVOKED", "DELETED_SOURCE"]) {
      const result = verifyApprovedKnowledgeSource({
        requestingOwnerUserId: "owner-1",
        evidence: { ...baseEvidence(), status },
        review: baseReview(hash),
        windowPlan: plan,
        rawResultsByWindowId: rawByWindowId,
      });
      expect(result.eligibility).toBe("EVIDENCE_INELIGIBLE");
      expect(result.source).toBeNull();
    }
  });
});
