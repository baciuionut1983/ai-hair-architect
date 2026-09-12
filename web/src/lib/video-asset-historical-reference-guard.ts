// AI Hair Architect -- VIDEO RETENTION SAFETY GATE (Stage 8.5L2 Part 8/9).
// Deterministic, server-side, zero-AI answer to one question: "is this
// VideoAsset still required as historical evidence by ANY governed
// record?" Mirrors image-asset-historical-reference-guard.ts's own
// principle and shape exactly -- this stage's own audit found VideoAsset
// had no equivalent guard at all (it had no deletedAt/retentionDeletesAt
// lifecycle to guard until this stage added one).
//
// REFERENCE INVENTORY (audited directly from prisma/schema.prisma before
// writing this file -- every real videoAssetId-shaped field found, ZERO
// invented relationships):
//   VideoDemonstrationGeneration.generatedVideoAssetId       (soft pointer,
//     nullable -- the Result Video generation pipeline's own output)
//   TechnicalExecutionVideoGeneration.generatedVideoAssetId  (soft pointer,
//     nullable -- the technical-execution generation pipeline's own output)
//   ProfessionalLearningEvidence.videoAssetId                (soft pointer,
//     nullable -- Stage 8.5L2's own new source: a private teaching video)
//
// FAIL-CLOSED: if any one of the 3 lookups throws, this function throws --
// the caller must never catch this and proceed as though nothing were
// referenced. "Reference status cannot be determined reliably" must
// always resolve to "do not purge", never to a default empty set.
//
// NO PURGE/EXECUTION ENGINE EXISTS IN THIS FILE, OR ANYWHERE ELSE YET
// (Stage 8.5L2 Part 9's own explicit "No production purge in this
// stage") -- this module only answers the reference question and reports
// a structured eligibility reason; it deletes nothing.
//
// ZERO AI, ZERO LLM, ZERO EXTERNAL CALL -- every source below is a plain,
// indexed database read.

export interface HistoricalVideoReferenceDatabase {
  readonly videoDemonstrationGenerationByGeneratedVideoAssetId: (videoAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly technicalExecutionVideoGenerationByGeneratedVideoAssetId: (videoAssetIds: readonly string[]) => Promise<readonly string[]>;
  readonly professionalLearningEvidenceByVideoAssetId: (videoAssetIds: readonly string[]) => Promise<readonly string[]>;
}

export const HISTORICAL_VIDEO_REFERENCE_SOURCES = [
  "VideoDemonstrationGeneration.generatedVideoAssetId",
  "TechnicalExecutionVideoGeneration.generatedVideoAssetId",
  "ProfessionalLearningEvidence.videoAssetId",
] as const;

// Returns the SUBSET of candidateVideoAssetIds that are still referenced
// by at least one historical record, across every source above. An empty
// result means every candidate is genuinely safe to purge. Deterministic:
// the same underlying data always produces the same result.
export async function findHistoricallyReferencedVideoAssetIds(
  db: HistoricalVideoReferenceDatabase,
  candidateVideoAssetIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (candidateVideoAssetIds.length === 0) return new Set();

  const ids = [...candidateVideoAssetIds];
  const results = await Promise.all([
    db.videoDemonstrationGenerationByGeneratedVideoAssetId(ids),
    db.technicalExecutionVideoGenerationByGeneratedVideoAssetId(ids),
    db.professionalLearningEvidenceByVideoAssetId(ids),
  ]);

  const referenced = new Set<string>();
  for (const idsFromOneSource of results) {
    for (const id of idsFromOneSource) referenced.add(id);
  }
  return referenced;
}

export type VideoAssetPurgeEligibilityReason = "NOT_REFERENCED" | "REFERENCED_BY_HISTORICAL_RECORD";

export interface VideoAssetPurgeEligibility {
  readonly videoAssetId: string;
  readonly eligible: boolean;
  readonly reason: VideoAssetPurgeEligibilityReason;
}

// Structured-reason wrapper (Stage 8.5L2 Part 9: "Return a structured
// reason") over the same fail-closed reference check above -- a future
// purge job (not built in this stage) would consult this before touching
// any row's storage object or DB row, exactly mirroring how
// image-asset-retention.ts consults findHistoricallyReferencedImageAssetIds
// before either of its own two phases.
export async function evaluateVideoAssetPurgeEligibility(
  db: HistoricalVideoReferenceDatabase,
  candidateVideoAssetIds: readonly string[],
): Promise<readonly VideoAssetPurgeEligibility[]> {
  const referenced = await findHistoricallyReferencedVideoAssetIds(db, candidateVideoAssetIds);
  return candidateVideoAssetIds.map((videoAssetId) => ({
    videoAssetId,
    eligible: !referenced.has(videoAssetId),
    reason: referenced.has(videoAssetId) ? "REFERENCED_BY_HISTORICAL_RECORD" : "NOT_REFERENCED",
  }));
}
