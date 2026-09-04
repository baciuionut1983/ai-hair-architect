import type { TechnicalCutPlan } from "@/lib/contracts";
import { type CuttingDemonstrationStepPayload, type CuttingExecutionPhase } from "@/lib/technical-demonstration-cutting-contracts";
import type { TechnicalDemonstrationProvenanceValue } from "@/lib/technical-demonstration-contracts";
import { isHeadZone } from "@/lib/technical-visual-map-validators";

// Technical Demonstration, Stage 1 -- the deterministic derivation
// function itself. Pure: no I/O, no database, no AI provider, fully
// unit-testable offline (Decision Lock's own explicit requirement: "Do
// NOT ask an LLM to invent missing technique"). Consumes ONLY the
// already-CONFIRMED proposal's own structured TechnicalCutPlan -- never
// free text, never a live re-read of anything else.
//
// RELEASE-BLOCKER FIX: the `plan` this function receives MUST be the
// EFFECTIVE plan (baseline + professional edits merged), never the raw
// frozen baseline alone -- exactly the same authority
// technical-visual-map-assembler.ts's own `computeEffectiveTechnicalCutPlan`
// already establishes for Technical Visual Map. This function itself does
// NOT perform that merge (never a second, competing implementation of the
// merge rule) -- the caller (technical-demonstration-repository.ts)
// computes the effective plan by reusing that exact existing function,
// then passes both the effective plan AND the set of field names it
// actually overrode, so a professional-edited field's own value can be
// tagged PROFESSIONAL_OVERRIDE instead of a generic INFERRED (see
// `editedFields` below) -- provenance is never collapsed into "just AI
// inference" for a value a human actually approved.
//
// One TechnicalDemonstrationStep is derived per entry in the source
// plan's own `cuttingSteps` array -- NEVER a synthetic step invented for
// a concept (texturizing/styling/cross-check/...) the source plan didn't
// actually itemize as a step. This is the honest-over-complete choice the
// Decision Lock asks for: representing "no step for this" as genuinely no
// step, not as a fabricated one.
//
// STAGE 2.5.a GRANULARITY FIX (Stage 2.5 audit, root-cause section): real
// production testing showed every step reporting the SAME plan-level
// values (One Length / 0deg / Slice And Slide / ...) because the fields
// below were previously copied UNCONDITIONALLY onto every derived step.
// Proven cause: `structuralTechnique`, `cuttingTechnique`,
// `texturizingTechnique`, `sectioning`, `guideType`, `combingDirection`,
// and `overdirection` are all read from `plan.*` -- the ONE shared,
// whole-haircut object -- never from `sourceStep.*`. A plan being globally
// "One Length" does NOT mean every individual step's own action IS a
// One Length cutting action (the Stage 2.5.a task's own example). Fixed
// by scoping each of these seven fields to the specific execution PHASE
// (see CuttingExecutionPhase, technical-demonstration-cutting-contracts.ts)
// where that fact is genuinely true -- e.g. `texturizingTechnique` only
// ever appears on a REFINEMENT_TEXTURIZING-phase step, never smeared onto
// the STRUCTURAL_CUTTING-phase step merely because the plan happens to use
// texturizing somewhere. `tool`/`zones` are deliberately NOT touched by
// this fix -- they are read from `sourceStep.*` (this step's OWN record)
// AND the underlying source genuinely varies per step (see
// CuttingDemonstrationStepPayload's own field-by-field doc comment).
//
// RELEASE-BLOCKER FIX (Stage 2.5.a pre-push gate): `elevation` was
// INITIALLY left out of this same fix on the reasoning "it's read from
// sourceStep.*, so it's already step-scoped" -- that reasoning checked
// only WHERE the derivation reads from, not whether the upstream engine
// genuinely VARIES the value per step. It does not:
// cutting-plan-engine.ts's own generateTechnicalCutPlan sets
// `elevationAngle: elevation` -- the identical single plan-level local
// variable -- on every entry of the `cuttingSteps` array it builds, so a
// real derived plan reports the SAME elevation on PREPARATION_AND_SECTIONING
// and CROSS_CHECK_AND_FINISH as on STRUCTURAL_CUTTING (proven live during
// the pre-push gate: real engine output traced end-to-end through real
// derivation). Tagging that OBSERVED on every step was therefore
// misleading -- it implied a genuine per-step fact where the true source
// is one uniform, plan-wide value laundered through a step-shaped field.
// Fixed the same way as the other seven: `elevation` is now phase-scoped
// too (FIELD_APPLICABLE_PHASES.elevation), genuinely OBSERVED (still read
// from sourceStep.elevationAngle, unchanged) only on the STRUCTURAL_CUTTING
// step -- the one phase where this value is the actual cutting geometry
// being executed -- and honestly UNKNOWN everywhere else, including
// REFINEMENT_TEXTURIZING (today's data model has no independent evidence
// that a refinement step's own elevation equals the structural cut's).
// `tool` was separately re-verified live (comb / straight-shear /
// texturizing-shear / finishing-comb, genuinely different per step) and
// is intentionally left untouched.
//
// STAGE 2.5.a ZONE/PHASE FIX (Stage 2.5 audit, "zone bug" section): the
// cutting engine (cutting-plan-engine.ts) writes a workflow PHASE label
// (e.g. "Mapping and sectioning") into `CuttingStep.zone` -- a field this
// derivation must never reinterpret as an anatomical HeadZone (the
// pre-existing `isHeadZone` guard below already, correctly, never does
// this -- it simply never matches a phase-label string, which is exactly
// why `zones` reports UNKNOWN for every real production step today, and
// correctly continues to). What was actually missing is a genuinely
// SEPARATE concept for "which phase is this" -- `phase` below, derived
// from the SAME source string via its own dedicated, closed lookup
// (PHASE_LABEL_LOOKUP), completely independent of the zones/isHeadZone
// check. An unrecognized label resolves `phase` honestly to UNKNOWN, never
// a guess -- and an UNKNOWN phase correctly cascades to UNKNOWN for every
// phase-scoped field above, since we cannot honestly claim a plan-level
// fact applies to a step whose own execution phase we don't even know.

export const TECHNICAL_DEMONSTRATION_CUTTING_GENERATOR_VERSION = "1.1.0-td25a";

// The cutting engine's own fixed, closed set of step "zone" labels
// (cutting-plan-engine.ts's own generateTechnicalCutPlan -- the sole
// producer of CuttingStep.zone in this codebase) -- a deterministic,
// exhaustive lookup, never a heuristic/substring match. Any string not in
// this table (including every synthetic test fixture that uses a real
// HeadZone name instead of a phase label, and any future engine change)
// honestly resolves to no phase at all, never a guess.
const PHASE_LABEL_LOOKUP: Readonly<Record<string, CuttingExecutionPhase>> = {
  "Mapping and sectioning": "PREPARATION_AND_SECTIONING",
  "Baseline guideline": "GUIDE_AND_STRUCTURE",
  "Bulk and shape control": "STRUCTURAL_CUTTING",
  "Texture refinement": "REFINEMENT_TEXTURIZING",
  "Cross-check and finish": "CROSS_CHECK_AND_FINISH",
};

function resolvePhase(sourceZoneLabel: string): TechnicalDemonstrationProvenanceValue<CuttingExecutionPhase> {
  const phase = PHASE_LABEL_LOOKUP[sourceZoneLabel];
  return phase ? { value: phase, provenance: "INFERRED" } : { value: null, provenance: "UNKNOWN" };
}

// Which execution phase(s) a given plan-level field is genuinely valid on.
// The single source of truth for the granularity fix above -- every
// plan-level field's own derivation below looks itself up here rather than
// hand-repeating an inline phase check, so the applicability rule for a
// given field is stated exactly once.
const FIELD_APPLICABLE_PHASES = {
  sectioning: ["PREPARATION_AND_SECTIONING"],
  guideType: ["GUIDE_AND_STRUCTURE"],
  structuralTechnique: ["STRUCTURAL_CUTTING"],
  cuttingTechnique: ["STRUCTURAL_CUTTING"],
  texturizingTechnique: ["REFINEMENT_TEXTURIZING"],
  combingDirection: ["STRUCTURAL_CUTTING"],
  overdirection: ["STRUCTURAL_CUTTING"],
  // RELEASE-BLOCKER FIX: elevation-angle is cutting geometry -- it
  // describes the actual structural cutting action, the same phase
  // structuralTechnique/cuttingTechnique/combingDirection/overdirection
  // already live on, never a fact of preparation, guide placement, or
  // cross-check/finish. Deliberately single-phase, not also
  // GUIDE_AND_STRUCTURE or REFINEMENT_TEXTURIZING: today's data model has
  // exactly one plan-wide elevation value with no independent per-phase
  // evidence, so attributing it to more than the one phase it most
  // directly describes would just re-smear it under a different name.
  elevation: ["STRUCTURAL_CUTTING"],
} as const satisfies Record<string, readonly CuttingExecutionPhase[]>;

// Computes a phase-scoped field: UNKNOWN when the step's own resolved
// phase is null (unrecognized source label) or not in `allowedPhases`;
// otherwise defers to `compute` for the real value/provenance. `compute`
// is a thunk (not a pre-computed value) so an inapplicable field never
// even evaluates its own value expression -- there is nothing to
// accidentally leak.
function planScopedField<T>(
  phase: CuttingExecutionPhase | null,
  allowedPhases: readonly CuttingExecutionPhase[],
  compute: () => TechnicalDemonstrationProvenanceValue<T>,
): TechnicalDemonstrationProvenanceValue<T> {
  if (phase === null || !(allowedPhases as readonly string[]).includes(phase)) return unknownValue();
  return compute();
}

export interface DerivedCuttingDemonstrationStep {
  stepNumber: number;
  payload: CuttingDemonstrationStepPayload;
  explanation: string | null;
}

function observed<T>(value: T): TechnicalDemonstrationProvenanceValue<T> {
  return { value, provenance: "OBSERVED" };
}

// A plan-level field that was actually overridden by a professional edit
// carries that authority forward -- PROFESSIONAL_OVERRIDE, never a
// generic INFERRED, so a later reader can tell "the professional
// specifically approved this exact value" apart from "the deterministic
// engine's own untouched suggestion, propagated by a fixed rule".
function inferredOrOverride<T>(value: T, wasEdited: boolean): TechnicalDemonstrationProvenanceValue<T> {
  return { value, provenance: wasEdited ? "PROFESSIONAL_OVERRIDE" : "INFERRED" };
}

function unknownValue<T>(): TechnicalDemonstrationProvenanceValue<T> {
  return { value: null, provenance: "UNKNOWN" };
}

// Deterministic, documented mapping from the plan-level `distribution`
// field to a human-readable combing direction -- INFERRED, never a guess:
// every one of TechnicalCutDistribution's five closed values maps to
// exactly one fixed sentence, always the same sentence for the same
// input.
const COMBING_DIRECTION_BY_DISTRIBUTION: Record<TechnicalCutPlan["distribution"], string> = {
  natural_fall: "Comb the section to fall naturally, with no directional pull.",
  perpendicular: "Comb the section straight out, perpendicular to the head.",
  overdirected_back: "Comb the section overdirected toward the back of the head.",
  overdirected_forward: "Comb the section overdirected toward the front of the head.",
  shifting_line: "Comb direction shifts progressively along the cutting line.",
};

const OVERDIRECTED_DISTRIBUTIONS: ReadonlySet<TechnicalCutPlan["distribution"]> = new Set(["overdirected_back", "overdirected_forward"]);

// Derives the FULL ordered step list for a CONFIRMED cutting
// TechnicalCutPlan. Sorted by the source's own stepNumber (the engine's
// intended order is always respected), then RE-NUMBERED as a clean,
// contiguous 1..N sequence for persistence -- the source plan's own
// stepNumber values are never assumed unique or contiguous (isCuttingStep
// only requires a positive integer), so this is what guarantees the
// persisted (planId, stepNumber) uniqueness constraint always holds
// regardless of what the source data itself contains, without ever
// reordering a single step relative to another.
// `editedFields`: the set of EDITABLE_TECHNIQUE_FIELDS names (technical-
// visual-map-assembler.ts's own existing vocabulary) that a professional
// edit actually overrode on this exact confirmed proposal -- defaults to
// empty (every existing call site, and every genuinely unedited proposal,
// keeps deriving exactly as before: every plan-level field stays
// INFERRED). Never used to decide the VALUE (that is `plan`'s own job,
// already the effective/merged plan by the time this function runs) --
// only ever used to decide the PROVENANCE TAG on that value.
export function deriveCuttingDemonstrationSteps(plan: TechnicalCutPlan, editedFields: ReadonlySet<string> = new Set()): DerivedCuttingDemonstrationStep[] {
  const constraints = [...plan.warnings, ...plan.contraindications];
  const sourceSteps = [...plan.cuttingSteps].sort((a, b) => a.stepNumber - b.stepNumber);

  return sourceSteps.map((sourceStep, index) => {
    const zones = isHeadZone(sourceStep.zone) ? [sourceStep.zone] : [];
    const phase = resolvePhase(sourceStep.zone);
    const phaseValue = phase.value;

    const payload: CuttingDemonstrationStepPayload = {
      zones: zones.length > 0 ? observed(zones) : unknownValue(),
      // RELEASE-BLOCKER FIX: still genuinely OBSERVED from this step's own
      // record (unchanged source), but only ON the one phase where that
      // record's elevation is real cutting-geometry fact -- see
      // FIELD_APPLICABLE_PHASES.elevation's own comment.
      elevation: planScopedField(phaseValue, FIELD_APPLICABLE_PHASES.elevation, () => observed(sourceStep.elevationAngle)),
      tool: observed(sourceStep.toolRequired),
      phase,

      sectioning: planScopedField(phaseValue, FIELD_APPLICABLE_PHASES.sectioning, () =>
        inferredOrOverride(plan.sectioning, editedFields.has("sectioning")),
      ),
      guideType: planScopedField(phaseValue, FIELD_APPLICABLE_PHASES.guideType, () =>
        inferredOrOverride(plan.guideline, editedFields.has("guideline")),
      ),
      structuralTechnique: planScopedField(phaseValue, FIELD_APPLICABLE_PHASES.structuralTechnique, () =>
        inferredOrOverride(plan.structuralTechnique, editedFields.has("structuralTechnique")),
      ),
      cuttingTechnique: planScopedField(phaseValue, FIELD_APPLICABLE_PHASES.cuttingTechnique, () =>
        inferredOrOverride(plan.cuttingTechnique, editedFields.has("cuttingTechnique")),
      ),
      texturizingTechnique: planScopedField(phaseValue, FIELD_APPLICABLE_PHASES.texturizingTechnique, () =>
        plan.texturizingTechnique
          ? inferredOrOverride(plan.texturizingTechnique, editedFields.has("texturizingTechnique"))
          : unknownValue(),
      ),
      // Both derived FROM `distribution` -- both carry PROFESSIONAL_OVERRIDE
      // together whenever `distribution` itself was the edited field, since
      // both values are deterministic functions of that one same input.
      combingDirection: planScopedField(phaseValue, FIELD_APPLICABLE_PHASES.combingDirection, () =>
        inferredOrOverride(COMBING_DIRECTION_BY_DISTRIBUTION[plan.distribution], editedFields.has("distribution")),
      ),
      overdirection: planScopedField(phaseValue, FIELD_APPLICABLE_PHASES.overdirection, () =>
        inferredOrOverride(OVERDIRECTED_DISTRIBUTIONS.has(plan.distribution), editedFields.has("distribution")),
      ),

      headBodyPositioning: unknownValue(), // deprecated (Stage 2.5.c) -- kept only for backward compatibility, see its own field-level doc comment in technical-demonstration-cutting-contracts.ts
      clientHeadPosition: unknownValue(),
      observationView: unknownValue(),
      fingerPosition: unknownValue(),
      fingerAngle: unknownValue(),
      cuttingAngle: unknownValue(),
      cuttingLine: unknownValue(),
      subsectioning: unknownValue(),
      subsectionThickness: unknownValue(),
      toolOrientation: unknownValue(),
      progression: unknownValue(),
      zoneConnection: unknownValue(),
      crossCheck: unknownValue(),
      styling: unknownValue(),
      stateBefore: unknownValue(),
      stateAfter: unknownValue(),

      constraints,
    };

    return {
      stepNumber: index + 1,
      payload,
      // Human-readable explanation, kept structurally separate from the
      // payload above -- the source step's own free-text `action`,
      // verbatim, never parsed as a structured value. This is the ACTION
      // half of Stage 2.5.a's STATE BEFORE -> ACTION -> STATE AFTER triad
      // (see CuttingDemonstrationStepPayload.stateBefore/stateAfter's own
      // doc comment) -- already present since Stage 1, unchanged here.
      explanation: sourceStep.action,
    };
  });
}

// A step's own `zone` field on TechnicalCutPlan.cuttingSteps is a bare
// `string` (not the closed HeadZone union) at the type level -- the
// deterministic cutting engine has always produced real HeadZone values
// in practice, but this derivation never assumes that silently (reuses
// technical-visual-map-validators.ts's own existing isHeadZone guard,
// never a second, competing zone check): an out-of-vocabulary zone
// honestly becomes an UNKNOWN `zones` field (see above) rather than
// smuggling an unvalidated string into a typed slot.
