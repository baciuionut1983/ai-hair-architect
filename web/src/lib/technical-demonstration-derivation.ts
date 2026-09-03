import type { TechnicalCutPlan } from "@/lib/contracts";
import type { CuttingDemonstrationStepPayload } from "@/lib/technical-demonstration-cutting-contracts";
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

export const TECHNICAL_DEMONSTRATION_CUTTING_GENERATOR_VERSION = "1.0.0-td1";

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
    const payload: CuttingDemonstrationStepPayload = {
      zones: zones.length > 0 ? observed(zones) : unknownValue(),
      elevation: observed(sourceStep.elevationAngle),
      tool: observed(sourceStep.toolRequired),

      sectioning: inferredOrOverride(plan.sectioning, editedFields.has("sectioning")),
      guideType: inferredOrOverride(plan.guideline, editedFields.has("guideline")),
      structuralTechnique: inferredOrOverride(plan.structuralTechnique, editedFields.has("structuralTechnique")),
      cuttingTechnique: inferredOrOverride(plan.cuttingTechnique, editedFields.has("cuttingTechnique")),
      texturizingTechnique: plan.texturizingTechnique
        ? inferredOrOverride(plan.texturizingTechnique, editedFields.has("texturizingTechnique"))
        : unknownValue(),
      // Both derived FROM `distribution` -- both carry PROFESSIONAL_OVERRIDE
      // together whenever `distribution` itself was the edited field, since
      // both values are deterministic functions of that one same input.
      combingDirection: inferredOrOverride(COMBING_DIRECTION_BY_DISTRIBUTION[plan.distribution], editedFields.has("distribution")),
      overdirection: inferredOrOverride(OVERDIRECTED_DISTRIBUTIONS.has(plan.distribution), editedFields.has("distribution")),

      headBodyPositioning: unknownValue(),
      fingerPosition: unknownValue(),
      cuttingAngle: unknownValue(),
      cuttingLine: unknownValue(),
      subsectioning: unknownValue(),
      zoneConnection: unknownValue(),
      crossCheck: unknownValue(),
      styling: unknownValue(),

      constraints,
    };

    return {
      stepNumber: index + 1,
      payload,
      // Human-readable explanation, kept structurally separate from the
      // payload above -- the source step's own free-text `action`,
      // verbatim, never parsed as a structured value.
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
