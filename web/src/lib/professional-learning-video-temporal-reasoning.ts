import { createHash } from "crypto";

import type { ProfessionalLearningExtractedField, ProfessionalLearningExtractionFieldName, ProfessionalLearningProvenanceSource } from "@/lib/professional-learning-draft-validators";
import { isClaimSemanticallyBound } from "@/lib/professional-learning-semantic-binding-guard";
import { computeVideoTimeIntervalOrder, type VideoTimeInterval } from "@/lib/professional-learning-video-temporal";
import type { TemporalObservation } from "@/lib/professional-learning-video-segmentation";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5 -- TEMPORAL
// PROFESSIONAL REASONING. Pure, no I/O, no database, ZERO real AI calls.
//
// THE ABSOLUTE INVARIANT THIS FILE EXISTS TO ENFORCE:
//   AN ACTION IS NOT DEMONSTRATED UNTIL ITS EFFECT IS VISIBLE AND
//   VERIFIABLE.
//
// STRUCTURAL "!=" RULES ENFORCED BY THIS FILE'S OWN TYPE SHAPES -- each is
// a genuinely distinct type/field, so conflating two of them is a type
// error, not merely a documented convention:
//   SEGMENT != STEP / SKILL / GENERATION SCENE -- enforced in
//     professional-learning-video-segmentation.ts (VideoLearningSegment
//     has zero imports from the Skill Engine's execution/scene layer);
//     this file only ever references segments by their opaque id string.
//   OBSERVATION != ACTION -- TemporalObservation is evidence; ActionCandidate
//     below is a separate, explicitly-authored interpretation that
//     REFERENCES observation ids, never IS one.
//   ACTION != COMPLETION -- ActionCandidate alone carries no completion
//     state; only assessZoneCompletion (fed by explicit repetition /
//     progression / result / validation evidence) can produce COMPLETED,
//     and only when ALL of those are actually supplied.
//   RESULT != PROCEDURE -- ResultObservation is its own type, structurally
//     unrelated to ActionCandidate; nothing here derives one from the
//     other.
//   TEMPORAL ORDER != CAUSALITY -- assessEffect's "SUPPORTED" status is
//     never named/described as causal; it means only "a before/action/
//     after triple exists with no declared continuity break," nothing
//     stronger.
//   LEARNING SEGMENT != GENERATION SCENE -- see SEGMENT rule above; this
//     file has zero imports from professional-execution-scene-*.ts.
//
// SEMANTIC BINDING INTEGRATION (Section 31/47/60): bindTemporalProfessionalFieldClaim
// below reuses isClaimSemanticallyBound (professional-learning-semantic-
// binding-guard.ts) VERBATIM -- the exact same 9-field term-group table
// Stage 8.5L4.R2.2 already built. This file adds ZERO new entries to that
// table and builds NO second lexical rule table for the 32-field
// extraction vocabulary. A temporal observation proposing a specific
// technical field value (e.g. "strand visibly moves upward" -> elevation
// = 90 degrees) is gated through the identical guard an image observation
// already goes through -- it cannot bypass semantic binding merely
// because it originated from a video segment rather than a still image.
//
// TEMPORAL SUPPORT (Section 32): audited and deliberately NOT modeled as
// a third standalone persisted enum alongside SOURCE SUPPORT/SEMANTIC
// SUPPORT. It is represented implicitly, as the `status` field on each
// higher-level assessment below (ProgressionAssessment.status,
// EffectAssessment.status) -- "SUPPORTED" there always specifically means
// "sufficient temporal (and, for progression, spatial) evidence connects
// these events," distinct from SEMANTIC SUPPORT (does a claim's chosen
// field name match what was observed) and SOURCE SUPPORT (was something
// genuinely observed at all). No new persisted model was needed to keep
// these three questions distinguishable.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO (Section 13/44/65): it does not
// classify an ActionCandidate's `kind` ("cutting"/"combing"/...) or a
// ValidationCandidate's professional appropriateness from raw text. That
// would require inventing a SECOND lexical rule table (one for temporal
// action/validation vocabulary) alongside R2.2's field-vocabulary table --
// exactly the "giant rule table" Section 60 forbids building in this
// stage. Both `kind` and `semanticallySupported` are supplied by the
// caller (a future real extractor's own bound proposal, or an explicit
// professional annotation/fixture) -- this file only reasons
// STRUCTURALLY over already-asserted candidates (repetition/progression/
// completion/effect), it never invents the classification itself. A
// generic, caller-supplied action candidate is safer than a false
// precise technique (Section 13).

// ---------------------------------------------------------------------
// Action candidate (Section 13/14/29/30)
// ---------------------------------------------------------------------

export const ACTION_BOUNDARY_STATES = ["KNOWN", "APPROXIMATE", "UNKNOWN"] as const;
export type ActionBoundaryState = (typeof ACTION_BOUNDARY_STATES)[number];

export function isActionBoundaryState(value: unknown): value is ActionBoundaryState {
  return typeof value === "string" && (ACTION_BOUNDARY_STATES as readonly string[]).includes(value);
}

export interface ActionCandidate {
  readonly id: string;
  // Multi-segment action support (Section 29): one action may span
  // several segments (e.g. a camera cut mid-action).
  readonly segmentIds: readonly string[];
  // Multi-action-per-segment support (Section 30): observationIds live on
  // the candidate, never embedded 1:1 inside a segment.
  readonly observationIds: readonly string[];
  // Open, caller-supplied label -- see file header. Never classified here.
  readonly kind: string;
  readonly startBoundary: ActionBoundaryState;
  readonly endBoundary: ActionBoundaryState;
}

// Deterministic/idempotent (Section 9/50): identical (segments,
// observations, kind) always yields the identical id, so reprocessing
// never creates a duplicate candidate. Two candidates of the same kind
// spanning the same segments but supported by DIFFERENT observations
// legitimately receive different ids.
export function computeActionCandidateId(segmentIds: readonly string[], observationIds: readonly string[], kind: string): string {
  const canonical = `${[...segmentIds].sort().join(",")}|${[...observationIds].sort().join(",")}|${kind}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function createActionCandidate(
  segmentIds: readonly string[],
  observationIds: readonly string[],
  kind: string,
  startBoundary: ActionBoundaryState,
  endBoundary: ActionBoundaryState,
): ActionCandidate {
  return { id: computeActionCandidateId(segmentIds, observationIds, kind), segmentIds, observationIds, kind, startBoundary, endBoundary };
}

// ---------------------------------------------------------------------
// Semantic binding integration (Section 12/31/47/60)
// ---------------------------------------------------------------------

// Mirrors the exact downgrade shape professional-learning-semantic-
// binding-guard.ts's own applySemanticBindingGuard produces for image
// evidence -- {value: null, source: "UNKNOWN", rawObservation?} -- so a
// video-derived claim and an image-derived claim that fail semantic
// binding are indistinguishable in shape to any downstream reviewer/UI.
// PROFESSIONAL_INPUT and UNKNOWN are exempt, exactly like the guard.
export function bindTemporalProfessionalFieldClaim(
  field: ProfessionalLearningExtractionFieldName,
  value: unknown,
  source: ProfessionalLearningProvenanceSource,
  note?: string,
): ProfessionalLearningExtractedField {
  if (source === "PROFESSIONAL_INPUT" || source === "UNKNOWN") {
    return { value, source, ...(note !== undefined ? { note } : {}) };
  }
  if (isClaimSemanticallyBound(field, value, note)) {
    return { value, source, ...(note !== undefined ? { note } : {}) };
  }
  const observationParts = [typeof value === "string" ? value : null, note ?? null].filter((part): part is string => Boolean(part && part.length > 0));
  const rawObservation = observationParts.length > 0 ? observationParts.join(" -- ") : undefined;
  return { value: null, source: "UNKNOWN", ...(rawObservation ? { rawObservation } : {}) };
}

// ---------------------------------------------------------------------
// Repetition (Section 15) -- REPETITION != COMPLETION unless the intended
// scope is established. `declaredScopeSize` must be explicitly supplied
// by the caller (a professional annotation or a future extractor's own
// bound claim about the intended zone size) -- this function never
// invents or guesses it.
// ---------------------------------------------------------------------

export interface RepetitionAssessment {
  readonly occurrenceActionCandidateIds: readonly string[];
  readonly declaredScopeSize?: number;
  readonly scopeEstablished: boolean;
}

export function assessRepetition(actionCandidates: readonly ActionCandidate[], kind: string, declaredScopeSize?: number): RepetitionAssessment {
  const occurrenceActionCandidateIds = actionCandidates.filter((candidate) => candidate.kind === kind).map((candidate) => candidate.id);
  const scopeEstablished = declaredScopeSize !== undefined && occurrenceActionCandidateIds.length >= declaredScopeSize;
  return { occurrenceActionCandidateIds, ...(declaredScopeSize !== undefined ? { declaredScopeSize } : {}), scopeEstablished };
}

// ---------------------------------------------------------------------
// Progression (Section 16) -- requires BOTH temporal AND spatial support.
// Disconnected camera shots must never be read as progression.
// ---------------------------------------------------------------------

export const PROGRESSION_STATUSES = ["SUPPORTED", "UNKNOWN"] as const;
export type ProgressionStatus = (typeof PROGRESSION_STATUSES)[number];

export interface ZoneVisit {
  readonly zoneId: string;
  readonly segmentId: string;
  readonly interval: VideoTimeInterval;
  // Declared, never inferred (Section 16): true only when the caller
  // explicitly asserts this zone is spatially adjacent to the PREVIOUS
  // entry in the sequence. The first entry's own value is ignored
  // (nothing precedes it). Future compatibility: `zoneId` is an opaque
  // string deliberately compatible with a future TechnicalVisualMap/
  // SpatialBinding zone identifier without importing or coupling to it
  // now (Section 18).
  readonly adjacentToPrevious: boolean;
}

export interface ProgressionAssessment {
  readonly status: ProgressionStatus;
  readonly zoneSequence: readonly string[];
}

export function assessProgression(zoneVisits: readonly ZoneVisit[]): ProgressionAssessment {
  const zoneSequence = zoneVisits.map((visit) => visit.zoneId);
  if (zoneVisits.length < 2) return { status: "UNKNOWN", zoneSequence };

  for (let i = 1; i < zoneVisits.length; i++) {
    const previous = zoneVisits[i - 1];
    const current = zoneVisits[i];
    if (computeVideoTimeIntervalOrder(previous.interval, current.interval) !== "BEFORE") return { status: "UNKNOWN", zoneSequence };
    if (!current.adjacentToPrevious) return { status: "UNKNOWN", zoneSequence };
  }
  return { status: "SUPPORTED", zoneSequence };
}

// ---------------------------------------------------------------------
// Zone completion (Section 17/18) -- ONE ACTION/SUBSECTION != COMPLETION.
// Never inferred from: video cuts away, operator stops, scene ends,
// camera changes, tool put down (Section 17's explicit list) -- none of
// those signals appear anywhere in this input shape, so they structurally
// cannot influence this function's answer.
// ---------------------------------------------------------------------

export const ZONE_COMPLETION_STATES = ["NOT_ESTABLISHED", "IN_PROGRESS", "COMPLETED", "UNKNOWN"] as const;
export type ZoneCompletionState = (typeof ZONE_COMPLETION_STATES)[number];

export function isZoneCompletionState(value: unknown): value is ZoneCompletionState {
  return typeof value === "string" && (ZONE_COMPLETION_STATES as readonly string[]).includes(value);
}

export interface ZoneCompletionInput {
  readonly repetition: RepetitionAssessment;
  readonly progression: ProgressionAssessment;
  readonly resultObservationPresent: boolean;
  readonly validationPresent: boolean;
}

export function assessZoneCompletion(input: ZoneCompletionInput): ZoneCompletionState {
  const { repetition, progression, resultObservationPresent, validationPresent } = input;
  if (repetition.occurrenceActionCandidateIds.length === 0) return "NOT_ESTABLISHED";
  if (repetition.scopeEstablished && progression.status === "SUPPORTED" && resultObservationPresent && validationPresent) return "COMPLETED";
  if (!repetition.scopeEstablished && progression.status === "UNKNOWN") return "UNKNOWN";
  return "IN_PROGRESS";
}

// ---------------------------------------------------------------------
// State before / action / state after, and effect (Section 19/20) --
// TEMPORAL ORDER != CAUSALITY. `continuityBroken` must be explicitly
// declared by the caller (Section 24/25/26 -- video edit points are not
// auto-detected from time math in this stage). "SUPPORTED" never means "A
// caused B" -- it means only "a before/action/after triple exists with no
// declared continuity break between them."
// ---------------------------------------------------------------------

export const EFFECT_STATUSES = ["SUPPORTED", "UNKNOWN"] as const;
export type EffectStatus = (typeof EFFECT_STATUSES)[number];

export interface EffectAssessment {
  readonly status: EffectStatus;
  readonly beforeObservationId: string | null;
  readonly actionCandidateId: string;
  readonly afterObservationId: string | null;
}

export function assessEffect(before: TemporalObservation | null, action: ActionCandidate, after: TemporalObservation | null, continuityBroken: boolean): EffectAssessment {
  const status: EffectStatus = before !== null && after !== null && !continuityBroken ? "SUPPORTED" : "UNKNOWN";
  return { status, beforeObservationId: before?.id ?? null, actionCandidateId: action.id, afterObservationId: after?.id ?? null };
}

// ---------------------------------------------------------------------
// Result observation (Section 21) -- RESULT != PROCEDURE. Structurally
// separate type; nothing in this file derives one from an ActionCandidate
// or vice versa.
// ---------------------------------------------------------------------

export interface ResultObservation {
  readonly id: string;
  readonly segmentId: string;
  readonly description: string;
  readonly provenance: ProfessionalLearningProvenanceSource;
}

// ---------------------------------------------------------------------
// Validation candidate (Section 22/44) -- ACTION != VALIDATION.
// `semanticallySupported` is caller-declared (see file header) -- this
// module never classifies validation behavior from raw text; building a
// keyword table for it would be exactly the "giant rule table" expansion
// Section 60 forbids in this stage.
// ---------------------------------------------------------------------

export interface ValidationCandidate {
  readonly id: string;
  readonly segmentId: string;
  readonly description: string;
  readonly provenance: ProfessionalLearningProvenanceSource;
  readonly semanticallySupported: boolean;
}

// ---------------------------------------------------------------------
// Core completion chain (Section 23) -- a reporting-only summary; a
// missing stage is always represented as NOT_OBSERVED, never fabricated.
// ---------------------------------------------------------------------

export const CORE_COMPLETION_CHAIN_STAGES = ["START", "ACTION", "PROGRESSION", "ITERATION", "ZONE_COMPLETE", "RESULT", "VALIDATION"] as const;
export type CoreCompletionChainStage = (typeof CORE_COMPLETION_CHAIN_STAGES)[number];

export interface CoreCompletionChainInput {
  readonly startObserved: boolean;
  readonly actionObserved: boolean;
  readonly progression: ProgressionAssessment;
  readonly repetition: RepetitionAssessment;
  readonly zoneCompletion: ZoneCompletionState;
  readonly resultObservationPresent: boolean;
  readonly validationPresent: boolean;
}

export function summarizeCoreCompletionChain(input: CoreCompletionChainInput): Readonly<Record<CoreCompletionChainStage, "OBSERVED" | "NOT_OBSERVED">> {
  return {
    START: input.startObserved ? "OBSERVED" : "NOT_OBSERVED",
    ACTION: input.actionObserved ? "OBSERVED" : "NOT_OBSERVED",
    PROGRESSION: input.progression.status === "SUPPORTED" ? "OBSERVED" : "NOT_OBSERVED",
    ITERATION: input.repetition.occurrenceActionCandidateIds.length > 1 ? "OBSERVED" : "NOT_OBSERVED",
    ZONE_COMPLETE: input.zoneCompletion === "COMPLETED" ? "OBSERVED" : "NOT_OBSERVED",
    RESULT: input.resultObservationPresent ? "OBSERVED" : "NOT_OBSERVED",
    VALIDATION: input.validationPresent ? "OBSERVED" : "NOT_OBSERVED",
  };
}

// ---------------------------------------------------------------------
// Continuity / video edit gaps (Section 24/25/26) -- declared only, never
// auto-detected from timestamps: edit points, speed changes, and camera
// cuts are not reliably inferable from interval arithmetic alone, and
// this stage does not attempt to.
// ---------------------------------------------------------------------

export interface DeclaredContinuityBreak {
  readonly beforeSegmentId: string;
  readonly afterSegmentId: string;
}

export function isContinuityBrokenBetween(beforeSegmentId: string, afterSegmentId: string, declaredBreaks: readonly DeclaredContinuityBreak[]): boolean {
  return declaredBreaks.some((gap) => gap.beforeSegmentId === beforeSegmentId && gap.afterSegmentId === afterSegmentId);
}
