import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";
import { createTemporalObservation, createVideoLearningSegment, type TemporalObservation, type VideoLearningSegment } from "@/lib/professional-learning-video-segmentation";
import { createActionCandidate, type ActionCandidate } from "@/lib/professional-learning-video-temporal-reasoning";
import type { VideoTimeInterval } from "@/lib/professional-learning-video-temporal";
import { isWithinCoreInterval, type AnalysisWindow } from "@/lib/professional-learning-video-long-window-planner";
import { createReferenceDependencyRelationship, type ReferenceDependencyRelationship } from "@/lib/professional-learning-reference-dependency";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R2 --
// DETERMINISTIC CROSS-WINDOW RECONCILIATION. Pure, no I/O, no database,
// ZERO AI calls. Takes N raw provider outputs (one per AnalysisWindow,
// each reporting WINDOW-RELATIVE times per professional-learning-
// extractor-gemini.ts's own extractVideoWindow contract) and reconciles
// them into ONE coherent, deduplicated, absolute-time picture of the
// source -- reusing L5's existing VideoLearningSegment/TemporalObservation/
// ActionCandidate types and L5.R1.1's ReferenceDependencyRelationship
// type verbatim, never a parallel/competing shape.
//
// DEDUPLICATION WITHOUT TEXT-SIMILARITY HEURISTICS (Section 17/43): each
// AnalysisWindow's own CORE interval is, by planLongVideoWindows's own
// construction, disjoint from every other window's core -- an absolute
// time point belongs to EXACTLY ONE window's core. Reconciliation
// therefore only ever keeps a raw claim whose (window-relative-shifted-
// to-absolute) start time falls inside the window that reported it OWN
// core interval; claims reported for the context-only portion of a
// window (shown to the model only for continuity judgment) are dropped
// entirely. This is a purely time-based rule -- no keyword/text-
// similarity matching, so it can never "merge" two genuinely different
// observations that merely sound alike, and it can never duplicate the
// same physical moment (each moment has exactly one owning window).
//
// CROSS-WINDOW CONTINUITY (Section 13) is computed from only two
// objective signals, exactly mirroring this stage's own "no single cue
// automatically proves continuity" rule: (a) a reconciled edit/cut
// spanning the boundary -> DISCONTINUOUS_EDITED, (b) otherwise, the
// action ending nearest the boundary and the action starting nearest the
// boundary sharing the same provider-proposed `kind` -> POSSIBLY_CONTINUES
// (a WEAK signal, deliberately never upgraded to a hard CONTINUES by this
// deterministic layer), (c) otherwise UNKNOWN.

export const CROSS_WINDOW_CONTINUITY_STATES = ["CONTINUES", "POSSIBLY_CONTINUES", "DISCONTINUOUS_EDITED", "UNKNOWN"] as const;
export type CrossWindowContinuityState = (typeof CROSS_WINDOW_CONTINUITY_STATES)[number];

export interface ReconciledEditGap {
  readonly beforeTimeSeconds: number;
  readonly afterTimeSeconds: number;
}

export interface ReconciledWindowResult {
  readonly window: AnalysisWindow;
  readonly segments: readonly VideoLearningSegment[];
  readonly observations: readonly TemporalObservation[];
  readonly actionCandidates: readonly ActionCandidate[];
  readonly editGaps: readonly ReconciledEditGap[];
  readonly referenceDependencyCandidates: readonly ReferenceDependencyRelationship[];
}

function shiftInterval(relative: VideoTimeInterval, windowContextStartSeconds: number): VideoTimeInterval {
  return { timeStartSeconds: relative.timeStartSeconds + windowContextStartSeconds, timeEndSeconds: relative.timeEndSeconds + windowContextStartSeconds };
}

// Section 18/6-carried-forward: a narrow, replaceable CANDIDATE-DETECTION
// fallback, never a semantic authority. A raw observation mentioning a
// reference-indicating phrase produces a CANDIDATE relationship whose
// `semanticSupport` is never set true here -- it therefore ALWAYS
// evaluates as NOT established (isReferenceDependencyEstablished),
// exactly matching "REFERENCE != GUIDE AUTOMATICALLY." This never gates
// completion, effect, or any other higher-stakes field; it only proves
// the L5.R1.1 relationship architecture is exercised end-to-end on new
// evidence, honestly reported as unproven.
const REFERENCE_MENTION_PHRASES = ["reference", "guide", "previous section", "previously cut", "established length", "matches the", "using the", "against the"];

// Same narrow, replaceable candidate-mention discipline as
// detectPossibleReferenceDependencyMentions above, applied to RESULT and
// VALIDATION (Section 27/28): a matching observation is a CANDIDATE only
// -- "something result-like/validation-like was textually mentioned,"
// never a professional confirmation that a result was actually achieved
// or that a real cross-check occurred. Consumers (the procedural
// candidate's own chain summary) use candidate PRESENCE only to decide
// whether that stage is even representable as SUPPORTED/NOT_OBSERVED,
// never to assert professional correctness.
const RESULT_MENTION_PHRASES = ["finished", "final result", "completed look", "styled result", "end result"];
const VALIDATION_MENTION_PHRASES = ["checks", "inspects", "compares", "symmetry", "cross-check", "cross check", "verifies"];

export function detectResultObservationCandidates(observations: readonly TemporalObservation[]): readonly TemporalObservation[] {
  return observations.filter((o) => RESULT_MENTION_PHRASES.some((phrase) => o.description.toLowerCase().includes(phrase)));
}

export function detectValidationCandidates(observations: readonly TemporalObservation[]): readonly TemporalObservation[] {
  return observations.filter((o) => VALIDATION_MENTION_PHRASES.some((phrase) => o.description.toLowerCase().includes(phrase)));
}

function detectPossibleReferenceDependencyMentions(observations: readonly TemporalObservation[], sourceEvidenceId: string): readonly ReferenceDependencyRelationship[] {
  const candidates: ReferenceDependencyRelationship[] = [];
  for (const observation of observations) {
    const lower = observation.description.toLowerCase();
    if (REFERENCE_MENTION_PHRASES.some((phrase) => lower.includes(phrase))) {
      candidates.push(
        createReferenceDependencyRelationship({
          sourceEntity: { ref: observation.id, kind: "OBSERVATION", label: observation.description },
          targetEntity: { ref: `unspecified-${sourceEvidenceId}`, kind: "UNSPECIFIED" },
          relationshipType: "REFERENCE_ROLE_UNKNOWN",
          provenance: "INFERRED",
          evidenceInterval: undefined,
          note: "Detected via a narrow, replaceable candidate-mention heuristic -- source support only, never semantic authority.",
        }),
      );
    }
  }
  return candidates;
}

// Reconciles ONE window's raw provider output into L5's real domain
// types, keeping only claims whose absolute start time falls within this
// window's OWN core interval (the deduplication rule -- see file header).
export function reconcileWindowResult(sourceEvidenceId: string, window: AnalysisWindow, raw: ProfessionalLearningExtractorOutput, segmentationVersion: string): ReconciledWindowResult {
  const windowContextStart = window.contextInterval.timeStartSeconds;

  const segmentByIntervalKey = new Map<string, VideoLearningSegment>();
  const segmentFor = (relativeInterval: VideoTimeInterval): VideoLearningSegment => {
    const absolute = shiftInterval(relativeInterval, windowContextStart);
    const key = `${absolute.timeStartSeconds}|${absolute.timeEndSeconds}`;
    const existing = segmentByIntervalKey.get(key);
    if (existing) return existing;
    const created = createVideoLearningSegment(sourceEvidenceId, absolute, segmentationVersion);
    segmentByIntervalKey.set(key, created);
    return created;
  };

  const observations: TemporalObservation[] = [];
  for (const rawObservation of raw.temporalObservations ?? []) {
    const absoluteStart = rawObservation.timeStartSeconds + windowContextStart;
    if (!isWithinCoreInterval(absoluteStart, window)) continue; // context-only, owned by a neighboring window (or none)
    const segment = segmentFor({ timeStartSeconds: rawObservation.timeStartSeconds, timeEndSeconds: rawObservation.timeEndSeconds });
    observations.push(createTemporalObservation(segment.id, sourceEvidenceId, rawObservation.observation, "OBSERVED", "gemini-long-video-window-v1"));
  }

  const actionCandidates: ActionCandidate[] = [];
  for (const rawAction of raw.actionCandidates ?? []) {
    const absoluteStart = rawAction.timeStartSeconds + windowContextStart;
    if (!isWithinCoreInterval(absoluteStart, window)) continue;
    const segment = segmentFor({ timeStartSeconds: rawAction.timeStartSeconds, timeEndSeconds: rawAction.timeEndSeconds });
    const relatedObservationIds = observations.filter((obs) => obs.segmentId === segment.id).map((obs) => obs.id);
    actionCandidates.push(createActionCandidate([segment.id], relatedObservationIds, rawAction.kind, "APPROXIMATE", "APPROXIMATE"));
  }

  const editGaps: ReconciledEditGap[] = (raw.notableEditsOrCuts ?? [])
    .map((gap) => ({ beforeTimeSeconds: gap.beforeTimeSeconds + windowContextStart, afterTimeSeconds: gap.afterTimeSeconds + windowContextStart }))
    // Only trust an edit gap whose "before" point falls within THIS
    // window's own core -- same ownership discipline as observations,
    // preventing the same real cut from being reported twice by two
    // overlapping windows.
    .filter((gap) => isWithinCoreInterval(gap.beforeTimeSeconds, window));

  const referenceDependencyCandidates = detectPossibleReferenceDependencyMentions(observations, sourceEvidenceId);

  return { window, segments: [...segmentByIntervalKey.values()], observations, actionCandidates, editGaps, referenceDependencyCandidates };
}

// ---------------------------------------------------------------------
// Global reconciliation across all windows
// ---------------------------------------------------------------------

export interface LongVideoReconciliation {
  readonly segments: readonly VideoLearningSegment[];
  readonly observations: readonly TemporalObservation[];
  readonly actionCandidates: readonly ActionCandidate[];
  readonly editGaps: readonly ReconciledEditGap[];
  readonly referenceDependencyCandidates: readonly ReferenceDependencyRelationship[];
  readonly resultObservationCandidates: readonly TemporalObservation[];
  readonly validationCandidates: readonly TemporalObservation[];
  readonly continuityByBoundary: readonly { readonly beforeWindowId: string; readonly afterWindowId: string; readonly state: CrossWindowContinuityState }[];
}

const EDIT_GAP_MERGE_TOLERANCE_SECONDS = 5;

function mergeEditGaps(perWindowGaps: readonly ReconciledEditGap[]): readonly ReconciledEditGap[] {
  const merged: ReconciledEditGap[] = [];
  for (const gap of perWindowGaps) {
    const duplicate = merged.some((existing) => Math.abs(existing.beforeTimeSeconds - gap.beforeTimeSeconds) <= EDIT_GAP_MERGE_TOLERANCE_SECONDS && Math.abs(existing.afterTimeSeconds - gap.afterTimeSeconds) <= EDIT_GAP_MERGE_TOLERANCE_SECONDS);
    if (!duplicate) merged.push(gap);
  }
  return merged.sort((a, b) => a.beforeTimeSeconds - b.beforeTimeSeconds);
}

function assessBoundaryContinuity(beforeWindow: AnalysisWindow, afterWindow: AnalysisWindow, editGaps: readonly ReconciledEditGap[], actionCandidates: readonly ActionCandidate[], segments: readonly VideoLearningSegment[]): CrossWindowContinuityState {
  const boundaryTime = beforeWindow.coreInterval.timeEndSeconds; // == afterWindow.coreInterval.timeStartSeconds by planner construction

  const spanningGap = editGaps.some((gap) => gap.beforeTimeSeconds <= boundaryTime + EDIT_GAP_MERGE_TOLERANCE_SECONDS && gap.afterTimeSeconds >= boundaryTime - EDIT_GAP_MERGE_TOLERANCE_SECONDS);
  if (spanningGap) return "DISCONTINUOUS_EDITED";

  const segmentInterval = (segmentId: string): VideoTimeInterval => segments.find((s) => s.id === segmentId)!.interval;

  const beforeActions = actionCandidates.filter((a) => segmentInterval(a.segmentIds[0]).timeEndSeconds <= boundaryTime);
  const afterActions = actionCandidates.filter((a) => segmentInterval(a.segmentIds[0]).timeStartSeconds >= boundaryTime);

  const lastBefore = [...beforeActions].sort((a, b) => segmentInterval(b.segmentIds[0]).timeEndSeconds - segmentInterval(a.segmentIds[0]).timeEndSeconds)[0];
  const firstAfter = [...afterActions].sort((a, b) => segmentInterval(a.segmentIds[0]).timeStartSeconds - segmentInterval(b.segmentIds[0]).timeStartSeconds)[0];

  if (lastBefore && firstAfter && lastBefore.kind === firstAfter.kind) return "POSSIBLY_CONTINUES";
  return "UNKNOWN";
}

export function reconcileLongVideoWindows(sourceEvidenceId: string, windows: readonly AnalysisWindow[], rawResultsByWindowId: ReadonlyMap<string, ProfessionalLearningExtractorOutput>, segmentationVersion: string): LongVideoReconciliation {
  const perWindow = windows.map((window) => {
    const raw = rawResultsByWindowId.get(window.id);
    if (!raw) return null;
    return reconcileWindowResult(sourceEvidenceId, window, raw, segmentationVersion);
  });

  const segments = perWindow.flatMap((r) => r?.segments ?? []);
  const observations = perWindow.flatMap((r) => r?.observations ?? []);
  const actionCandidates = perWindow.flatMap((r) => r?.actionCandidates ?? []);
  const editGaps = mergeEditGaps(perWindow.flatMap((r) => r?.editGaps ?? []));
  const referenceDependencyCandidates = perWindow.flatMap((r) => r?.referenceDependencyCandidates ?? []);
  const resultObservationCandidates = detectResultObservationCandidates(observations);
  const validationCandidates = detectValidationCandidates(observations);

  const continuityByBoundary: { beforeWindowId: string; afterWindowId: string; state: CrossWindowContinuityState }[] = [];
  for (let i = 1; i < windows.length; i++) {
    const beforeWindow = windows[i - 1];
    const afterWindow = windows[i];
    continuityByBoundary.push({
      beforeWindowId: beforeWindow.id,
      afterWindowId: afterWindow.id,
      state: assessBoundaryContinuity(beforeWindow, afterWindow, editGaps, actionCandidates, segments),
    });
  }

  return { segments, observations, actionCandidates, editGaps, referenceDependencyCandidates, resultObservationCandidates, validationCandidates, continuityByBoundary };
}
