import { isProvenancePopulated, type TechnicalDemonstrationStepRecord } from "@/lib/technical-demonstration-contracts";
import type { CuttingDemonstrationStepPayload, CuttingExecutionActionType, CuttingExecutionPhase } from "@/lib/technical-demonstration-cutting-contracts";
import { ACTION_SENSITIVE_FIELDS, ACTION_TYPES_EXCLUDING_CUTTING_GEOMETRY } from "@/lib/technical-demonstration-cutting-video-readiness";
import { DETERMINISTIC_ACTION_TYPE_BY_PHASE, resolveEffectiveActionType } from "@/lib/technical-demonstration-derivation";

// Technical Demonstration, Stage 2.5.g.1 -- the PROFESSIONAL COHERENCE pure
// rule engine. Pure, deterministic, server-only domain logic: no I/O, no
// database, no provider call, no AI, no free-text parsing. NOT YET called
// by any production path (create/edit/confirm/readiness/VIDEO_READY/UI) --
// this stage builds and tests the engine only, per its own explicit scope.
//
// DECISION LOCK (Stage 2.5.g audit): coherence is a SEPARATE concern from
// readiness, never merged into it.
//   READINESS (technical-demonstration-cutting-video-readiness.ts): are the
//   relevant fields COMPLETE enough (not UNKNOWN where required)?
//   COHERENCE (this file): do the POPULATED structured fields CONTRADICT
//   the deterministic domain contract?
// A field that is UNKNOWN is readiness's own concern -- coherence never
// fires "cannot evaluate" as if it were a violation. A field explicitly
// marked NOT_APPLICABLE is a real professional decision, never treated as
// a populated technical value either (isProvenancePopulated already
// excludes both UNKNOWN and NOT_APPLICABLE -- reused verbatim below, never
// reimplemented).
//
// SEVERITY MODEL (Stage 2.5.g audit, locked):
//   BLOCKER      -- a deterministic contradiction PROVABLE from an existing
//                   contract already in this codebase. Never expanded by
//                   intuition.
//   WARNING      -- a suspicious/unusual combination the current domain
//                   contract cannot prove invalid, but real evidence (the
//                   generator's own behavior) makes it worth a professional
//                   look.
//   REVIEW_ONLY  -- insufficient deterministic domain knowledge to judge at
//                   all (e.g. tool is free text with no closed
//                   compatibility vocabulary) -- informational only, never
//                   escalated into a warning or blocker.
//
// STRUCTURED AUTHORITY: only the effective structured payload is ever
// read. `step.explanation` (the generated free-text description) is never
// parsed, keyword-matched, or fuzzy-matched anywhere in this file -- per
// Stage 2.5.f.2, description is presentation-only, regenerated atomically
// from structured fields; a mismatch would be an engine bug for tests to
// catch, never a professional-facing coherence finding.
//
// PROFESSIONAL OVERRIDES: this function receives the EFFECTIVE step
// records (baseline + professional overrides already resolved by the
// caller, via resolveEffectiveCuttingStepsForRecord/
// resolveEffectiveCuttingStepPayload -- exactly the same convention
// evaluateStepReadiness already requires of its own caller). An override's
// own value is evaluated like any other populated value -- overrides do
// NOT bypass BLOCKER rules, and are never escalated in severity merely for
// being professional-sourced. This function never mutates, invalidates, or
// even inspects the raw professionalOverrides array itself -- it only ever
// reads the already-resolved effective payload.

// Stage 2.5.h.2d -- bumped from "1.0.0-coh1". A real, professionally-
// reviewed BLOCKER rule was added below (Slice And Slide vs. the exact
// straight full-line structural profile) -- a genuine behavior change to
// what this engine can now find, exactly the same "real change -> bump"
// discipline every other version constant in this domain already follows
// (TECHNICAL_DEMONSTRATION_CUTTING_GENERATOR_VERSION,
// CUTTING_DEMONSTRATION_STEP_SCHEMA_VERSION, ...). This constant does not
// participate in any creation fingerprint -- it only ever tags each
// CoherenceFinding's own `ruleVersion`, unchanged from before.
export const TECHNICAL_DEMONSTRATION_COHERENCE_RULES_VERSION = "1.1.0-coh2";

export type CoherenceSeverity = "BLOCKER" | "WARNING" | "REVIEW_ONLY";

export interface CoherenceFinding {
  code: string;
  severity: CoherenceSeverity;
  stepNumber: number | null;
  fields: readonly string[];
  message: string;
  ruleVersion: string;
}

export interface CoherenceEvaluation {
  pass: boolean;
  blockers: CoherenceFinding[];
  warnings: CoherenceFinding[];
  reviewItems: CoherenceFinding[];
}

// ---------------------------------------------------------------------------
// BLOCKER A -- phase/actionType validity.
//
// A complete, exhaustive partition of all 7 CuttingExecutionActionType
// values across all 5 CuttingExecutionPhase values, built from two
// existing, already-authoritative sources -- never invented here:
//   - DETERMINISTIC_ACTION_TYPE_BY_PHASE (technical-demonstration-
//     derivation.ts) is REUSED verbatim (derived programmatically from it,
//     not copy-pasted) for the 3 phases it already covers: this is the
//     SAME "three deterministic phase/actionType incompatibilities" the
//     Stage 2.5.g audit found (SECTIONING_ACTION<->PREPARATION_AND_
//     SECTIONING, STRUCTURAL_CUTTING<->STRUCTURAL_CUTTING, TEXTURIZING_
//     ACTION<->REFINEMENT_TEXTURIZING).
//   - GUIDE_AND_STRUCTURE -> {GUIDE_OBSERVATION, GUIDE_CUTTING} and
//     CROSS_CHECK_AND_FINISH -> {FINAL_OBSERVATION, CORRECTIVE_CUTTING} are
//     sourced directly from CuttingExecutionActionType's own header
//     comment (technical-demonstration-cutting-contracts.ts): those four
//     values exist SPECIFICALLY to resolve those two phases' own
//     ambiguity -- assigning either pair to any other phase contradicts
//     their own documented purpose.
// ---------------------------------------------------------------------------

const VALID_ACTION_TYPES_BY_PHASE: ReadonlyMap<CuttingExecutionPhase, ReadonlySet<CuttingExecutionActionType>> = new Map([
  ...(Object.entries(DETERMINISTIC_ACTION_TYPE_BY_PHASE) as Array<[CuttingExecutionPhase, CuttingExecutionActionType]>).map(
    ([phase, actionType]) => [phase, new Set<CuttingExecutionActionType>([actionType])] as const,
  ),
  ["GUIDE_AND_STRUCTURE", new Set<CuttingExecutionActionType>(["GUIDE_OBSERVATION", "GUIDE_CUTTING"])],
  ["CROSS_CHECK_AND_FINISH", new Set<CuttingExecutionActionType>(["FINAL_OBSERVATION", "CORRECTIVE_CUTTING"])],
]);

const CODE_PHASE_ACTION_TYPE_MISMATCH = "COHERENCE_PHASE_ACTION_TYPE_MISMATCH";

function checkPhaseActionTypeCoherence(step: TechnicalDemonstrationStepRecord, payload: CuttingDemonstrationStepPayload): CoherenceFinding | null {
  const phaseEntry = payload.phase;
  if (!isProvenancePopulated(phaseEntry)) return null; // UNKNOWN phase -- nothing to evaluate against, never fabricated
  const phase = phaseEntry.value as CuttingExecutionPhase;

  const effectiveActionType = resolveEffectiveActionType(payload.actionType, phase);
  if (effectiveActionType === null) return null; // UNKNOWN actionType -- readiness's own concern, not a contradiction

  const validForPhase = VALID_ACTION_TYPES_BY_PHASE.get(phase);
  if (!validForPhase || validForPhase.has(effectiveActionType)) return null; // valid pairing, or an unrecognized phase (never fabricated)

  return {
    code: CODE_PHASE_ACTION_TYPE_MISMATCH,
    severity: "BLOCKER",
    stepNumber: step.stepNumber,
    fields: ["phase", "actionType"],
    message: `Step ${step.stepNumber}'s actionType "${effectiveActionType}" is not a valid action for its own "${phase}" phase.`,
    ruleVersion: TECHNICAL_DEMONSTRATION_COHERENCE_RULES_VERSION,
  };
}

// ---------------------------------------------------------------------------
// BLOCKER B -- observation-only action with a materially populated
// cutting-geometry field. Reuses ACTION_TYPES_EXCLUDING_CUTTING_GEOMETRY
// and ACTION_SENSITIVE_FIELDS VERBATIM from the readiness engine (the
// SAME canonical partition readiness already uses to decide relevance) --
// never a second, independently-maintained copy of "which action types
// exclude cutting geometry" or "which fields are cutting-geometry
// fields".
// ---------------------------------------------------------------------------

const CODE_OBSERVATION_ONLY_WITH_CUTTING_GEOMETRY = "COHERENCE_OBSERVATION_ONLY_WITH_CUTTING_GEOMETRY";

function checkObservationOnlyGeometryCoherence(step: TechnicalDemonstrationStepRecord, payload: CuttingDemonstrationStepPayload): CoherenceFinding | null {
  const phaseEntry = payload.phase;
  const phase: CuttingExecutionPhase | null = isProvenancePopulated(phaseEntry) ? (phaseEntry.value as CuttingExecutionPhase) : null;
  const effectiveActionType = resolveEffectiveActionType(payload.actionType, phase);
  if (effectiveActionType === null || !ACTION_TYPES_EXCLUDING_CUTTING_GEOMETRY.has(effectiveActionType)) return null;

  const populatedGeometryFields = [...ACTION_SENSITIVE_FIELDS].filter((field) => {
    const entry = (payload as unknown as Record<string, { provenance: string } | undefined>)[field];
    return isProvenancePopulated(entry);
  });
  if (populatedGeometryFields.length === 0) return null;

  return {
    code: CODE_OBSERVATION_ONLY_WITH_CUTTING_GEOMETRY,
    severity: "BLOCKER",
    stepNumber: step.stepNumber,
    fields: populatedGeometryFields,
    message: `Step ${step.stepNumber}'s actionType "${effectiveActionType}" is observation-only, but ${populatedGeometryFields.join(", ")} carries a real cutting-geometry value.`,
    ruleVersion: TECHNICAL_DEMONSTRATION_COHERENCE_RULES_VERSION,
  };
}

// ---------------------------------------------------------------------------
// WARNING -- One Length + Elevation Cutting + 0 Deg Blunt. LOCKED
// classification from the Stage 2.5.g audit -- a narrow, literal encoding
// of the ONE real, investigated example, never generalized into a broader
// technique/elevation compatibility theory (the audit found no domain
// contract to generalize from). Evidence: cutting-plan-engine.ts's own
// generateTechnicalCutPlan sets cuttingTechnique="elevation_cutting" in
// exactly one branch (shag_mullet), and that same branch always pairs it
// with elevation="180_deg_overdirection" -- the engine itself never
// produces this combination naturally. That is real evidence, not naming
// intuition, but nothing in this codebase authoritatively declares the
// combination professionally impossible -- hence WARNING, never BLOCKER.
// ---------------------------------------------------------------------------

const CODE_ONE_LENGTH_ELEVATION_CUTTING_ZERO_BLUNT = "COHERENCE_ONE_LENGTH_ELEVATION_CUTTING_ZERO_BLUNT";

function checkOneLengthElevationCuttingZeroBluntWarning(
  step: TechnicalDemonstrationStepRecord,
  payload: CuttingDemonstrationStepPayload,
): CoherenceFinding | null {
  const structuralTechnique = payload.structuralTechnique;
  const cuttingTechnique = payload.cuttingTechnique;
  const elevation = payload.elevation;
  if (!isProvenancePopulated(structuralTechnique) || !isProvenancePopulated(cuttingTechnique) || !isProvenancePopulated(elevation)) return null;
  if (structuralTechnique.value !== "one_length" || cuttingTechnique.value !== "elevation_cutting" || elevation.value !== "0_deg_blunt") return null;

  return {
    code: CODE_ONE_LENGTH_ELEVATION_CUTTING_ZERO_BLUNT,
    severity: "WARNING",
    stepNumber: step.stepNumber,
    fields: ["structuralTechnique", "cuttingTechnique", "elevation"],
    message: `Step ${step.stepNumber} combines One Length + Elevation Cutting + 0° Blunt elevation -- the generator itself never produces this pairing, but no domain contract in this codebase proves it professionally invalid. Recommend professional review.`,
    ruleVersion: TECHNICAL_DEMONSTRATION_COHERENCE_RULES_VERSION,
  };
}

// ---------------------------------------------------------------------------
// REVIEW_ONLY -- STRUCTURAL_CUTTING + "texturizer-shear" tool. LOCKED
// classification from the Stage 2.5.g audit -- deliberately NOT a
// BLOCKER, and deliberately NOT generalized into any tool-compatibility
// engine: `tool` is an unconstrained free-text string (CuttingStep.
// toolRequired: string, contracts.ts) with no closed vocabulary anywhere
// in this domain, so no relationship involving it can ever be proven. This
// is a narrow, literal check against the ONE real, investigated example
// only -- never a pattern-match against arbitrary tool strings.
// ---------------------------------------------------------------------------

const CODE_STRUCTURAL_CUTTING_TEXTURIZER_SHEAR_TOOL = "COHERENCE_STRUCTURAL_CUTTING_TEXTURIZER_SHEAR_TOOL";

function checkStructuralCuttingTexturizerShearReview(
  step: TechnicalDemonstrationStepRecord,
  payload: CuttingDemonstrationStepPayload,
): CoherenceFinding | null {
  const phaseEntry = payload.phase;
  const phase: CuttingExecutionPhase | null = isProvenancePopulated(phaseEntry) ? (phaseEntry.value as CuttingExecutionPhase) : null;
  const effectiveActionType = resolveEffectiveActionType(payload.actionType, phase);
  if (effectiveActionType !== "STRUCTURAL_CUTTING") return null;

  const tool = payload.tool;
  if (!isProvenancePopulated(tool) || tool.value !== "texturizer-shear") return null;

  return {
    code: CODE_STRUCTURAL_CUTTING_TEXTURIZER_SHEAR_TOOL,
    severity: "REVIEW_ONLY",
    stepNumber: step.stepNumber,
    fields: ["actionType", "tool"],
    message: `Step ${step.stepNumber} performs STRUCTURAL_CUTTING with a "texturizer-shear" tool -- tool has no closed compatibility vocabulary in this domain contract, so this is never an automated finding beyond informational review.`,
    ruleVersion: TECHNICAL_DEMONSTRATION_COHERENCE_RULES_VERSION,
  };
}

// ---------------------------------------------------------------------------
// BLOCKER C -- Slice And Slide vs. the exact straight full-line structural
// profile. Stage 2.5.h.2c's own professional domain-authoring interview
// (CLOSED authority): Slice And Slide belongs to a graduated-haircut
// context (elevated/vertical sections, partially-open shear travelling
// along the section) and is explicitly NOT applicable to the straight
// full-line technique -- One Length + Blunt Line + Natural Fall + 0°
// Elevation + No Overdirection. This is the FIRST cross-step coherence
// rule in this file: every prior rule evaluates one step in isolation:
// this one legitimately needs the whole plan, because
// TEXTURIZING_ACTION/slice_and_slide and STRUCTURAL_CUTTING/one_length are
// two DIFFERENT atomic steps in this domain's own step model (exactly the
// V4 shape: Step 3 structural, Step 4 texturizing).
//
// NARROWEST professionally-justified predicate, deliberately NOT the
// broader "Slice And Slide is incompatible with every One Length haircut"
// (never authorized): all FOUR of structuralTechnique="one_length",
// cuttingTechnique="blunt_line", elevation="0_deg_blunt", AND
// overdirection=false must be populated and true together on the SAME
// step before this rule even considers the plan's texturizing technique.
// `tool` ("straight-shear") is deliberately EXCLUDED from the predicate --
// `tool` is free text with no closed compatibility vocabulary anywhere in
// this domain (see BLOCKER/REVIEW_ONLY precedent above: tool-based
// reasoning is never stronger than REVIEW_ONLY in this file), so it can
// never safely gate a BLOCKER-severity finding; the remaining four fields
// already identify this exact profile without it. `combingDirection` is
// ALSO deliberately excluded, even though "natural fall, no directional
// pull" is part of the professional's own named profile -- its stored
// value is a generated PROSE SENTENCE (COMBING_DIRECTION_BY_DISTRIBUTION,
// technical-demonstration-derivation.ts), and matching against sentence
// text would be exactly the "description/display-text matching" this
// engine's own header comment already forbids; `overdirection` (a clean
// boolean, deterministically derived from the SAME upstream `distribution`
// fact) is the correct structured proxy for "no directional pull" and is
// used instead.
//
// A one_length+blunt_line combination at a DIFFERENT elevation, or with
// overdirection=true, is a different, unauthorized combination -- this
// rule fails closed and does not fire for it (the professional's own
// authority never covered that case; see Stage 2.5.h.2c.1's own explicit
// "graduated contexts" carve-out for Slice And Slide).
// ---------------------------------------------------------------------------

const CODE_STRUCTURAL_TECHNIQUE_SLICE_AND_SLIDE_INCOMPATIBLE = "COHERENCE_STRUCTURAL_TECHNIQUE_SLICE_AND_SLIDE_INCOMPATIBLE";

function isExactStraightFullLineZeroDegreeNoOverdirectionProfile(payload: CuttingDemonstrationStepPayload): boolean {
  const structuralTechnique = payload.structuralTechnique;
  const cuttingTechnique = payload.cuttingTechnique;
  const elevation = payload.elevation;
  const overdirection = payload.overdirection;
  if (
    !isProvenancePopulated(structuralTechnique) ||
    !isProvenancePopulated(cuttingTechnique) ||
    !isProvenancePopulated(elevation) ||
    !isProvenancePopulated(overdirection)
  ) {
    return false; // any UNKNOWN/NOT_APPLICABLE relevant field -- never fabricate the match
  }
  return structuralTechnique.value === "one_length" && cuttingTechnique.value === "blunt_line" && elevation.value === "0_deg_blunt" && overdirection.value === false;
}

function checkStructuralTechniqueSliceAndSlideIncompatibility(effectiveSteps: readonly TechnicalDemonstrationStepRecord[]): CoherenceFinding | null {
  const structuralStep = effectiveSteps.find((step) => isExactStraightFullLineZeroDegreeNoOverdirectionProfile(step.payload as unknown as CuttingDemonstrationStepPayload));
  if (!structuralStep) return null;

  const texturizingStep = effectiveSteps.find((step) => {
    const texturizingTechnique = (step.payload as unknown as CuttingDemonstrationStepPayload).texturizingTechnique;
    return isProvenancePopulated(texturizingTechnique) && texturizingTechnique.value === "slice_and_slide";
  });
  if (!texturizingStep) return null;

  return {
    code: CODE_STRUCTURAL_TECHNIQUE_SLICE_AND_SLIDE_INCOMPATIBLE,
    severity: "BLOCKER",
    // Plan-level, not tied to any ONE step (it spans two) -- both real step
    // numbers are named in the message text instead, mirroring the exact
    // `stepNumber: null` convention this domain already uses for plan-level
    // findings elsewhere (e.g. ReadinessBlockingReason).
    stepNumber: null,
    fields: ["structuralTechnique", "cuttingTechnique", "elevation", "overdirection", "texturizingTechnique"],
    message: `Slice And Slide (Step ${texturizingStep.stepNumber}) is not applicable to the selected straight full-line, 0° One Length + Blunt Line technique with no overdirection (Step ${structuralStep.stepNumber}) -- professionally confirmed incompatible.`,
    ruleVersion: TECHNICAL_DEMONSTRATION_COHERENCE_RULES_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Plan coherence -- pure, deterministic. Iterates effectiveSteps in the
// given order and applies each rule at most once per step, so findings are
// always emitted in a stable, deterministic order and never duplicated (an
// observation-only step with multiple populated geometry fields still
// yields exactly ONE finding, with every offending field listed together
// in `fields`, never one finding per field).
// ---------------------------------------------------------------------------

export function evaluatePlanCoherence(effectiveSteps: readonly TechnicalDemonstrationStepRecord[]): CoherenceEvaluation {
  const blockers: CoherenceFinding[] = [];
  const warnings: CoherenceFinding[] = [];
  const reviewItems: CoherenceFinding[] = [];

  for (const step of effectiveSteps) {
    const payload = step.payload as unknown as CuttingDemonstrationStepPayload;

    const phaseActionTypeFinding = checkPhaseActionTypeCoherence(step, payload);
    if (phaseActionTypeFinding) blockers.push(phaseActionTypeFinding);

    const observationGeometryFinding = checkObservationOnlyGeometryCoherence(step, payload);
    if (observationGeometryFinding) blockers.push(observationGeometryFinding);

    const oneLengthWarning = checkOneLengthElevationCuttingZeroBluntWarning(step, payload);
    if (oneLengthWarning) warnings.push(oneLengthWarning);

    const structuralToolReview = checkStructuralCuttingTexturizerShearReview(step, payload);
    if (structuralToolReview) reviewItems.push(structuralToolReview);
  }

  // Cross-step: evaluated once against the whole plan, not once per step
  // (see BLOCKER C's own header comment for why this rule genuinely needs
  // more than one step's own payload).
  const sliceAndSlideIncompatibility = checkStructuralTechniqueSliceAndSlideIncompatibility(effectiveSteps);
  if (sliceAndSlideIncompatibility) blockers.push(sliceAndSlideIncompatibility);

  return { pass: blockers.length === 0, blockers, warnings, reviewItems };
}
