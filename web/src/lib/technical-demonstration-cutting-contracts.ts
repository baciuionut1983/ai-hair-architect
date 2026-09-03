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
export const CUTTING_DEMONSTRATION_STEP_SCHEMA_VERSION = "1.0.0-td1";

export interface CuttingDemonstrationStepPayload {
  // OBSERVED -- copied verbatim from this step's own source CuttingStep.zone.
  zones: TechnicalDemonstrationProvenanceValue<HeadZone[]>;
  // OBSERVED -- copied verbatim from this step's own source CuttingStep.elevationAngle.
  elevation: TechnicalDemonstrationProvenanceValue<TechnicalCutElevation>;
  // OBSERVED -- copied verbatim from this step's own source CuttingStep.toolRequired.
  tool: TechnicalDemonstrationProvenanceValue<string>;

  // INFERRED -- plan-level fields propagated uniformly to every step
  // (a deterministic "this policy applies throughout" rule, not a
  // per-step fact literally stated in the source data). RELEASE-BLOCKER
  // FIX: PROFESSIONAL_OVERRIDE instead of INFERRED whenever this exact
  // field name is one of AnalysisProposal.edits' own edited fields --
  // derived from the EFFECTIVE plan (baseline + edits merged), never the
  // raw frozen baseline alone. See technical-demonstration-derivation.ts's
  // own header comment.
  sectioning: TechnicalDemonstrationProvenanceValue<TechnicalCutSectioning>;
  guideType: TechnicalDemonstrationProvenanceValue<TechnicalCutGuideline>;
  structuralTechnique: TechnicalDemonstrationProvenanceValue<StructuralTechnique>;
  cuttingTechnique: TechnicalDemonstrationProvenanceValue<CuttingTechnique>;
  texturizingTechnique: TechnicalDemonstrationProvenanceValue<TexturizingTechnique>;
  // INFERRED (or PROFESSIONAL_OVERRIDE -- see above) -- deterministically
  // mapped from the plan-level `distribution` field (e.g.
  // overdirected_back/overdirected_forward -> a real combing direction
  // description; natural_fall/perpendicular -> "as the hair naturally
  // falls"/"straight out from the head"). See
  // technical-demonstration-derivation.ts's own mapping table. Carries
  // PROFESSIONAL_OVERRIDE whenever `distribution` itself was edited.
  combingDirection: TechnicalDemonstrationProvenanceValue<string>;
  // INFERRED (or PROFESSIONAL_OVERRIDE) -- true iff `distribution` is one
  // of the two overdirected values; false for the other three; never
  // UNKNOWN, since `distribution` is always present on a valid
  // TechnicalCutPlan.
  overdirection: TechnicalDemonstrationProvenanceValue<boolean>;

  // UNKNOWN in Stage 1 -- no source data exists for these yet. Present so
  // a later UI stage can honestly show "not yet available" rather than
  // omit the concept entirely.
  headBodyPositioning: TechnicalDemonstrationProvenanceValue<string>;
  fingerPosition: TechnicalDemonstrationProvenanceValue<string>;
  cuttingAngle: TechnicalDemonstrationProvenanceValue<string>;
  cuttingLine: TechnicalDemonstrationProvenanceValue<string>;
  subsectioning: TechnicalDemonstrationProvenanceValue<string>;
  zoneConnection: TechnicalDemonstrationProvenanceValue<string>;
  crossCheck: TechnicalDemonstrationProvenanceValue<boolean>;
  styling: TechnicalDemonstrationProvenanceValue<string>;

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
    isProvenanceValue(value.sectioning, (c): c is TechnicalCutSectioning => isOneOf(c, SECTIONING_OPTIONS)) &&
    isProvenanceValue(value.guideType, (c): c is TechnicalCutGuideline => isOneOf(c, GUIDELINE_OPTIONS)) &&
    isProvenanceValue(value.structuralTechnique, (c): c is StructuralTechnique => isOneOf(c, STRUCTURAL_TECHNIQUES)) &&
    isProvenanceValue(value.cuttingTechnique, (c): c is CuttingTechnique => isOneOf(c, CUTTING_TECHNIQUES)) &&
    isProvenanceValue(value.texturizingTechnique, (c): c is TexturizingTechnique => isOneOf(c, TEXTURIZING_TECHNIQUES)) &&
    isProvenanceString(value.combingDirection) &&
    isProvenanceBoolean(value.overdirection) &&
    isProvenanceString(value.headBodyPositioning) &&
    isProvenanceString(value.fingerPosition) &&
    isProvenanceString(value.cuttingAngle) &&
    isProvenanceString(value.cuttingLine) &&
    isProvenanceString(value.subsectioning) &&
    isProvenanceString(value.zoneConnection) &&
    isProvenanceBoolean(value.crossCheck) &&
    isProvenanceString(value.styling) &&
    isStringArray(value.constraints)
  );
}

// Re-exported so a caller only ever needs one import for "is this a
// Stage-1-supported vertical" -- avoids duplicating
// isTechnicalDemonstrationVertical's own single-vertical check.
export { isTechnicalDemonstrationVertical, HEAD_ZONES };
