import { computeProfessionalKnowledgeEntryId } from "@/lib/professional-knowledge-entry-contracts";
import { isValidProceduralReviewState } from "@/lib/professional-learning-procedural-review-validators";
import { isValidProfessionalLearningTemporalEvidence } from "@/lib/professional-learning-video-temporal-evidence";
import { buildProceduralInterpretation, TEMPORAL_TO_PROCEDURAL_BRIDGE_VERSION } from "@/lib/professional-learning-video-temporal-to-procedural-adapter";
import { REVIEWED_PROCEDURAL_PROJECTION_VERSION, type ReviewedProceduralKnowledgeEntry, type ReviewedProceduralKnowledgeProjection } from "@/lib/reviewed-procedural-knowledge-contracts";

// The read service validates the owner/draft/evidence/source chain before
// calling this pure projector. Deliberately no extraction/sibling fields.
export interface ReviewedProceduralProjectionInput {
  readonly ownerUserId: string;
  readonly draftId: string;
  readonly sourceEvidenceId: string;
  readonly videoAssetId: string;
  readonly vertical: string;
  readonly extractorVersion: string;
  readonly proceduralReviewRevision: number;
  readonly proceduralReview: unknown;
  readonly temporalEvidence: unknown;
}

// Null means invalid, never an empty successful projection of corrupt data.
export function projectReviewedProceduralKnowledge(input: ReviewedProceduralProjectionInput): ReviewedProceduralKnowledgeProjection | null {
  if (![input.ownerUserId, input.draftId, input.sourceEvidenceId, input.videoAssetId, input.vertical, input.extractorVersion].every(v => typeof v === "string" && v.trim().length > 0)) return null;
  const revision = input.proceduralReviewRevision;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 2_147_483_647) return null;
  if (!isValidProfessionalLearningTemporalEvidence(input.temporalEvidence)) return null;
  const temporal = input.temporalEvidence;
  const duration = temporal.sourceDurationSeconds;
  if (duration != null && (temporal.actions.some(a => a.timeEndSeconds > duration) || temporal.observations.some(o => o.timeEndSeconds > duration) || temporal.editGaps.some(g => g.afterTimeSeconds > duration))) return null;
  const interpretation = buildProceduralInterpretation(input.draftId, temporal);
  if (!interpretation) return null;
  const patterns = interpretation.repetitionByKind;
  const state = input.proceduralReview;
  if (state !== null && (!isValidProceduralReviewState(state) || Array.isArray(state) || Array.isArray(state.claims))) return null;
  if (state !== null && revision === 0 && Object.keys(state.claims).length > 0) return null;
  const entries: ReviewedProceduralKnowledgeEntry[] = [];
  const professionallyUndetermined: ReviewedProceduralKnowledgeProjection["professionallyUndetermined"][number][] = [];
  const reviewed = new Set<string>();
  for (const [key, review] of Object.entries(state?.claims ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const pattern = Object.hasOwn(patterns, key) ? patterns[key] : undefined;
    if (!pattern || key !== review.claimId || review.originalValue.kind !== key || review.originalValue.occurrenceCount !== pattern.occurrenceActionCandidateIds.length) return null;
    if (review.reviewedByUserId !== input.ownerUserId || !Number.isFinite(Date.parse(review.reviewedAt))) return null;
    if (review.decision === "PROFESSIONALLY_CORRECTED" ? !review.correctedValue?.trim() : review.correctedValue !== undefined) return null;
    reviewed.add(key);
    // Whitelist copy: no sibling fields, notes, or raw review JSON can leak.
    const originalValue = { kind: key, occurrenceCount: review.originalValue.occurrenceCount };
    if (review.decision === "PROFESSIONALLY_REJECTED") continue;
    if (review.decision === "PROFESSIONALLY_UNKNOWN") {
      professionallyUndetermined.push({ claimId: key, claimType: "PROCEDURAL_PATTERN", decision: "PROFESSIONALLY_UNKNOWN", originalValue, originalProvenance: "INFERRED", reviewedByUserId: review.reviewedByUserId, reviewedAt: review.reviewedAt });
      continue;
    }
    const sourceDecisionId = JSON.stringify([input.draftId, key, revision]);
    entries.push({
      id: computeProfessionalKnowledgeEntryId("REVIEWED_PROCEDURAL_CLAIM", sourceDecisionId, input.ownerUserId),
      kind: "REVIEWED_PROCEDURAL_CLAIM", status: "APPROVED_BUT_UNATTACHED", scope: "ONLY_THIS_CLAIM",
      ownerUserId: input.ownerUserId, vertical: input.vertical, createdAt: review.reviewedAt,
      payload: review.decision === "PROFESSIONALLY_CORRECTED"
        ? { claimId: key, claimType: "PROCEDURAL_PATTERN", decision: review.decision, value: review.correctedValue! }
        : { claimId: key, claimType: "PROCEDURAL_PATTERN", decision: review.decision, value: { ...originalValue } },
      provenance: {
        originalAIClaim: { value: originalValue, provenance: "INFERRED" },
        decisionType: review.decision === "PROFESSIONALLY_CORRECTED" ? "CORRECTION" : "CONFIRMATION",
        professionalAuthority: "PROFESSIONAL_INPUT", sourceDecisionId,
        draftId: input.draftId, sourceEvidenceId: input.sourceEvidenceId, videoAssetId: input.videoAssetId,
        claimId: key, proceduralReviewRevision: revision, reviewedByUserId: review.reviewedByUserId, reviewedAt: review.reviewedAt,
        extractorVersion: input.extractorVersion, bridgeVersion: TEMPORAL_TO_PROCEDURAL_BRIDGE_VERSION, projectionVersion: REVIEWED_PROCEDURAL_PROJECTION_VERSION,
      },
    });
  }
  return {
    ownerUserId: input.ownerUserId, draftId: input.draftId, sourceEvidenceId: input.sourceEvidenceId, videoAssetId: input.videoAssetId,
    proceduralReviewRevision: revision, projectionVersion: REVIEWED_PROCEDURAL_PROJECTION_VERSION, bridgeVersion: TEMPORAL_TO_PROCEDURAL_BRIDGE_VERSION,
    reviewState: state === null ? "MISSING" : "PRESENT", entries, professionallyUndetermined,
    unreviewedClaimIds: Object.keys(patterns).filter(key => !reviewed.has(key)).sort(),
  };
}
