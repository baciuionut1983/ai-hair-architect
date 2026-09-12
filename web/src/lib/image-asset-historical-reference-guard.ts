// AI Hair Architect -- RETENTION SAFETY GATE. Deterministic, server-side,
// zero-AI answer to one question: "is this ImageAsset still required as
// historical evidence by ANY governed record?" Used by
// image-asset-retention.ts (M36) to decide, for each time-eligible row,
// whether physical purge (storage object + DB row) may proceed.
//
// REFERENCE INVENTORY (audited directly from prisma/schema.prisma before
// writing this file -- every real imageAssetId-shaped field found, ZERO
// invented relationships):
//   Analysis.imageAssetId                                (real FK, SetNull)
//   ImageAnalysis.assetId                                (real FK, CASCADE --
//     the most dangerous existing edge: purging an ImageAsset already
//     cascade-deletes its ImageAnalysis row today, even if that row's own,
//     separate deletedAt/retentionDeletesAt window has not expired)
//   AnalysisProposal.sourceImageAssetId                  (soft pointer)
//   TechnicalVisualMap.sourceImageAssetId                (soft pointer)
//   TechnicalVisualMapSpatialBinding.sourceImageAssetId  (soft pointer, required)
//   HairStateSnapshot.sourceImageAssetId                 (soft pointer)
//   HairStateSnapshotEvidence.imageAssetId               (soft pointer, Stage 3)
//   CaptureSetImage.imageAssetId                         (soft pointer)
//   PhotoPreviewGeneration.sourceImageAssetId            (soft pointer, required)
//   PhotoPreviewGeneration.generatedImageAssetId         (soft pointer, nullable --
//     the RESULT/preview image itself; still a real ImageAsset row)
//   VideoDemonstrationGeneration.sourceGeneratedImageAssetId (soft pointer, required)
//   TechnicalExecutionGenerationRequest.imageAssetId     (soft pointer, frozen snapshot)
//   ProfessionalLearningEvidence.imageAssetId            (soft pointer, Stage 8.5L2 --
//     covers both IMAGE and DIAGRAM evidenceType rows; an evidence-referenced
//     image must never be silently purged out from under private teaching
//     material)
// EXCLUDED, deliberately: ClientPhoto (a genuinely separate, older system --
// `imageUrl` is a plain string, no relation to ImageAsset at all);
// VideoAsset (no deletedAt/retentionDeletesAt column anywhere on this model
// -- it has no purge lifecycle to guard).
//
// CAPTURESET SEMANTICS: a CaptureSet/CaptureSetImage is never deleted by
// any production code path today (verified: no non-test
// captureSet.delete*/captureSetImage.delete* call exists anywhere in this
// repo) -- so this file does not need its own CaptureSet deletion guard.
// It only needs to stop the underlying ImageAsset a CaptureSetImage points
// at from being purged out from under an otherwise-immutable, historically
// meaningful Capture Set -- which the captureSetImageByImageAssetId source
// below does directly, without inventing a second multi-view authority
// system.
//
// FAIL-CLOSED: if any one of the 12 lookups throws, this function throws --
// the caller (image-asset-retention.ts) must never catch this and proceed
// as though nothing were referenced. "Reference status cannot be
// determined reliably" must always resolve to "do not purge", never to a
// default empty set.
//
// ZERO AI, ZERO LLM, ZERO EXTERNAL CALL -- every source below is a plain,
// indexed database read.

export interface HistoricalImageReferenceDatabase {
  readonly analysisByImageAssetId: (imageAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly imageAnalysisByAssetId: (imageAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly analysisProposalBySourceImageAssetId: (imageAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly technicalVisualMapBySourceImageAssetId: (imageAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly technicalVisualMapSpatialBindingBySourceImageAssetId: (imageAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly hairStateSnapshotBySourceImageAssetId: (imageAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly hairStateSnapshotEvidenceByImageAssetId: (imageAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly captureSetImageByImageAssetId: (imageAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly photoPreviewGenerationBySourceImageAssetId: (imageAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly photoPreviewGenerationByGeneratedImageAssetId: (imageAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly videoDemonstrationGenerationBySourceGeneratedImageAssetId: (imageAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly technicalExecutionGenerationRequestByImageAssetId: (imageAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly professionalLearningEvidenceByImageAssetId: (imageAssetIds: readonly string[]) => Promise<readonly string[]>;
}

export const HISTORICAL_IMAGE_REFERENCE_SOURCES = [
  "Analysis.imageAssetId",
  "ImageAnalysis.assetId",
  "AnalysisProposal.sourceImageAssetId",
  "TechnicalVisualMap.sourceImageAssetId",
  "TechnicalVisualMapSpatialBinding.sourceImageAssetId",
  "HairStateSnapshot.sourceImageAssetId",
  "HairStateSnapshotEvidence.imageAssetId",
  "CaptureSetImage.imageAssetId",
  "PhotoPreviewGeneration.sourceImageAssetId",
  "PhotoPreviewGeneration.generatedImageAssetId",
  "VideoDemonstrationGeneration.sourceGeneratedImageAssetId",
  "TechnicalExecutionGenerationRequest.imageAssetId",
  "ProfessionalLearningEvidence.imageAssetId",
] as const;

// Returns the SUBSET of candidateImageAssetIds that are still referenced
// by at least one historical record, across every source above. An empty
// result means every candidate is genuinely safe to purge. Deterministic:
// the same underlying data always produces the same result.
export async function findHistoricallyReferencedImageAssetIds(
  db: HistoricalImageReferenceDatabase,
  candidateImageAssetIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (candidateImageAssetIds.length === 0) return new Set();

  const ids = [...candidateImageAssetIds];
  const results = await Promise.all([
    db.analysisByImageAssetId(ids),
    db.imageAnalysisByAssetId(ids),
    db.analysisProposalBySourceImageAssetId(ids),
    db.technicalVisualMapBySourceImageAssetId(ids),
    db.technicalVisualMapSpatialBindingBySourceImageAssetId(ids),
    db.hairStateSnapshotBySourceImageAssetId(ids),
    db.hairStateSnapshotEvidenceByImageAssetId(ids),
    db.captureSetImageByImageAssetId(ids),
    db.photoPreviewGenerationBySourceImageAssetId(ids),
    db.photoPreviewGenerationByGeneratedImageAssetId(ids),
    db.videoDemonstrationGenerationBySourceGeneratedImageAssetId(ids),
    db.technicalExecutionGenerationRequestByImageAssetId(ids),
    db.professionalLearningEvidenceByImageAssetId(ids),
  ]);

  const referenced = new Set<string>();
  for (const idsFromOneSource of results) {
    for (const id of idsFromOneSource) referenced.add(id);
  }
  return referenced;
}
