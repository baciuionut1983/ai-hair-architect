import type { VideoLearningSegment } from "@/lib/professional-learning-video-segmentation";
import { assessRepetition, assessZoneCompletion, type ActionCandidate, type RepetitionAssessment, type ZoneCompletionState } from "@/lib/professional-learning-video-temporal-reasoning";
import type { ReconciledEditGap } from "@/lib/professional-learning-video-cross-window-reconciliation";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R2 --
// PROCEDURAL CANDIDATE (Section 34-37). Pure, no I/O, zero AI calls.
//
// NOT an approved skill. NOT an ExecutionPlan. NOT a Technical
// Demonstration Plan. An interpretation of the observed/inferred
// procedure, built ENTIRELY from professional-learning-video-temporal-
// reasoning.ts's own existing assessment functions (assessRepetition,
// assessZoneCompletion) -- this file adds no new professional-semantics
// logic of its own, only ORDERING and GAP REPRESENTATION on top of what
// L5/L5.R2's reconciliation layer already produced.
//
// SOURCE ORDERING NEVER IMPLIES DEPENDENCY (Section 35): orderedActions
// below is sorted by absolute source time only. Nothing in this file
// asserts that action N+1 professionally depends on action N -- that
// would require an established ReferenceDependencyRelationship, a
// separate, independently-evidenced claim.
//
// MISSING STEPS STAY VISIBLE (Section 36): a time gap between two
// consecutive actions with no reconciled observation filling it is
// represented as its own transition state, never silently collapsed
// into "the procedure flowed continuously from A to C."

export const ACTION_TRANSITION_STATES = ["START", "ADJACENT", "UNKNOWN_TRANSITION", "DISCONTINUOUS_EDITED"] as const;
export type ActionTransitionState = (typeof ACTION_TRANSITION_STATES)[number];

export interface ProceduralCandidateActionEntry {
  readonly action: ActionCandidate;
  readonly absoluteInterval: { readonly timeStartSeconds: number; readonly timeEndSeconds: number };
  readonly precedingTransition: ActionTransitionState;
}

// A gap between two consecutive KEPT actions with no reconciled edit gap
// spanning it, but wider than this margin, is honestly reported as an
// UNKNOWN transition rather than silently treated as continuous --
// reconciliation windows may miss short real gaps, but a gap this wide
// with zero corroborating observation is not safely assumed continuous.
const UNKNOWN_TRANSITION_MIN_GAP_SECONDS = 10;

function segmentInterval(segments: readonly VideoLearningSegment[], segmentId: string) {
  return segments.find((s) => s.id === segmentId)!.interval;
}

export function buildOrderedActionEntries(actionCandidates: readonly ActionCandidate[], segments: readonly VideoLearningSegment[], editGaps: readonly ReconciledEditGap[]): readonly ProceduralCandidateActionEntry[] {
  const sorted = [...actionCandidates].sort((a, b) => segmentInterval(segments, a.segmentIds[0]).timeStartSeconds - segmentInterval(segments, b.segmentIds[0]).timeStartSeconds);

  return sorted.map((action, index) => {
    const interval = segmentInterval(segments, action.segmentIds[0]);
    if (index === 0) return { action, absoluteInterval: interval, precedingTransition: "START" as const };

    const previous = sorted[index - 1];
    const previousInterval = segmentInterval(segments, previous.segmentIds[0]);

    const spanningGap = editGaps.some((gap) => gap.beforeTimeSeconds >= previousInterval.timeEndSeconds - 1 && gap.afterTimeSeconds <= interval.timeStartSeconds + 1);
    if (spanningGap) return { action, absoluteInterval: interval, precedingTransition: "DISCONTINUOUS_EDITED" as const };

    const silentGapSeconds = interval.timeStartSeconds - previousInterval.timeEndSeconds;
    if (silentGapSeconds > UNKNOWN_TRANSITION_MIN_GAP_SECONDS) return { action, absoluteInterval: interval, precedingTransition: "UNKNOWN_TRANSITION" as const };

    return { action, absoluteInterval: interval, precedingTransition: "ADJACENT" as const };
  });
}

// ---------------------------------------------------------------------
// Core professional demonstration chain (Section 37) -- a richer,
// 4-level vocabulary than L5's own summarizeCoreCompletionChain
// (OBSERVED/NOT_OBSERVED), because a long, edited, multi-window source
// genuinely supports a middle ground ("some but not conclusive
// evidence") that a single short clip rarely does. This is a NEW,
// separately-named summary -- it does not modify or replace L5's own
// function, which keeps its existing 2-level contract for its existing
// callers.
// ---------------------------------------------------------------------

export const CORE_CHAIN_SUPPORT_LEVELS = ["SUPPORTED", "PARTIALLY_SUPPORTED", "UNKNOWN", "NOT_OBSERVED"] as const;
export type CoreChainSupportLevel = (typeof CORE_CHAIN_SUPPORT_LEVELS)[number];

export interface LongVideoCoreChainSummary {
  readonly START: CoreChainSupportLevel;
  readonly ACTION: CoreChainSupportLevel;
  readonly PROGRESSION: CoreChainSupportLevel;
  readonly ITERATION: CoreChainSupportLevel;
  readonly ZONE_COMPLETE: CoreChainSupportLevel;
  readonly RESULT_OBSERVATION: CoreChainSupportLevel;
  readonly VALIDATION: CoreChainSupportLevel;
}

export interface ProceduralCandidate {
  readonly orderedActions: readonly ProceduralCandidateActionEntry[];
  readonly knownGaps: readonly ReconciledEditGap[];
  readonly repetitionByKind: Readonly<Record<string, RepetitionAssessment>>;
  readonly zoneCompletionByKind: Readonly<Record<string, ZoneCompletionState>>;
  readonly coreChainSummary: LongVideoCoreChainSummary;
}

export interface BuildProceduralCandidateInput {
  readonly actionCandidates: readonly ActionCandidate[];
  readonly segments: readonly VideoLearningSegment[];
  readonly editGaps: readonly ReconciledEditGap[];
  readonly resultObservationPresent: boolean;
  readonly validationCandidatePresent: boolean;
}

export function buildProceduralCandidate(input: BuildProceduralCandidateInput): ProceduralCandidate {
  const orderedActions = buildOrderedActionEntries(input.actionCandidates, input.segments, input.editGaps);

  const kinds = [...new Set(input.actionCandidates.map((a) => a.kind))];
  const repetitionByKind: Record<string, RepetitionAssessment> = {};
  const zoneCompletionByKind: Record<string, ZoneCompletionState> = {};
  for (const kind of kinds) {
    const repetition = assessRepetition(input.actionCandidates, kind);
    repetitionByKind[kind] = repetition;
    // No spatial zone-adjacency data was solicited from the provider in
    // this stage (Section 21/22's own caution) -- progression is
    // honestly reported as UNKNOWN rather than attempted from
    // insufficient signal, matching L5.R1.1's own established precedent.
    zoneCompletionByKind[kind] = assessZoneCompletion({
      repetition,
      progression: { status: "UNKNOWN", zoneSequence: [] },
      resultObservationPresent: input.resultObservationPresent,
      validationPresent: input.validationCandidatePresent,
    });
  }

  const anyRepeated = Object.values(repetitionByKind).some((r) => r.occurrenceActionCandidateIds.length > 1);
  const anyUnknownTransition = orderedActions.some((e) => e.precedingTransition === "UNKNOWN_TRANSITION");
  const anyDiscontinuous = orderedActions.some((e) => e.precedingTransition === "DISCONTINUOUS_EDITED");
  const anyZoneComplete = Object.values(zoneCompletionByKind).some((s) => s === "COMPLETED");
  const anyZoneInProgress = Object.values(zoneCompletionByKind).some((s) => s === "IN_PROGRESS");

  const coreChainSummary: LongVideoCoreChainSummary = {
    START: orderedActions.length > 0 ? "SUPPORTED" : "NOT_OBSERVED",
    ACTION: orderedActions.length > 0 ? "SUPPORTED" : "NOT_OBSERVED",
    // Progression is never claimed SUPPORTED/PARTIALLY_SUPPORTED here --
    // no spatial evidence was solicited this stage (see zoneCompletion
    // loop's own comment); honestly UNKNOWN whenever any action exists.
    PROGRESSION: orderedActions.length > 0 ? "UNKNOWN" : "NOT_OBSERVED",
    ITERATION: anyRepeated ? (anyUnknownTransition || anyDiscontinuous ? "PARTIALLY_SUPPORTED" : "SUPPORTED") : "NOT_OBSERVED",
    ZONE_COMPLETE: anyZoneComplete ? "SUPPORTED" : anyZoneInProgress ? "PARTIALLY_SUPPORTED" : "NOT_OBSERVED",
    RESULT_OBSERVATION: input.resultObservationPresent ? "SUPPORTED" : "NOT_OBSERVED",
    VALIDATION: input.validationCandidatePresent ? "SUPPORTED" : "NOT_OBSERVED",
  };

  return { orderedActions, knownGaps: input.editGaps, repetitionByKind, zoneCompletionByKind, coreChainSummary };
}
