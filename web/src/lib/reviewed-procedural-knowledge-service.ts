import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ALLOWED_LEARNING_VIDEO_MIME_TYPES } from "@/lib/learning-evidence-video-upload";
import { isProfessionalLearningEvidenceRightsClassification, isValidEvidenceAssetPointerCombination } from "@/lib/professional-learning-evidence-validators";
import { projectReviewedProceduralKnowledge } from "@/lib/reviewed-procedural-knowledge-projector";
import { isReviewedProceduralSourceAccessible } from "@/lib/reviewed-procedural-knowledge-source";
import { isRecord } from "@/lib/technical-visual-map-validators";

export class ReviewedProceduralKnowledgeReadError extends Error {
  constructor(readonly code: "DRAFT_NOT_FOUND" | "PROJECTION_UNAVAILABLE" | "PROJECTION_READ_UNAVAILABLE", readonly httpStatus: 404 | 409 | 503) {
    super(code);
  }
}

const unavailable = () => new ReviewedProceduralKnowledgeReadError("PROJECTION_UNAVAILABLE", 409);

// All soft-link lookups are owner-scoped in SQL. A consistent DB snapshot
// avoids combining a draft from one revision with a different evidence state.
async function readChain(ownerUserId: string, draftId: string) {
  return prisma.$transaction(async tx => {
    const draft = await tx.professionalLearningDraft.findFirst({ where: { id: draftId, ownerUserId }, select: {
      id: true, ownerUserId: true, sourceEvidenceId: true, status: true, supersededByDraftId: true,
      extractorVersion: true, temporalEvidence: true, proceduralReview: true, proceduralReviewRevision: true,
    } });
    if (!draft) throw new ReviewedProceduralKnowledgeReadError("DRAFT_NOT_FOUND", 404);
    if (draft.ownerUserId !== ownerUserId || draft.status !== "APPROVED" || draft.supersededByDraftId !== null) throw unavailable();
    const evidence = await tx.professionalLearningEvidence.findFirst({ where: { id: draft.sourceEvidenceId, ownerUserId }, select: {
      id: true, ownerUserId: true, evidenceType: true, vertical: true, visibilityScope: true, status: true,
      videoAssetId: true, imageAssetId: true, captureSetId: true, revokedAt: true, sourceMediaDeletedAt: true,
      rightsClassification: true, provenance: true, parentEvidenceId: true,
    } });
    // This slice is the VIDEO -> temporal claim path. No permissive fallback
    // for text, generated output, or future derived-evidence semantics.
    if (!evidence || evidence.ownerUserId !== ownerUserId || evidence.id !== draft.sourceEvidenceId
      || evidence.evidenceType !== "VIDEO" || evidence.status !== "ACTIVE" || evidence.visibilityScope !== "PRIVATE_LEARNING_EVIDENCE"
      || evidence.revokedAt !== null || evidence.sourceMediaDeletedAt !== null || evidence.parentEvidenceId !== null
      || !evidence.vertical.trim() || !isRecord(evidence.provenance) || !isProfessionalLearningEvidenceRightsClassification(evidence.rightsClassification)
      || !isValidEvidenceAssetPointerCombination("VIDEO", evidence) || !evidence.videoAssetId) throw unavailable();
    const asset = await tx.videoAsset.findFirst({ where: { id: evidence.videoAssetId, ownerUserId, deletedAt: null, client: { ownerUserId, deletedAt: null } }, select: {
      id: true, ownerUserId: true, origin: true, deletedAt: true, mimeType: true, sizeBytes: true,
      storagePath: true, storageBackend: true, storageBucketAlias: true, storageKey: true,
      storageVersionId: true, storageEtag: true, contentSha256: true,
    } });
    if (!asset || asset.ownerUserId !== ownerUserId || asset.id !== evidence.videoAssetId || asset.origin !== "uploaded_source" || asset.deletedAt !== null || !ALLOWED_LEARNING_VIDEO_MIME_TYPES.has(asset.mimeType)) throw unavailable();
    return { draft, evidence, asset };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

// ownerUserId is supplied by server-session auth in the sole HTTP caller.
// Injectable source probe supports offline tests, never client input.
export async function readReviewedProceduralKnowledge(ownerUserId: string, draftId: string, sourceAccessible = isReviewedProceduralSourceAccessible) {
  if (!ownerUserId.trim() || !draftId.trim()) throw new ReviewedProceduralKnowledgeReadError("DRAFT_NOT_FOUND", 404);
  try {
    const chain = await readChain(ownerUserId, draftId);
    const projection = projectReviewedProceduralKnowledge({
      ownerUserId, draftId: chain.draft.id, sourceEvidenceId: chain.evidence.id, videoAssetId: chain.asset.id,
      vertical: chain.evidence.vertical, extractorVersion: chain.draft.extractorVersion,
      temporalEvidence: chain.draft.temporalEvidence, proceduralReview: chain.draft.proceduralReview, proceduralReviewRevision: chain.draft.proceduralReviewRevision,
    });
    if (!projection || !await sourceAccessible(chain.asset)) throw unavailable();
    // Storage I/O is outside the transaction. If a review/lifecycle/pointer
    // changes during that read, return no projection and require a fresh GET.
    const current = await readChain(ownerUserId, draftId);
    if (JSON.stringify(current) !== JSON.stringify(chain)) throw unavailable();
    return projection;
  } catch (error) {
    if (error instanceof ReviewedProceduralKnowledgeReadError) throw error;
    throw new ReviewedProceduralKnowledgeReadError("PROJECTION_READ_UNAVAILABLE", 503);
  }
}
