// AI Hair Architect, Professional Skill Engine Stage 8.5L5 -- PROFESSIONAL
// VIDEO LEARNING FOUNDATION, temporal primitives. Pure, no I/O, no
// database, zero real AI calls.
//
// Reuses the exact `timeStartSeconds`/`timeEndSeconds` field naming
// already established by professional-learning-draft-validators.ts's
// `ProfessionalLearningExtractionSegmentReference` -- Stage 8.5L4's own,
// deliberately-unpopulated "Part 19/L5 compatibility" placeholder ("the
// shape exists so a later segmented-video extractor can attach it without
// a schema change"). A value built here converts to that exact shape with
// no renaming (see professional-learning-video-segmentation.ts's
// toExtractionSegmentReference) -- this stage's segment representation is
// deliberately compatible with the canonical placeholder Stage 8.5L4
// already reserved, rather than a second, competing shape.
//
// ABSOLUTE INVARIANT (applies to every file in this stage, documented in
// full in professional-learning-video-temporal-reasoning.ts's header):
// AN ACTION IS NOT DEMONSTRATED UNTIL ITS EFFECT IS VISIBLE AND VERIFIABLE.

export interface VideoTimeInterval {
  readonly timeStartSeconds: number;
  readonly timeEndSeconds: number;
}

export function isValidVideoTimeInterval(value: unknown): value is VideoTimeInterval {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const { timeStartSeconds, timeEndSeconds } = record;
  if (typeof timeStartSeconds !== "number" || !Number.isFinite(timeStartSeconds) || timeStartSeconds < 0) return false;
  if (typeof timeEndSeconds !== "number" || !Number.isFinite(timeEndSeconds) || timeEndSeconds <= timeStartSeconds) return false;
  return true;
}

export function videoTimeIntervalDurationSeconds(interval: VideoTimeInterval): number {
  return interval.timeEndSeconds - interval.timeStartSeconds;
}

// Pure, purely-numeric relation between two intervals -- deterministic
// from the numbers alone, never a domain/professional judgment. Does NOT
// equal video playback duration vs. real execution duration (Section 25 --
// no speed/slow-motion detection is implied or required here; this
// function only compares the two intervals' own stated numbers, whatever
// they mean).
export const VIDEO_TIME_INTERVAL_ORDERS = ["BEFORE", "AFTER", "OVERLAPS", "UNKNOWN"] as const;
export type VideoTimeIntervalOrder = (typeof VIDEO_TIME_INTERVAL_ORDERS)[number];

export function isVideoTimeIntervalOrder(value: unknown): value is VideoTimeIntervalOrder {
  return typeof value === "string" && (VIDEO_TIME_INTERVAL_ORDERS as readonly string[]).includes(value);
}

export function computeVideoTimeIntervalOrder(a: VideoTimeInterval, b: VideoTimeInterval): VideoTimeIntervalOrder {
  if (!isValidVideoTimeInterval(a) || !isValidVideoTimeInterval(b)) return "UNKNOWN";
  if (a.timeEndSeconds <= b.timeStartSeconds) return "BEFORE";
  if (b.timeEndSeconds <= a.timeStartSeconds) return "AFTER";
  return "OVERLAPS";
}

// Full closed relation vocabulary (Section 7 of the L5 task). BEFORE /
// AFTER / OVERLAPS / UNKNOWN are the pure-time-math subset computed above.
// CONTINUES and REPEATS are NOT computable from interval arithmetic alone
// -- they are domain-asserted by higher-level reasoning
// (professional-learning-video-temporal-reasoning.ts's RepetitionAssessment
// and the future action-continuity concept). No function in this file
// ever returns CONTINUES or REPEATS.
export const PROFESSIONAL_LEARNING_TEMPORAL_RELATIONS = ["BEFORE", "AFTER", "OVERLAPS", "CONTINUES", "REPEATS", "UNKNOWN"] as const;
export type ProfessionalLearningTemporalRelation = (typeof PROFESSIONAL_LEARNING_TEMPORAL_RELATIONS)[number];

export function isProfessionalLearningTemporalRelation(value: unknown): value is ProfessionalLearningTemporalRelation {
  return typeof value === "string" && (PROFESSIONAL_LEARNING_TEMPORAL_RELATIONS as readonly string[]).includes(value);
}

// Stable, deterministic ordering (Section 51) -- sorts by start time, then
// by a caller-supplied tiebreak id. Never invents sub-second precision to
// force a strict order the underlying data does not actually support;
// items with identical start times simply fall back to id order, which is
// deterministic (repeatable) but explicitly NOT a claim about real-world
// temporal order.
export function sortByStartTimeStable<T extends { readonly interval: VideoTimeInterval; readonly id: string }>(items: readonly T[]): readonly T[] {
  return [...items].sort((a, b) => a.interval.timeStartSeconds - b.interval.timeStartSeconds || a.id.localeCompare(b.id));
}
