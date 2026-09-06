import {
  CUTTING_TECHNIQUES,
  ELEVATION_OPTIONS,
  GUIDELINE_OPTIONS,
  isOneOf,
  SECTIONING_OPTIONS,
  STRUCTURAL_TECHNIQUES,
  TEXTURIZING_TECHNIQUES,
} from "@/lib/proposal-validators";
import { isHeadZone, isRecord } from "@/lib/technical-visual-map-validators";
import { isProvenancePopulated, type TechnicalDemonstrationProvenanceValue } from "@/lib/technical-demonstration-contracts";
import { isCuttingExecutionActionType, type CuttingDemonstrationStepPayload, type CuttingExecutionPhase } from "@/lib/technical-demonstration-cutting-contracts";
import { resolveEffectiveActionType } from "@/lib/technical-demonstration-derivation";

// Technical Demonstration, Stage 2.5.b -- the Cutting V1 professional
// adjustment layer. Mirrors technical-visual-map-validators.ts's own
// MapAdjustmentEntry / resolveEffectiveTechnicalVisualMap pattern exactly
// (frozen baseline + additive, auditable overlay, applied at read time,
// sealed permanently once the owning plan is CONFIRMED) -- the SAME
// architecture already proven twice in this codebase (AnalysisProposal.edits,
// TechnicalVisualMap.professionalAdjustments), now applied one layer
// deeper, to individual TechnicalDemonstrationStep fields. Cutting-specific
// (field names + value shapes), same reasoning as
// technical-demonstration-cutting-contracts.ts's own vertical split -- a
// future vertical gets its own sibling override file, never a branch added
// here.
//
// A CuttingStepOverrideEntry is never caller-authored wholesale: the
// browser only ever supplies a CuttingStepOverrideInput (op/stepNumber/
// field/value?/reason?) -- `source` and `setAt` are always stamped
// server-side (toCuttingStepOverrideEntry), never trusted from the client,
// matching this stage's own explicit "do not trust IDs or effective values
// supplied blindly by the browser" requirement.

// ---------------------------------------------------------------------------
// Field name vocabulary -- every CuttingDemonstrationStepPayload field a
// professional may legitimately adjust. Deliberately EXCLUDES two fields:
//   - `phase`: system-derived from a closed, deterministic label lookup
//     (technical-demonstration-derivation.ts's own PHASE_LABEL_LOOKUP) --
//     letting a professional relabel a step's own phase would let them
//     bypass the Stage 2.5.a granularity fix entirely (FIELD_APPLICABLE_PHASES
//     gates OTHER fields BY phase; an editable phase would make that gate
//     gameable).
//   - `constraints`: copied verbatim from the confirmed proposal's own
//     safety warnings/contraindications (technical-demonstration-derivation.ts) --
//     a professional silently editing/removing a safety constraint here
//     would be a real safety regression, not a legitimate technical
//     correction; this field intentionally has no override mechanism.
//
// `actionType` (Stage 2.5.d) is DELIBERATELY INCLUDED despite superficially
// resembling `phase` -- the two are not analogous. `phase` is a WORKFLOW
// POSITION the deterministic engine always knows with certainty (it gates
// other fields' own applicability, so letting it be edited would be
// gameable, per the exclusion above). `actionType` is a PROFESSIONAL
// JUDGMENT about what real action occurred, which the deterministic
// derivation can only sometimes know (see CuttingExecutionActionType's own
// header comment) -- for GUIDE_AND_STRUCTURE and CROSS_CHECK_AND_FINISH
// steps, a professional classification is the ONLY mechanism that can ever
// resolve it honestly. This is exactly the same "AI/browser proposes,
// deterministic server code resolves/validates" principle every other
// override field in this list already embodies.
// ---------------------------------------------------------------------------

export const CUTTING_STEP_OVERRIDE_FIELD_NAMES = [
  "zones",
  "elevation",
  "tool",
  "actionType",
  "sectioning",
  "guideType",
  "structuralTechnique",
  "cuttingTechnique",
  "texturizingTechnique",
  "combingDirection",
  "overdirection",
  // Stage 2.5.c: `headBodyPositioning` is deprecated (see its own doc
  // comment in technical-demonstration-cutting-contracts.ts) but
  // deliberately kept here, unchanged -- removing it would make
  // isCuttingStepOverrideEntryArray reject any already-recorded real
  // professional override that targeted it (that validator runs on every
  // READ of professionalOverrides, not just on write), a genuine backward-
  // compatibility break. New professional input should target
  // `clientHeadPosition`/`observationView` instead; this stays purely for
  // safe, non-destructive compatibility.
  "headBodyPositioning",
  "clientHeadPosition",
  "observationView",
  "fingerPosition",
  "fingerAngle",
  "cuttingAngle",
  "cuttingLine",
  "subsectioning",
  "subsectionThickness",
  "toolOrientation",
  "progression",
  "zoneConnection",
  "crossCheck",
  "styling",
  "stateBefore",
  "stateAfter",
] as const satisfies readonly (keyof CuttingDemonstrationStepPayload)[];

export type CuttingStepOverrideFieldName = (typeof CUTTING_STEP_OVERRIDE_FIELD_NAMES)[number];

export function isCuttingStepOverrideFieldName(value: unknown): value is CuttingStepOverrideFieldName {
  return typeof value === "string" && (CUTTING_STEP_OVERRIDE_FIELD_NAMES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Per-field value shape -- reuses the EXACT same closed vocabularies
// technical-demonstration-cutting-contracts.ts's own validator already
// checks against, never a second, competing definition of "what is a valid
// elevation". A field not listed here structurally cannot exist (every
// CuttingStepOverrideFieldName has exactly one validator).
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

// Exported (Stage 2.5.h.2b) so the new Professional Technique Execution
// Profile contract (technical-demonstration-execution-profile-contracts.ts)
// can validate a REQUIRED_FIXED/PROFESSIONAL_CHOICE rule's own structured
// value against this EXACT SAME per-field vocabulary -- never a second,
// independently-maintained copy of "what is a valid elevation". Zero
// behavior change here: the export keyword is the only edit, mirroring the
// identical precedent ACTION_SENSITIVE_FIELDS already set in Stage 2.5.g.1.
export const FIELD_VALUE_VALIDATORS: Record<CuttingStepOverrideFieldName, (value: unknown) => boolean> = {
  zones: (v) => Array.isArray(v) && v.length > 0 && v.every(isHeadZone),
  elevation: (v) => isOneOf(v, ELEVATION_OPTIONS),
  tool: isNonEmptyString,
  actionType: (v) => isCuttingExecutionActionType(v),
  sectioning: (v) => isOneOf(v, SECTIONING_OPTIONS),
  guideType: (v) => isOneOf(v, GUIDELINE_OPTIONS),
  structuralTechnique: (v) => isOneOf(v, STRUCTURAL_TECHNIQUES),
  cuttingTechnique: (v) => isOneOf(v, CUTTING_TECHNIQUES),
  texturizingTechnique: (v) => isOneOf(v, TEXTURIZING_TECHNIQUES),
  combingDirection: isNonEmptyString,
  overdirection: (v) => typeof v === "boolean",
  headBodyPositioning: isNonEmptyString,
  clientHeadPosition: isNonEmptyString,
  observationView: isNonEmptyString,
  fingerPosition: isNonEmptyString,
  fingerAngle: isNonEmptyString,
  cuttingAngle: isNonEmptyString,
  cuttingLine: isNonEmptyString,
  subsectioning: isNonEmptyString,
  subsectionThickness: isNonEmptyString,
  toolOrientation: isNonEmptyString,
  progression: isNonEmptyString,
  zoneConnection: isNonEmptyString,
  crossCheck: (v) => typeof v === "boolean",
  styling: isNonEmptyString,
  stateBefore: isNonEmptyString,
  stateAfter: isNonEmptyString,
};

// ---------------------------------------------------------------------------
// Override operations -- a closed discriminated union, never a generic
// {field, value: unknown} bag (same discipline as MapAdjustmentEntry): the
// closed `op` + `field` vocabulary IS the enforcement that a professional
// can only ever touch a real, known Cutting V1 execution field, never a
// plan-level/lifecycle/identity column.
//
//   set_value:           supply or correct this field's real value ->
//                         PROFESSIONAL_OVERRIDE.
//   mark_not_applicable: this field genuinely does not apply to this
//                         step's own action -> NOT_APPLICABLE (never
//                         UNKNOWN -- a professional decision, not a gap).
//   reset_field:         undo back to this step's own original baseline
//                         value (whatever deriveCuttingDemonstrationSteps
//                         itself produced), discarding every override this
//                         plan has ever recorded for this exact
//                         (stepNumber, field) pair.
// ---------------------------------------------------------------------------

export const CUTTING_STEP_OVERRIDE_OPS = ["set_value", "mark_not_applicable", "reset_field"] as const;
export type CuttingStepOverrideOp = (typeof CUTTING_STEP_OVERRIDE_OPS)[number];

// The client-suppliable subset -- exactly what a caller may legitimately
// author. `source`/`setAt` are never part of this shape; they exist only on
// the full CuttingStepOverrideEntry, always server-stamped.
export interface CuttingStepOverrideInput {
  op: CuttingStepOverrideOp;
  stepNumber: number;
  field: CuttingStepOverrideFieldName;
  value?: unknown;
  reason?: string;
}

export function isCuttingStepOverrideInput(value: unknown): value is CuttingStepOverrideInput {
  if (!isRecord(value)) return false;
  if (!(CUTTING_STEP_OVERRIDE_OPS as readonly string[]).includes(value.op as string)) return false;
  if (typeof value.stepNumber !== "number" || !Number.isInteger(value.stepNumber) || value.stepNumber < 1) return false;
  if (!isCuttingStepOverrideFieldName(value.field)) return false;
  if (value.reason !== undefined && typeof value.reason !== "string") return false;

  if (value.op === "set_value") {
    if (!("value" in value)) return false;
    return FIELD_VALUE_VALIDATORS[value.field](value.value);
  }
  // mark_not_applicable / reset_field carry no value at all -- present is malformed.
  return !("value" in value);
}

// The full, persisted, server-authoritative entry -- what actually lives in
// TechnicalDemonstrationPlan.professionalOverrides. `source` is always the
// literal "professional" (an override is professional-sourced by
// definition, mirrors MapAdjustmentEntry's own identical convention);
// `setAt` is always stamped by the repository at write time, never
// caller-supplied (this stage's own explicit "when it was made" audit
// requirement -- a browser clock is never trusted for this).
export interface CuttingStepOverrideEntry {
  op: CuttingStepOverrideOp;
  stepNumber: number;
  field: CuttingStepOverrideFieldName;
  value?: unknown;
  source: "professional";
  reason?: string;
  setAt: string;
}

export function isCuttingStepOverrideEntry(value: unknown): value is CuttingStepOverrideEntry {
  if (!isRecord(value)) return false;
  if (value.source !== "professional") return false;
  if (typeof value.setAt !== "string" || value.setAt.length === 0) return false;
  if (typeof value.stepNumber !== "number" || !Number.isInteger(value.stepNumber) || value.stepNumber < 1) return false;
  if (!isCuttingStepOverrideFieldName(value.field)) return false;
  if (value.reason !== undefined && typeof value.reason !== "string") return false;

  if (value.op === "set_value") {
    if (!("value" in value)) return false;
    return FIELD_VALUE_VALIDATORS[value.field](value.value);
  }
  if (value.op === "mark_not_applicable" || value.op === "reset_field") {
    return !("value" in value);
  }
  return false;
}

export function isCuttingStepOverrideEntryArray(value: unknown): value is CuttingStepOverrideEntry[] {
  return Array.isArray(value) && value.every(isCuttingStepOverrideEntry);
}

// Server-side stamping -- the ONE place a client-suppliable input becomes a
// full, authoritative entry. Never round-trips a caller-supplied
// source/setAt; `now` is caller-injected (not `new Date()` inline) so
// repository-level tests can supply a fixed clock, mirroring this
// codebase's own established convention for every other server-stamped
// timestamp.
export function toCuttingStepOverrideEntry(input: CuttingStepOverrideInput, now: Date): CuttingStepOverrideEntry {
  const base = {
    op: input.op,
    stepNumber: input.stepNumber,
    field: input.field,
    source: "professional" as const,
    setAt: now.toISOString(),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  };
  return input.op === "set_value" ? { ...base, value: input.value } : base;
}

// ---------------------------------------------------------------------------
// Effective payload resolver -- pure, deterministic: baseline payload +
// ordered valid overrides scoped to ONE step = that step's effective
// payload. Never mutates its inputs. Overrides are applied strictly in
// array order (append-only, so this is also chronological order) -- the
// LAST override touching a given (stepNumber, field) pair wins, exactly
// like resolveEffectiveTechnicalVisualMap's own identical rule.
// `reset_field` reverts that one field to ITS OWN baseline value (from the
// same step's original derived payload) -- not to "undo the previous
// override" -- a clean, unambiguous semantics matching the word "reset".
// ---------------------------------------------------------------------------

// UI/read-model compatibility fix (Stage 2.5.d, round 2) -- a step
// persisted before `actionType` existed (current production V2) has no
// stored value for it at all; without this, the effective payload
// returned to the professional-facing read model (and thus the API/UI)
// would silently omit what the readiness engine already knows how to
// derive. Reuses resolveEffectiveActionType -- the ONE canonical
// derivation source (technical-demonstration-derivation.ts) -- so this
// can never independently drift from what readiness itself resolves.
// Applied to `baseline` itself (never mutating the caller's own object --
// a fresh shallow copy) BEFORE overrides are read, so `reset_field` also
// correctly reverts to this same compatibility-resolved value, not to a
// literal absence. A step whose stored value is already real (whether
// PROFESSIONAL_OVERRIDE from an actual edit, or INFERRED from the current
// derivation) is returned completely untouched.
function withActionTypeCompatibilityFallback(baseline: CuttingDemonstrationStepPayload): CuttingDemonstrationStepPayload {
  if (isProvenancePopulated(baseline.actionType)) return baseline;
  const phaseEntry = baseline.phase;
  const phase: CuttingExecutionPhase | null = isProvenancePopulated(phaseEntry) ? (phaseEntry.value as CuttingExecutionPhase) : null;
  const fallbackActionType = resolveEffectiveActionType(baseline.actionType, phase);
  if (fallbackActionType) {
    return { ...baseline, actionType: { value: fallbackActionType, provenance: "INFERRED" } };
  }
  // No deterministic fallback exists (GUIDE_AND_STRUCTURE/CROSS_CHECK_AND_
  // FINISH, or an unrecognized phase). A genuinely MISSING key (a step
  // persisted before actionType existed at all -- current production V2)
  // is normalized to an explicit, honest UNKNOWN entry, so every consumer
  // of the effective payload always sees a real provenance-wrapped value,
  // never `undefined` -- an already-present NOT_APPLICABLE entry (a real
  // professional decision) is left completely untouched either way.
  if (baseline.actionType === undefined) {
    return { ...baseline, actionType: { value: null, provenance: "UNKNOWN" } };
  }
  return baseline;
}

export function resolveEffectiveCuttingStepPayload(
  stepNumber: number,
  baseline: CuttingDemonstrationStepPayload,
  overrides: readonly CuttingStepOverrideEntry[],
): CuttingDemonstrationStepPayload {
  const resolvedBaseline = withActionTypeCompatibilityFallback(baseline);
  const effective: CuttingDemonstrationStepPayload = { ...resolvedBaseline };

  for (const entry of overrides) {
    if (entry.stepNumber !== stepNumber) continue;

    switch (entry.op) {
      case "set_value": {
        const next: TechnicalDemonstrationProvenanceValue<unknown> = { value: entry.value, provenance: "PROFESSIONAL_OVERRIDE" };
        (effective as unknown as Record<CuttingStepOverrideFieldName, unknown>)[entry.field] = next;
        break;
      }
      case "mark_not_applicable": {
        const next: TechnicalDemonstrationProvenanceValue<unknown> = { value: null, provenance: "NOT_APPLICABLE" };
        (effective as unknown as Record<CuttingStepOverrideFieldName, unknown>)[entry.field] = next;
        break;
      }
      case "reset_field": {
        (effective as unknown as Record<CuttingStepOverrideFieldName, unknown>)[entry.field] = (
          resolvedBaseline as unknown as Record<CuttingStepOverrideFieldName, unknown>
        )[entry.field];
        break;
      }
    }
  }

  return effective;
}

// ---------------------------------------------------------------------------
// Field source level -- Stage 2.5.g.4 (Technical Plan provenance UX
// clarification). A real production professional found "Reset to
// original" writing successfully (a real professionalOverrides entry
// persisted) yet the displayed value never changing -- root-caused to the
// UI conflating two genuinely different things that both surface as
// provenance "PROFESSIONAL_OVERRIDE" on the EFFECTIVE payload:
//
//   UPSTREAM_PROFESSIONAL -- the field's own STORED BASELINE (this step's
//     payload row, written ONCE at plan creation by
//     deriveCuttingDemonstrationSteps) already carries PROFESSIONAL_OVERRIDE,
//     because the CONFIRMED AnalysisProposal itself had a professional edit
//     for this field (technical-demonstration-derivation.ts's own
//     inferredOrOverride). There is no Technical Demonstration Plan-level
//     override sitting on top of a different original value -- "reset"
//     against this step's own baseline reproduces the exact same value,
//     because that IS the baseline.
//   LOCAL_PLAN_OVERRIDE -- a genuine, currently-ACTIVE override exists on
//     THIS plan for this exact (stepNumber, field): resolving it (reset_field)
//     genuinely changes the effective value back to the step's own stored
//     baseline (which may itself be GENERATED_BASELINE or
//     UPSTREAM_PROFESSIONAL -- reset never reaches further back than that).
//   GENERATED_BASELINE -- plain OBSERVED/INFERRED/UNKNOWN, no professional
//     involvement at any layer.
//
// Fully derivable from data every caller already has (the field's own
// effective provenance, already sent in every existing API response, plus
// this plan's own professionalOverrides array, likewise already sent) --
// no new persisted field, no migration, no new API shape. Mirrors
// resolveEffectiveCuttingStepPayload's own "array order, LAST entry for
// this (stepNumber, field) wins" rule exactly (a reset_field entry is
// never itself a "local override in effect" -- it is what DISCARDS one) --
// never a second, independently-maintained interpretation of override
// precedence.
export type CuttingStepFieldSourceLevel = "GENERATED_BASELINE" | "UPSTREAM_PROFESSIONAL" | "LOCAL_PLAN_OVERRIDE";

export function resolveCuttingStepFieldSourceLevel(
  stepNumber: number,
  field: CuttingStepOverrideFieldName,
  effectiveProvenance: string,
  overrides: readonly CuttingStepOverrideEntry[],
): CuttingStepFieldSourceLevel {
  let lastMatching: CuttingStepOverrideEntry | undefined;
  for (const entry of overrides) {
    if (entry.stepNumber === stepNumber && entry.field === field) {
      lastMatching = entry;
    }
  }
  if (lastMatching && (lastMatching.op === "set_value" || lastMatching.op === "mark_not_applicable")) {
    return "LOCAL_PLAN_OVERRIDE";
  }
  if (effectiveProvenance === "PROFESSIONAL_OVERRIDE") {
    return "UPSTREAM_PROFESSIONAL";
  }
  return "GENERATED_BASELINE";
}
