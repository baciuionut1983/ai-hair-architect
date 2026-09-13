import { findLearningEvidenceForOwner } from "@/lib/professional-learning-evidence-repository";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5 -- ownership-
// scoped VIDEO evidence resolution for segmentation.
//
// Deliberately reuses findLearningEvidenceForOwner
// (professional-learning-evidence-repository.ts) UNCHANGED -- zero new
// database query. Ownership is enforced by that function's own
// `ownerUserId` WHERE-clause scoping (fail-closed: a foreign or
// nonexistent evidence id is indistinguishable to the caller), mirroring
// professional-learning-image-media-resolver.ts's own discipline of never
// building a second, competing ownership check.
//
// SCOPE (Section 14/46/56): this resolver confirms WHICH evidence a
// segment may be attached to -- ownership, ACTIVE status, evidenceType,
// and the presence of a real videoAssetId pointer. It never reads the
// underlying video bytes. A byte-level reader (the video equivalent of
// loadValidatedImageBuffer) is deliberately deferred to the first real
// video-extraction stage, when there is an actual consumer for the bytes
// -- building it now, with nothing yet to feed it, would be premature
// infrastructure this stage's own task explicitly warns against (keep the
// foundation FOUNDATION-sized).
//
// PRIVATE_LEARNING_EVIDENCE / revocation preserved: a REVOKED or
// DELETED_SOURCE evidence row resolves to "unavailable" here exactly like
// every other consumer of ProfessionalLearningEvidence.status -- this
// resolver adds no new lifecycle rule, it only reads the existing one.

export type ResolveLearningVideoEvidenceReason = "EVIDENCE_NOT_FOUND" | "NOT_VIDEO_EVIDENCE" | "EVIDENCE_NOT_ACTIVE" | "VIDEO_ASSET_MISSING";

export type ResolveLearningVideoEvidenceResult =
  | { readonly status: "resolved"; readonly evidenceId: string; readonly videoAssetId: string }
  | { readonly status: "unavailable"; readonly reason: ResolveLearningVideoEvidenceReason };

export async function resolveLearningVideoEvidenceForSegmentation(ownerUserId: string, evidenceId: string): Promise<ResolveLearningVideoEvidenceResult> {
  const evidence = await findLearningEvidenceForOwner(ownerUserId, evidenceId);
  if (!evidence) return { status: "unavailable", reason: "EVIDENCE_NOT_FOUND" };
  if (evidence.evidenceType !== "VIDEO") return { status: "unavailable", reason: "NOT_VIDEO_EVIDENCE" };
  if (evidence.status !== "ACTIVE") return { status: "unavailable", reason: "EVIDENCE_NOT_ACTIVE" };
  if (!evidence.videoAssetId) return { status: "unavailable", reason: "VIDEO_ASSET_MISSING" };
  return { status: "resolved", evidenceId: evidence.id, videoAssetId: evidence.videoAssetId };
}
