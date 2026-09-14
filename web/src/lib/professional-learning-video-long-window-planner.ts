import { createHash } from "crypto";

import { isValidVideoTimeInterval, type VideoTimeInterval } from "@/lib/professional-learning-video-temporal";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R2 -- LONG-VIDEO
// ANALYSIS WINDOW PLANNING. Pure, no I/O, no database, zero real AI calls.
//
// AnalysisWindow is a NEW, DISTINCT concept from professional-learning-
// video-segmentation.ts's VideoLearningSegment -- deliberately not the
// same type. A VideoLearningSegment is a per-OBSERVATION temporal entity
// (fine-grained, built from whatever a provider actually reports). An
// AnalysisWindow is the unit of PROVIDER CALL PLANNING for a long source:
// a bounded slice of the source video sent to the model in one
// generateContent request. Conflating the two would blur "how we chose
// to call the provider" with "what the provider (or a professional)
// actually observed" -- exactly the SEGMENT != STEP discipline this
// stage's own task insists on, one layer up.
//
// CORE vs CONTEXT (Section 8): each window has a `coreInterval` (the
// portion of the source this window is AUTHORITATIVE for -- core
// intervals across all windows are contiguous and non-overlapping,
// together covering the whole source exactly once) and a `contextInterval`
// (core interval expanded by a fixed margin on each side, clamped to the
// source's own bounds). The context exists ONLY to give the provider
// surrounding material for continuity judgments at the window's own
// boundaries -- observations/actions the provider reports for the
// context-only portion of a window are never trusted as that window's
// own authoritative claim (professional-learning-video-cross-window-
// reconciliation.ts enforces this by construction: it only keeps a raw
// claim whose time falls inside the window's OWN coreInterval).
//
// STABLE IDENTITY (Section 9): a window's id is a pure hash of
// (sourceEvidenceId, coreInterval, segmentationVersion) -- reprocessing
// the same source with the same configuration always yields the same
// window ids, never random.

export const ANALYSIS_WINDOW_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;
export type AnalysisWindowStatus = (typeof ANALYSIS_WINDOW_STATUSES)[number];

export function isAnalysisWindowStatus(value: unknown): value is AnalysisWindowStatus {
  return typeof value === "string" && (ANALYSIS_WINDOW_STATUSES as readonly string[]).includes(value);
}

export interface AnalysisWindow {
  readonly id: string;
  readonly sourceEvidenceId: string;
  readonly index: number;
  readonly coreInterval: VideoTimeInterval;
  readonly contextInterval: VideoTimeInterval;
  readonly segmentationVersion: string;
}

export function computeAnalysisWindowId(sourceEvidenceId: string, coreInterval: VideoTimeInterval, segmentationVersion: string): string {
  const canonical = `${sourceEvidenceId}|${coreInterval.timeStartSeconds}|${coreInterval.timeEndSeconds}|${segmentationVersion}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface LongVideoWindowPlan {
  readonly sourceEvidenceId: string;
  readonly totalDurationSeconds: number;
  readonly segmentationVersion: string;
  readonly contextMarginSeconds: number;
  readonly windows: readonly AnalysisWindow[];
}

export interface PlanLongVideoWindowsInput {
  readonly sourceEvidenceId: string;
  readonly totalDurationSeconds: number;
  readonly windowCount: number;
  readonly contextMarginSeconds: number;
  readonly segmentationVersion: string;
}

// Deterministic: identical input always produces an identical plan
// (identical window ids, by construction of computeAnalysisWindowId).
// Core intervals are contiguous and non-overlapping across the whole
// [0, totalDurationSeconds) range; context intervals extend each core by
// `contextMarginSeconds` on both sides, clamped to the source's own
// bounds (never negative, never past the end).
export function planLongVideoWindows(input: PlanLongVideoWindowsInput): LongVideoWindowPlan {
  if (input.totalDurationSeconds <= 0) throw new Error("totalDurationSeconds must be positive.");
  if (!Number.isInteger(input.windowCount) || input.windowCount < 1) throw new Error("windowCount must be a positive integer.");
  if (input.contextMarginSeconds < 0) throw new Error("contextMarginSeconds must not be negative.");

  const coreWidth = input.totalDurationSeconds / input.windowCount;
  const windows: AnalysisWindow[] = [];

  for (let index = 0; index < input.windowCount; index++) {
    const coreStart = Math.round(index * coreWidth);
    const coreEnd = index === input.windowCount - 1 ? input.totalDurationSeconds : Math.round((index + 1) * coreWidth);
    const coreInterval: VideoTimeInterval = { timeStartSeconds: coreStart, timeEndSeconds: coreEnd };

    const contextInterval: VideoTimeInterval = {
      timeStartSeconds: Math.max(0, coreStart - input.contextMarginSeconds),
      timeEndSeconds: Math.min(input.totalDurationSeconds, coreEnd + input.contextMarginSeconds),
    };

    windows.push({
      id: computeAnalysisWindowId(input.sourceEvidenceId, coreInterval, input.segmentationVersion),
      sourceEvidenceId: input.sourceEvidenceId,
      index,
      coreInterval,
      contextInterval,
      segmentationVersion: input.segmentationVersion,
    });
  }

  return { sourceEvidenceId: input.sourceEvidenceId, totalDurationSeconds: input.totalDurationSeconds, segmentationVersion: input.segmentationVersion, contextMarginSeconds: input.contextMarginSeconds, windows };
}

export function isValidAnalysisWindow(value: unknown): value is AnalysisWindow {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.sourceEvidenceId !== "string" || record.sourceEvidenceId.length === 0) return false;
  if (typeof record.index !== "number" || !Number.isInteger(record.index) || record.index < 0) return false;
  if (!isValidVideoTimeInterval(record.coreInterval)) return false;
  if (!isValidVideoTimeInterval(record.contextInterval)) return false;
  if (typeof record.segmentationVersion !== "string" || record.segmentationVersion.length === 0) return false;
  if (typeof record.id !== "string" || record.id.length === 0) return false;
  return record.id === computeAnalysisWindowId(record.sourceEvidenceId, record.coreInterval, record.segmentationVersion);
}

// Whether an absolute source-time value falls within a window's own
// AUTHORITATIVE core interval -- the single deterministic rule that
// decides which window "owns" a given claim (Section 17: no duplicate
// physical action merely because two overlapping windows both saw it --
// exactly one window's core ever owns a given absolute-time claim, by
// construction, so this rule alone prevents the duplication rather than
// requiring a second, fuzzier text-similarity heuristic).
export function isWithinCoreInterval(absoluteTimeSeconds: number, window: AnalysisWindow): boolean {
  return absoluteTimeSeconds >= window.coreInterval.timeStartSeconds && absoluteTimeSeconds < window.coreInterval.timeEndSeconds;
}

// Failure isolation at window granularity (Section 10) -- mirrors
// professional-learning-video-segmentation.ts's processSegmentsIndependently
// exactly, applied to AnalysisWindow instead of VideoLearningSegment.
export interface WindowProcessingOutcome<T> {
  readonly succeeded: readonly { readonly windowId: string; readonly result: T }[];
  readonly failed: readonly { readonly windowId: string; readonly error: string }[];
}

export function processWindowsIndependently<T>(windows: readonly AnalysisWindow[], processor: (window: AnalysisWindow) => T): WindowProcessingOutcome<T> {
  const succeeded: { windowId: string; result: T }[] = [];
  const failed: { windowId: string; error: string }[] = [];

  for (const window of windows) {
    try {
      succeeded.push({ windowId: window.id, result: processor(window) });
    } catch (error) {
      failed.push({ windowId: window.id, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    }
  }

  return { succeeded, failed };
}
