import type {
  CuttingTechnique,
  StructuralTechnique,
  TechnicalCutElevation,
  TechnicalCutGuideline,
  TechnicalCutSectioning,
  TexturizingTechnique,
} from "@/lib/contracts";
import {
  CUTTING_TECHNIQUES,
  ELEVATION_OPTIONS,
  GUIDELINE_OPTIONS,
  isOneOf,
  isStringArray,
  SECTIONING_OPTIONS,
  STRUCTURAL_TECHNIQUES,
  TEXTURIZING_TECHNIQUES,
} from "@/lib/proposal-validators";
import { HEAD_ZONES, isHeadZone, isRecord, type HeadZone } from "@/lib/technical-visual-map-validators";
import { isProvenanceValue, isTechnicalDemonstrationVertical, type TechnicalDemonstrationProvenanceValue } from "@/lib/technical-demonstration-contracts";

// Technical Demonstration, Stage 1 -- the CUTTING-SPECIFIC step payload
// shape + validator ("shared Technical Demonstration envelope + cutting-
// specific payload validator", Decision Lock's own required pattern). No
// other vertical's payload shape is defined here or anywhere else yet
// (Color/Styling/Treatment/Nails/Makeup are explicitly out of Stage 1's
// scope) -- a future vertical gets its own sibling file, never a branch
// added to this one.
//
// FIELD COVERAGE, decided honestly against what Stage 1's own deterministic
// derivation (technical-demonstration-derivation.ts) can actually source
// from a CONFIRMED AnalysisProposal's TechnicalCutPlan -- not every field
// the Decision Lock's own Cutting V1 list names gets an independent
// column: several of that list's concepts are genuinely the SAME
// underlying fact (perimeter/fringe work is already fully captured by
// `zones` including "fringe"; graduation/layers is already fully captured
// by `structuralTechnique` naming graduation/compact_graduation/
// precision_layering/internal_layering directly) -- inventing a second,
// redundant field for the same fact would not add real information, only
// the appearance of more coverage. Fields with genuinely no source in
// Stage 1's own data (finger position, exact cutting angle/line in
// degrees, head/body positioning, subsectioning, zone connection order
// beyond stepNumber, cross-check, styling/finish) are still represented,
// honestly, as always-UNKNOWN slots -- present in the shape so a later UI
// stage can show them as "needs professional completion", never silently
// omitted.
//
// Stage 2.5.a ("Cutting V1 -- professional execution step foundation")
// additive extension, per the completed Stage 2.5 architectural audit:
// adds `phase` (the execution-phase distinction the audit found missing --
// see technical-demonstration-derivation.ts's own header comment on the
// phase-vs-zone fix) and a small set of new, honestly-UNKNOWN-in-Stage-1
// execution fields (subsectionThickness, fingerAngle, toolOrientation,
// progression, stateBefore, stateAfter) that the audit's Cutting V1
// Execution Schema recommended as genuine, distinct concepts -- never one
// giant speculative schema, only the fields the audit could name a real
// future source for. Bumped from 1.0.0-td1 -- existing persisted rows keep
// their own original stepSchemaVersion forever (never silently upgraded,
// same discipline as generatorVersion) and are never re-validated against
// this newer shape on read (see technical-demonstration-repository.ts's
// own toTechnicalDemonstrationStepRecord, which never calls this file's
// validator) -- only a NEWLY derived step is ever checked against it.
export const CUTTING_DEMONSTRATION_STEP_SCHEMA_VERSION = "1.1.0-td25a";

// ---------------------------------------------------------------------------
// Execution phases -- Stage 2.5.a's own core addition. A CLOSED, minimal
// vocabulary (5 phases, not the 10 a naive reading of the audit's own
// illustrative list might suggest -- the audit explicitly recommended
// against manufacturing empty phases). Deterministically derived (never
// guessed) from the cutting engine's own fixed, closed set of step "zone"
// labels (see technical-demonstration-derivation.ts's own PHASE_LABEL_LOOKUP)
// -- an unrecognized label honestly resolves to no phase at all
// (TechnicalDemonstrationProvenanceValue's own UNKNOWN), never a guess.
// ---------------------------------------------------------------------------

export const CUTTING_EXECUTION_PHASES = [
  "PREPARATION_AND_SECTIONING",
  "GUIDE_AND_STRUCTURE",
  "STRUCTURAL_CUTTING",
  "REFINEMENT_TEXTURIZING",
  "CROSS_CHECK_AND_FINISH",
] as const;
export type CuttingExecutionPhase = (typeof CUTTING_EXECUTION_PHASES)[number];

export function isCuttingExecutionPhase(value: unknown): value is CuttingExecutionPhase {
  return typeof value === "string" && (CUTTING_EXECUTION_PHASES as readonly string[]).includes(value);
}

// Cross-step structural check (NOT part of isValidCuttingDemonstrationStepPayload,
// which only ever validates ONE step in isolation): a step's own recognized
// phase must never come BEFORE an earlier step's own recognized phase, in
// this canonical order -- e.g. a STRUCTURAL_CUTTING-phase step can never
// precede a PREPARATION_AND_SECTIONING-phase step. An UNKNOWN phase (`null`)
// never violates ordering either way -- we cannot detect a contradiction in
// data we honestly don't have an opinion about; this only ever catches a
// GENUINE, deterministically-detectable regression among steps whose phase
// IS known. Repeats and gaps are both fine (a plan may have two
// STRUCTURAL_CUTTING-phase steps in a row, or skip GUIDE_AND_STRUCTURE
// entirely) -- only backward movement is rejected.
export function isValidCuttingExecutionPhaseSequence(phases: readonly (CuttingExecutionPhase | null)[]): boolean {
  let lastIndex = -1;
  for (const phase of phases) {
    if (phase === null) continue;
    const index = CUTTING_EXECUTION_PHASES.indexOf(phase);
    if (index < lastIndex) return false;
    lastIndex = index;
  }
  return true;
}

export interface CuttingDemonstrationStepPayload {
  // OBSERVED -- copied verbatim from this step's own source CuttingStep.zone.
  zones: TechnicalDemonstrationProvenanceValue<HeadZone[]>;
  // OBSERVED -- copied verbatim from this step's own source
  // CuttingStep.elevationAngle, but ONLY on the STRUCTURAL_CUTTING-phase
  // step. RELEASE-BLOCKER FIX, corrected from an earlier "already
  // step-scoped by construction" classification that turned out to be
  // wrong: being read from sourceStep.elevationAngle does NOT mean the
  // value genuinely varies per step -- Cutting V1's engine sets the exact
  // same plan-wide elevation on EVERY step's own record (proven live: real
  // engine output traced through real derivation showed identical
  // elevation on preparation/guide/structural/refinement/cross-check
  // alike). Phase-scoped the same way as the seven plan-level fields
  // below (see FIELD_APPLICABLE_PHASES.elevation, technical-demonstration-
  // derivation.ts) -- UNKNOWN on every other phase, never a fabricated
  // "no elevation" default and never a copy of the structural cut's own
  // value onto an unrelated action.
  elevation: TechnicalDemonstrationProvenanceValue<TechnicalCutElevation>;
  // OBSERVED -- copied verbatim from this step's own source
  // CuttingStep.toolRequired, unconditionally, on every step -- unlike
  // `elevation` above, `tool` genuinely varies per step in Cutting V1's
  // real engine output today (tail-comb / straight-shear / texturizer-
  // shear / finishing-comb), re-verified live during the elevation
  // blocker fix -- never phase-gated, deliberately left unchanged.
  tool: TechnicalDemonstrationProvenanceValue<string>;

  // Stage 2.5.a -- the execution phase this step belongs to. INFERRED when
  // this step's own source zone label is one of the cutting engine's known
  // phase labels (see technical-demonstration-derivation.ts's own
  // PHASE_LABEL_LOOKUP); UNKNOWN otherwise -- never guessed from position
  // or step count. This is the field that lets a reader correctly
  // distinguish "which phase of execution is this" from "which anatomical
  // zone is this" (`zones` above) -- the two are never the same fact, and
  // Stage 1's own engine output (a phase label sitting in a `zone`-named
  // source field) is exactly the confusion this field exists to resolve
  // without ever reinterpreting that label AS a zone.
  phase: TechnicalDemonstrationProvenanceValue<CuttingExecutionPhase>;

  // INFERRED -- plan-level fields, propagated to a step ONLY when that
  // step's own resolved `phase` (above) is genuinely where this fact is
  // true (see technical-demonstration-derivation.ts's own
  // FIELD_APPLICABLE_PHASES table) -- e.g. `structuralTechnique` only ever
  // appears on a STRUCTURAL_CUTTING-phase step, never smeared onto a
  // REFINEMENT_TEXTURIZING-phase step merely because the plan globally
  // uses that structural technique somewhere. When `phase` itself is
  // UNKNOWN (an unrecognized source label), every field below is
  // correctly UNKNOWN too -- we cannot honestly claim a plan-level fact
  // applies to a step whose own execution phase we don't even know.
  // RELEASE-BLOCKER FIX (Stage 1, still in force): PROFESSIONAL_OVERRIDE
  // instead of INFERRED whenever this exact field name is one of
  // AnalysisProposal.edits' own edited fields -- derived from the
  // EFFECTIVE plan (baseline + edits merged), never the raw frozen
  // baseline alone. See technical-demonstration-derivation.ts's own
  // header comment.
  sectioning: TechnicalDemonstrationProvenanceValue<TechnicalCutSectioning>;
  guideType: TechnicalDemonstrationProvenanceValue<TechnicalCutGuideline>;
  structuralTechnique: TechnicalDemonstrationProvenanceValue<StructuralTechnique>;
  cuttingTechnique: TechnicalDemonstrationProvenanceValue<CuttingTechnique>;
  texturizingTechnique: TechnicalDemonstrationProvenanceValue<TexturizingTechnique>;
  // INFERRED (or PROFESSIONAL_OVERRIDE -- see above), phase-scoped like the
  // rest of this block -- deterministically mapped from the plan-level
  // `distribution` field (e.g. overdirected_back/overdirected_forward ->
  // a real combing direction description; natural_fall/perpendicular ->
  // "as the hair naturally falls"/"straight out from the head"). See
  // technical-demonstration-derivation.ts's own mapping table. Carries
  // PROFESSIONAL_OVERRIDE whenever `distribution` itself was edited.
  combingDirection: TechnicalDemonstrationProvenanceValue<string>;
  // INFERRED (or PROFESSIONAL_OVERRIDE), phase-scoped -- true iff
  // `distribution` is one of the two overdirected values; false for the
  // other three, on a step whose phase supports this fact; UNKNOWN
  // (never a fabricated false) on a step whose phase does not.
  overdirection: TechnicalDemonstrationProvenanceValue<boolean>;

  // UNKNOWN in Stage 1/2.5.a -- no source data exists for these yet.
  // Present so a later UI/professional-input stage can honestly show "not
  // yet available" rather than omit the concept entirely.
  //
  // DEPRECATED (Stage 2.5.c domain-model correction): this single field
  // was found, during the Stage 2.5.c professional review, to conflate two
  // genuinely distinct concepts -- the CLIENT's physical head position
  // during execution vs. the OBSERVATION viewpoint used to check/demonstrate
  // a result -- which must never be treated as equivalent (a stylist's own
  // body posture is neither of these and was never represented here
  // either). Kept unchanged, additive-only, purely for backward
  // compatibility with any already-recorded baseline/professional-override
  // data (this field's own persisted history is never rewritten or
  // deleted) -- never required by the Stage 2.5.c readiness gate, and no
  // longer the field new professional input should target. See
  // `clientHeadPosition` and `observationView` below, the two real,
  // separate replacements.
  headBodyPositioning: TechnicalDemonstrationProvenanceValue<string>;
  // Stage 2.5.c -- replaces headBodyPositioning's "client/head" half.
  // Physical position of the CLIENT's head required for correct/safe
  // execution (e.g. neutral/upright, chin down, chin slightly raised,
  // head tilted, controlled rotation) -- relevant DURING an execution
  // action, never during a pure observation/check.
  clientHeadPosition: TechnicalDemonstrationProvenanceValue<string>;
  // Stage 2.5.c -- replaces headBodyPositioning's "viewpoint" half.
  // The OBSERVATION/CHECK viewpoint required to see or demonstrate the
  // result correctly (e.g. front, back, profile, left/right comparison,
  // three-quarter) -- deliberately never conflated with clientHeadPosition
  // above: one describes the CLIENT during execution, the other describes
  // how the RESULT is being looked at.
  observationView: TechnicalDemonstrationProvenanceValue<string>;
  fingerPosition: TechnicalDemonstrationProvenanceValue<string>;
  // Stage 2.5.a -- a distinct concept from fingerPosition (WHERE the
  // fingers are placed vs. AT WHAT ANGLE they hold the section); kept as
  // its own field rather than folded in, matching the audit's own field
  // list.
  fingerAngle: TechnicalDemonstrationProvenanceValue<string>;
  cuttingAngle: TechnicalDemonstrationProvenanceValue<string>;
  cuttingLine: TechnicalDemonstrationProvenanceValue<string>;
  subsectioning: TechnicalDemonstrationProvenanceValue<string>;
  // Stage 2.5.a -- section thickness, a distinct concept from
  // `subsectioning` itself (WHICH subsection vs. HOW THICK it is).
  subsectionThickness: TechnicalDemonstrationProvenanceValue<string>;
  // Stage 2.5.a -- tool orientation is a distinct fact from `tool` (WHICH
  // tool vs. HOW it is held/angled).
  toolOrientation: TechnicalDemonstrationProvenanceValue<string>;
  // Stage 2.5.a -- deliberately ONE field covering both "progression
  // within the zone" and "progression between zones" from the audit's own
  // field list: in practice these are the same underlying fact (how the
  // professional moves through the work), and splitting them into two
  // near-duplicate fields would repeat the exact "meaningless field bag"
  // anti-pattern this file's own header comment already warns against for
  // perimeter/fringe and graduation/layers.
  progression: TechnicalDemonstrationProvenanceValue<string>;
  zoneConnection: TechnicalDemonstrationProvenanceValue<string>;
  crossCheck: TechnicalDemonstrationProvenanceValue<boolean>;
  styling: TechnicalDemonstrationProvenanceValue<string>;

  // Stage 2.5.a -- STATE BEFORE -> ACTION -> STATE AFTER. `explanation`
  // (DerivedCuttingDemonstrationStep, technical-demonstration-derivation.ts)
  // already carries the ACTION half of this triad (the source step's own
  // free-text `action`, structurally separate from this payload); these
  // two fields exist so a future stage can express the BEFORE/AFTER halves
  // with the same honest provenance discipline as everything else here.
  // Always UNKNOWN in Stage 2.5.a -- no source data exists to populate
  // either honestly yet; this stage establishes the domain representation
  // only, never fabricated content (this stage's own explicit boundary).
  stateBefore: TechnicalDemonstrationProvenanceValue<string>;
  stateAfter: TechnicalDemonstrationProvenanceValue<string>;

  // OBSERVED -- copied verbatim from the confirmed proposal's own
  // warnings + contraindications (never re-derived, never a subset
  // filtered by zone -- Stage 1 keeps this simple and honest: the whole
  // confirmed safety context rides along on every step). Plain array, not
  // provenance-wrapped -- a constraint is either present (from real
  // confirmed data) or the array is empty; there is no meaningful
  // "UNKNOWN constraint" state to represent.
  constraints: string[];
}

function isProvenanceHeadZoneArray(value: unknown): value is TechnicalDemonstrationProvenanceValue<HeadZone[]> {
  return isProvenanceValue(value, (candidate): candidate is HeadZone[] => Array.isArray(candidate) && candidate.length > 0 && candidate.every(isHeadZone));
}

function isProvenanceString(value: unknown): value is TechnicalDemonstrationProvenanceValue<string> {
  return isProvenanceValue(value, (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
}

function isProvenanceBoolean(value: unknown): value is TechnicalDemonstrationProvenanceValue<boolean> {
  return isProvenanceValue(value, (candidate): candidate is boolean => typeof candidate === "boolean");
}

export function isValidCuttingDemonstrationStepPayload(value: unknown): value is CuttingDemonstrationStepPayload {
  if (!isRecord(value)) return false;
  return (
    isProvenanceHeadZoneArray(value.zones) &&
    isProvenanceValue(value.elevation, (c): c is TechnicalCutElevation => isOneOf(c, ELEVATION_OPTIONS)) &&
    isProvenanceString(value.tool) &&
    isProvenanceValue(value.phase, isCuttingExecutionPhase) &&
    isProvenanceValue(value.sectioning, (c): c is TechnicalCutSectioning => isOneOf(c, SECTIONING_OPTIONS)) &&
    isProvenanceValue(value.guideType, (c): c is TechnicalCutGuideline => isOneOf(c, GUIDELINE_OPTIONS)) &&
    isProvenanceValue(value.structuralTechnique, (c): c is StructuralTechnique => isOneOf(c, STRUCTURAL_TECHNIQUES)) &&
    isProvenanceValue(value.cuttingTechnique, (c): c is CuttingTechnique => isOneOf(c, CUTTING_TECHNIQUES)) &&
    isProvenanceValue(value.texturizingTechnique, (c): c is TexturizingTechnique => isOneOf(c, TEXTURIZING_TECHNIQUES)) &&
    isProvenanceString(value.combingDirection) &&
    isProvenanceBoolean(value.overdirection) &&
    isProvenanceString(value.headBodyPositioning) &&
    isProvenanceString(value.clientHeadPosition) &&
    isProvenanceString(value.observationView) &&
    isProvenanceString(value.fingerPosition) &&
    isProvenanceString(value.fingerAngle) &&
    isProvenanceString(value.cuttingAngle) &&
    isProvenanceString(value.cuttingLine) &&
    isProvenanceString(value.subsectioning) &&
    isProvenanceString(value.subsectionThickness) &&
    isProvenanceString(value.toolOrientation) &&
    isProvenanceString(value.progression) &&
    isProvenanceString(value.zoneConnection) &&
    isProvenanceBoolean(value.crossCheck) &&
    isProvenanceString(value.styling) &&
    isProvenanceString(value.stateBefore) &&
    isProvenanceString(value.stateAfter) &&
    isStringArray(value.constraints)
  );
}

// Re-exported so a caller only ever needs one import for "is this a
// Stage-1-supported vertical" -- avoids duplicating
// isTechnicalDemonstrationVertical's own single-vertical check.
export { isTechnicalDemonstrationVertical, HEAD_ZONES };
