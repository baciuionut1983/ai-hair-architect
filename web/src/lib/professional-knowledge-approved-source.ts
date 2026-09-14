import type { AnalysisWindow, LongVideoWindowPlan } from "@/lib/professional-learning-video-long-window-planner";
import { reconcileLongVideoWindows, type LongVideoReconciliation } from "@/lib/professional-learning-video-cross-window-reconciliation";
import { buildProceduralCandidate, type ProceduralCandidate } from "@/lib/professional-learning-video-procedural-candidate";
import { computeApprovedResultHash } from "@/lib/professional-learning-review-service";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3 -- APPROVED
// KNOWLEDGE SOURCE + AUTHORITY GATE. Pure, no I/O, no database, ZERO AI
// calls. This module does NOT touch Prisma directly -- a caller (the real
// acceptance test) supplies already-fetched evidence/review rows and the
// already-captured fixture, keeping this file trivially unit-testable and
// reusable outside any one DB shape.
//
// THE AUTHORITY CHAIN THIS FILE ENFORCES (Section 3-6):
//   ProfessionalLearningEvidence (ACTIVE, owner-matched)
//   + ProfessionalLearningReview (PROFESSIONALLY_VALIDATED, owner-matched,
//     same sourceEvidenceId, same reviewedExtractionVersion)
//   + a RECOMPUTED approvedResultHash that matches the review's stored
//     hash EXACTLY (never trusted from the DB alone -- recomputed here,
//     deterministically, from the same frozen fixture/window plan the
//     original extraction used).
// Any mismatch on any of these fails closed -- no ApprovedKnowledgeSource
// is ever produced from ineligible input, and no downstream assimilation
// code ever sees a source it did not itself verify.
//
// EVIDENCE != APPROVED SOURCE: an ApprovedKnowledgeSource is intentionally
// NOT itself an active skill or draft -- it is eligible EVIDENCE for
// knowledge assimilation only (Section 9).

export const APPROVED_SOURCE_ELIGIBILITIES = [
  "ELIGIBLE",
  "HASH_MISMATCH",
  "REVIEW_NOT_VALIDATED",
  "WRONG_EXTRACTION_VERSION",
  "OWNER_MISMATCH",
  "EVIDENCE_INELIGIBLE",
] as const;
export type ApprovedSourceEligibility = (typeof APPROVED_SOURCE_ELIGIBILITIES)[number];

export interface ApprovedKnowledgeSource {
  readonly sourceEvidenceId: string;
  readonly ownerUserId: string;
  readonly extractionVersion: string;
  readonly approvedResultHash: string;
  readonly reviewId: string;
  readonly reviewStatus: string;
  readonly windows: readonly AnalysisWindow[];
  readonly reconciliation: LongVideoReconciliation;
  readonly proceduralCandidate: ProceduralCandidate;
  // Raw per-window provider output, preserved for descriptive labeling
  // ONLY (never used as matching/identity authority downstream -- see
  // professional-knowledge-unit.ts's own `label` field doc).
  readonly rawResultsByWindowId: ReadonlyMap<string, ProfessionalLearningExtractorOutput>;
}

export interface EvidenceForEligibilityCheck {
  readonly id: string;
  readonly ownerUserId: string;
  // Application-level ProfessionalLearningEvidence status string
  // (ACTIVE | REVOKED | DELETED_SOURCE).
  readonly status: string;
}

export interface ReviewForEligibilityCheck {
  readonly id: string;
  readonly ownerUserId: string;
  readonly sourceEvidenceId: string;
  readonly reviewedExtractionVersion: string;
  readonly approvedResultHash: string;
  readonly status: string;
}

export interface VerifyApprovedKnowledgeSourceInput {
  readonly requestingOwnerUserId: string;
  readonly evidence: EvidenceForEligibilityCheck;
  readonly review: ReviewForEligibilityCheck;
  readonly windowPlan: LongVideoWindowPlan;
  readonly rawResultsByWindowId: ReadonlyMap<string, ProfessionalLearningExtractorOutput>;
}

export interface VerifyApprovedKnowledgeSourceResult {
  readonly eligibility: ApprovedSourceEligibility;
  readonly reason: string;
  readonly recomputedHash: string | null;
  readonly source: ApprovedKnowledgeSource | null;
}

export function verifyApprovedKnowledgeSource(input: VerifyApprovedKnowledgeSourceInput): VerifyApprovedKnowledgeSourceResult {
  const { requestingOwnerUserId, evidence, review, windowPlan, rawResultsByWindowId } = input;

  // Owner isolation first, fail-closed (Section 17 of the prior stage's
  // own review-authority discipline, reused here): a review or evidence
  // row that belongs to a different owner is never eligible, regardless
  // of any other field.
  if (evidence.ownerUserId !== requestingOwnerUserId || review.ownerUserId !== requestingOwnerUserId) {
    return { eligibility: "OWNER_MISMATCH", reason: "Evidence or review does not belong to the requesting owner.", recomputedHash: null, source: null };
  }
  if (review.sourceEvidenceId !== evidence.id) {
    return { eligibility: "WRONG_EXTRACTION_VERSION", reason: "Review does not reference this evidence row.", recomputedHash: null, source: null };
  }
  if (review.reviewedExtractionVersion !== windowPlan.segmentationVersion) {
    return { eligibility: "WRONG_EXTRACTION_VERSION", reason: `Review is for extraction version "${review.reviewedExtractionVersion}", not the supplied "${windowPlan.segmentationVersion}".`, recomputedHash: null, source: null };
  }
  // Retention eligibility (Section 74): a revoked or source-deleted
  // evidence row is not currently usable learning authority, even though
  // its historical review remains intact for audit.
  if (evidence.status !== "ACTIVE") {
    return { eligibility: "EVIDENCE_INELIGIBLE", reason: `Evidence status is "${evidence.status}", not ACTIVE.`, recomputedHash: null, source: null };
  }
  if (review.status !== "PROFESSIONALLY_VALIDATED") {
    return { eligibility: "REVIEW_NOT_VALIDATED", reason: `Review status is "${review.status}", not PROFESSIONALLY_VALIDATED.`, recomputedHash: null, source: null };
  }

  const reconciliation = reconcileLongVideoWindows(windowPlan.sourceEvidenceId, windowPlan.windows, rawResultsByWindowId, windowPlan.segmentationVersion);
  const proceduralCandidate = buildProceduralCandidate({
    actionCandidates: reconciliation.actionCandidates,
    segments: reconciliation.segments,
    editGaps: reconciliation.editGaps,
    resultObservationPresent: reconciliation.resultObservationCandidates.length > 0,
    validationCandidatePresent: reconciliation.validationCandidates.length > 0,
  });
  const canonicalJson = JSON.stringify({ reconciliation, proceduralCandidate });
  const recomputedHash = computeApprovedResultHash(canonicalJson);

  if (recomputedHash !== review.approvedResultHash) {
    return {
      eligibility: "HASH_MISMATCH",
      reason: "Recomputed hash does not match the professionally reviewed hash -- this source may not be assimilated.",
      recomputedHash,
      source: null,
    };
  }

  return {
    eligibility: "ELIGIBLE",
    reason: "Evidence is ACTIVE, review is PROFESSIONALLY_VALIDATED and owner-matched, and the recomputed hash matches exactly.",
    recomputedHash,
    source: {
      sourceEvidenceId: evidence.id,
      ownerUserId: evidence.ownerUserId,
      extractionVersion: windowPlan.segmentationVersion,
      approvedResultHash: recomputedHash,
      reviewId: review.id,
      reviewStatus: review.status,
      windows: windowPlan.windows,
      reconciliation,
      proceduralCandidate,
      rawResultsByWindowId,
    },
  };
}
