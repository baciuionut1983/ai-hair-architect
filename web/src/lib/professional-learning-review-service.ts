import { createHash } from "crypto";

import { findLearningEvidenceForOwner } from "@/lib/professional-learning-evidence-repository";
import { createReview, type ProfessionalLearningReviewRecord } from "@/lib/professional-learning-review-repository";
import { isValidApprovalDetail, type ProfessionalLearningReviewApprovalDetail } from "@/lib/professional-learning-review-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R2 -- PROFESSIONAL
// REVIEW OF BLIND LONG-VIDEO EXTRACTION, the service layer. Validates
// ownership of the evidence being reviewed, deterministically hashes the
// exact frozen result being approved, and stamps the approval detail's
// provenance/negative-assertion fields itself -- a caller cannot smuggle a
// different provenance or silently flip one of the "this touched nothing
// else" flags to true (mirrors professional-learning-draft-service.ts's own
// "the service force-stamps PROFESSIONAL_INPUT, the caller cannot pick
// anything else" discipline).
//
// This module never reads or writes ProfessionalLearningDraft/
// ProfessionalSkillDefinition -- see the ProfessionalLearningReview model
// header for why a review is intentionally NOT a draft row.

export class ProfessionalLearningReviewValidationError extends Error {
  readonly code = "PROFESSIONAL_LEARNING_REVIEW_VALIDATION_ERROR";
  readonly httpStatus = 400;

  constructor(message: string) {
    super(message);
    this.name = "ProfessionalLearningReviewValidationError";
  }
}

// sha256 of the canonical JSON string of the exact frozen result being
// approved -- computed here, deterministically, rather than trusted as a
// caller-supplied value, so the stored hash always reflects what was
// actually hashed (same discipline as every other content-hash id in this
// codebase, e.g. professional-learning-video-long-window-planner.ts's
// computeAnalysisWindowId).
export function computeApprovedResultHash(approvedResultCanonicalJson: string): string {
  return createHash("sha256").update(approvedResultCanonicalJson, "utf8").digest("hex");
}

export interface RecordProfessionalReviewApprovalInput {
  readonly ownerUserId: string;
  readonly reviewId: string;
  readonly sourceEvidenceId: string;
  readonly reviewedExtractionVersion: string;
  // Canonical JSON string (stable key order) of the exact frozen
  // reconciliation + procedural-candidate result this review approves.
  readonly approvedResultCanonicalJson: string;
  readonly confirmedThemes: readonly string[];
  readonly reviewerNote: string;
  readonly reviewedByUserId: string;
  readonly reviewedAt: string;
}

export async function recordProfessionalReviewApproval(input: RecordProfessionalReviewApprovalInput): Promise<ProfessionalLearningReviewRecord> {
  const evidence = await findLearningEvidenceForOwner(input.ownerUserId, input.sourceEvidenceId);
  if (!evidence) throw new ProfessionalLearningReviewValidationError("Source evidence not found for this owner.");
  if (input.confirmedThemes.length === 0) throw new ProfessionalLearningReviewValidationError("At least one confirmed theme is required.");
  if (input.reviewerNote.trim().length === 0) throw new ProfessionalLearningReviewValidationError("A reviewer note is required.");

  const approvalDetail: ProfessionalLearningReviewApprovalDetail = {
    provenance: "PROFESSIONAL_INPUT",
    confirmedThemes: input.confirmedThemes,
    reviewerNote: input.reviewerNote,
    fieldsChanged: false,
    unknownsRemoved: false,
    registryMutated: false,
    skillsCreated: false,
    falseStatementsFound: false,
  };
  if (!isValidApprovalDetail(approvalDetail)) throw new ProfessionalLearningReviewValidationError("Invalid approval detail.");

  const approvedResultHash = computeApprovedResultHash(input.approvedResultCanonicalJson);

  return createReview(input.ownerUserId, input.reviewId, {
    sourceEvidenceId: input.sourceEvidenceId,
    reviewedExtractionVersion: input.reviewedExtractionVersion,
    approvedResultHash,
    approvalDetail,
    reviewedByUserId: input.reviewedByUserId,
    reviewedAt: input.reviewedAt,
  });
}
