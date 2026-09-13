import { createHash } from "crypto";

import { isProfessionalLearningProvenanceSource, type ProfessionalLearningExtractionSegmentReference, type ProfessionalLearningProvenanceSource } from "@/lib/professional-learning-draft-validators";
import { isValidVideoTimeInterval, type VideoTimeInterval } from "@/lib/professional-learning-video-temporal";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5 -- PROFESSIONAL
// VIDEO LEARNING FOUNDATION, segment + temporal-observation
// representation. Pure, no I/O, no database, zero real AI calls.
//
// SEGMENT != STEP. SEGMENT != SKILL. SEGMENT != GENERATION SCENE (Section
// 8/5): a VideoLearningSegment below is a bounded time interval from
// SOURCE evidence, nothing more. It structurally CANNOT carry generation-
// authoritative fields -- this file has zero imports from
// professional-execution-scene-*.ts/professional-skill-atomic-action-
// contracts.ts/professional-skill-execution-unit-contracts.ts. A
// ProfessionalExecutionScene asserts an already-approved capability
// demonstration (see that file's own "AUTHORITY IS ONE-WAY" header); a
// learning segment is raw, unreviewed material -- reusing that type here
// would silently claim professional-authority-approval for footage that
// has not been reviewed. See this stage's own report for the full
// audit reasoning.
//
// SEGMENT IDENTITY / IDEMPOTENCY (Section 9/50): a segment's id is a pure
// hash of (sourceEvidenceId, interval, segmentationVersion) -- never a
// random/provider-supplied string. Reprocessing identical inputs always
// yields the identical id, so a segment can never be silently duplicated
// by re-running segmentation; the id also acts as a tamper-evidence check
// (isValidVideoLearningSegment recomputes and compares it).

export interface VideoLearningSegment {
  readonly id: string;
  readonly sourceEvidenceId: string;
  readonly interval: VideoTimeInterval;
  readonly segmentationVersion: string;
}

export function computeVideoLearningSegmentId(sourceEvidenceId: string, interval: VideoTimeInterval, segmentationVersion: string): string {
  const canonical = `${sourceEvidenceId}|${interval.timeStartSeconds}|${interval.timeEndSeconds}|${segmentationVersion}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function createVideoLearningSegment(sourceEvidenceId: string, interval: VideoTimeInterval, segmentationVersion: string): VideoLearningSegment {
  return { id: computeVideoLearningSegmentId(sourceEvidenceId, interval, segmentationVersion), sourceEvidenceId, interval, segmentationVersion };
}

export function isValidVideoLearningSegment(value: unknown): value is VideoLearningSegment {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.sourceEvidenceId !== "string" || record.sourceEvidenceId.length === 0) return false;
  if (typeof record.segmentationVersion !== "string" || record.segmentationVersion.length === 0) return false;
  if (!isValidVideoTimeInterval(record.interval)) return false;
  if (typeof record.id !== "string" || record.id.length === 0) return false;
  return record.id === computeVideoLearningSegmentId(record.sourceEvidenceId, record.interval, record.segmentationVersion);
}

// Converts to the EXISTING, already-committed (Stage 8.5L4)
// ProfessionalLearningExtractionSegmentReference shape -- proves this
// stage's segment representation is compatible with the canonical
// placeholder Stage 8.5L4 already reserved for exactly this purpose,
// instead of inventing a second, competing shape. Never modifies
// professional-learning-draft-validators.ts.
export function toExtractionSegmentReference(
  segment: VideoLearningSegment,
  observations: string,
  relevance: number,
  options?: { readonly confidence?: number; readonly frameReferences?: readonly string[] },
): ProfessionalLearningExtractionSegmentReference {
  return {
    timeStartSeconds: segment.interval.timeStartSeconds,
    timeEndSeconds: segment.interval.timeEndSeconds,
    relevance,
    observations,
    ...(options?.confidence !== undefined ? { confidence: options.confidence } : {}),
    ...(options?.frameReferences !== undefined ? { frameReferences: options.frameReferences } : {}),
  };
}

// ---------------------------------------------------------------------
// Temporal observation (Section 10/11) -- OBSERVATION != ACTION. Always
// traceable to its source segment/evidence; never a fact detached from a
// time interval that could become authoritative on its own. Reuses the
// EXACT existing ProfessionalLearningProvenanceSource vocabulary
// (OBSERVED/INFERRED/PROFESSIONAL_INPUT/UNKNOWN + future-capable classes)
// -- no parallel provenance vocabulary is introduced for video.
// ---------------------------------------------------------------------

export interface TemporalObservation {
  readonly id: string;
  readonly segmentId: string;
  readonly sourceEvidenceId: string;
  readonly description: string;
  readonly provenance: ProfessionalLearningProvenanceSource;
  readonly extractorVersion?: string;
}

export function computeTemporalObservationId(segmentId: string, description: string, extractorVersion?: string): string {
  const canonical = `${segmentId}|${description}|${extractorVersion ?? ""}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function createTemporalObservation(
  segmentId: string,
  sourceEvidenceId: string,
  description: string,
  provenance: ProfessionalLearningProvenanceSource,
  extractorVersion?: string,
): TemporalObservation {
  return {
    id: computeTemporalObservationId(segmentId, description, extractorVersion),
    segmentId,
    sourceEvidenceId,
    description,
    provenance,
    ...(extractorVersion !== undefined ? { extractorVersion } : {}),
  };
}

export function isValidTemporalObservation(value: unknown): value is TemporalObservation {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.segmentId !== "string" || record.segmentId.length === 0) return false;
  if (typeof record.sourceEvidenceId !== "string" || record.sourceEvidenceId.length === 0) return false;
  if (typeof record.description !== "string" || record.description.length === 0) return false;
  if (!isProfessionalLearningProvenanceSource(record.provenance)) return false;
  if (record.extractorVersion !== undefined && typeof record.extractorVersion !== "string") return false;
  if (typeof record.id !== "string") return false;
  const extractorVersion = record.extractorVersion as string | undefined;
  return record.id === computeTemporalObservationId(record.segmentId, record.description, extractorVersion);
}

// ---------------------------------------------------------------------
// Failure isolation (Section 49) -- one segment's processor throwing
// never discards or mutates any other segment's already-succeeded
// result. Reprocessing only the failed segment is naturally possible: the
// caller simply passes the subset it wants retried, and succeeded results
// for untouched segments are never revisited.
// ---------------------------------------------------------------------

export interface SegmentProcessingOutcome<T> {
  readonly succeeded: readonly { readonly segmentId: string; readonly result: T }[];
  readonly failed: readonly { readonly segmentId: string; readonly error: string }[];
}

export function processSegmentsIndependently<T>(
  segments: readonly VideoLearningSegment[],
  processor: (segment: VideoLearningSegment) => T,
): SegmentProcessingOutcome<T> {
  const succeeded: { segmentId: string; result: T }[] = [];
  const failed: { segmentId: string; error: string }[] = [];

  for (const segment of segments) {
    try {
      succeeded.push({ segmentId: segment.id, result: processor(segment) });
    } catch (error) {
      failed.push({ segmentId: segment.id, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    }
  }

  return { succeeded, failed };
}
