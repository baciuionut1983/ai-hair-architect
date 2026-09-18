import { findDraftForOwner, recordProceduralClaimReview, type ProfessionalLearningDraftRecord } from "@/lib/professional-learning-draft-repository";
import { hydrateProceduralDraft, isExpectedProceduralReviewRevision } from "@/lib/professional-learning-procedural-read";
import {
  isProceduralClaimReviewDecision,
  type ProceduralClaimReviewDecision,
  type ProceduralClaimReviewEntry,
} from "@/lib/professional-learning-procedural-review-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.4.b.1 --
// PROFESSIONAL PROCEDURAL REVIEW, the orchestration layer. Thin
// connective layer only, exactly like professional-learning-draft-
// service.ts's own established discipline: every real decision lives
// in the module it delegates to (the T1.4.a bridge for what the
// current interpretation actually contains, the repository for
// ownership/state/concurrency).
//
// CLAIM VALIDATION (the audit's own explicit requirement): a client
// must never be able to invent an arbitrary claimId and attach
// professional authority to it. This module RE-DERIVES the current,
// deterministic procedural interpretation from the draft's own
// persisted temporalEvidence on every call (reusing T1.4.a's adapter
// verbatim, ZERO Gemini call) and only accepts a claimId that actually
// appears in that fresh result -- never trusts a claimId merely
// because the request shape looks well-formed.
//
// REVIEWER IDENTITY IS NEVER CLIENT INPUT: ownerUserId/reviewerUserId
// here always come from the caller's own authenticated session (the
// API route derives them from authenticateSessionRequest() and passes
// them in) -- this module has no field anywhere that accepts an
// identity string from a request body.

export class ProfessionalLearningProceduralReviewServiceError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, httpStatus: number, message: string) {
    super(message);
    this.name = "ProfessionalLearningProceduralReviewServiceError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface SubmitProceduralClaimReviewInput {
  readonly ownerUserId: string;
  readonly draftId: string;
  readonly claimId: string;
  readonly decision: string;
  readonly correctedValue?: string;
  readonly note?: string;
  readonly reviewedByUserId: string;
  readonly expectedProceduralReviewRevision: number;
}

export async function submitProceduralClaimReview(input: SubmitProceduralClaimReviewInput): Promise<ProfessionalLearningDraftRecord> {
  if (!isExpectedProceduralReviewRevision(input.expectedProceduralReviewRevision)) {
    throw new ProfessionalLearningProceduralReviewServiceError("INVALID_EXPECTED_REVISION", 400, "expectedProceduralReviewRevision must be a non-negative 32-bit integer with room for an increment.");
  }
  if (!isProceduralClaimReviewDecision(input.decision)) {
    throw new ProfessionalLearningProceduralReviewServiceError("INVALID_DECISION", 400, "decision must be one of the recognized procedural review decisions.");
  }
  const decision: ProceduralClaimReviewDecision = input.decision;

  if (decision === "PROFESSIONALLY_CORRECTED" && (!input.correctedValue || input.correctedValue.trim().length === 0)) {
    throw new ProfessionalLearningProceduralReviewServiceError("MISSING_CORRECTED_VALUE", 400, "A PROFESSIONALLY_CORRECTED decision requires a non-empty correctedValue.");
  }

  const draft = await findDraftForOwner(input.ownerUserId, input.draftId);
  if (!draft) {
    throw new ProfessionalLearningProceduralReviewServiceError("DRAFT_NOT_FOUND", 404, "Draft not found.");
  }
  if (draft.status !== "APPROVED") {
    throw new ProfessionalLearningProceduralReviewServiceError(
      "DRAFT_NOT_APPROVED",
      409,
      `Procedural review requires an APPROVED draft; current status is ${draft.status}.`,
    );
  }

  // Stage 8.5T1.4.a's own bridge, called verbatim -- zero Gemini call,
  // deterministic from the draft's own already-persisted temporalEvidence.
  const claim = hydrateProceduralDraft(draft).reviewableProceduralClaims.find((candidate) => candidate.claimId === input.claimId);
  if (!claim) {
    throw new ProfessionalLearningProceduralReviewServiceError(
      "PROCEDURAL_CLAIM_NOT_FOUND",
      404,
      `No reviewable procedural pattern claim "${input.claimId}" exists for this draft's current interpretation.`,
    );
  }

  const entry: ProceduralClaimReviewEntry = {
    claimId: input.claimId,
    claimType: "PROCEDURAL_PATTERN",
    decision,
    // LAYER 2 snapshot, taken NOW, from the SAME fresh recomputation
    // just validated above -- never a stale/cached value.
    originalValue: claim.originalValue,
    originalProvenance: "INFERRED",
    ...(input.correctedValue !== undefined ? { correctedValue: input.correctedValue } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
    reviewedByUserId: input.reviewedByUserId,
    reviewedAt: new Date().toISOString(),
  };

  return recordProceduralClaimReview(input.ownerUserId, input.draftId, { claimId: input.claimId, entry, expectedProceduralReviewRevision: input.expectedProceduralReviewRevision });
}
