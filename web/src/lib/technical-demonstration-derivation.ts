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

function inferred<T>(value: T): TechnicalDemonstrationProvenanceValue<T> {
  return { value, provenance: "INFERRED" };
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
export function deriveCuttingDemonstrationSteps(plan: TechnicalCutPlan): DerivedCuttingDemonstrationStep[] {
  const constraints = [...plan.warnings, ...plan.contraindications];
  const sourceSteps = [...plan.cuttingSteps].sort((a, b) => a.stepNumber - b.stepNumber);

  return sourceSteps.map((sourceStep, index) => {
    const zones = isHeadZone(sourceStep.zone) ? [sourceStep.zone] : [];
    const payload: CuttingDemonstrationStepPayload = {
      zones: zones.length > 0 ? observed(zones) : unknownValue(),
      elevation: observed(sourceStep.elevationAngle),
      tool: observed(sourceStep.toolRequired),

      sectioning: inferred(plan.sectioning),
      guideType: inferred(plan.guideline),
      structuralTechnique: inferred(plan.structuralTechnique),
      cuttingTechnique: inferred(plan.cuttingTechnique),
      texturizingTechnique: plan.texturizingTechnique ? inferred(plan.texturizingTechnique) : unknownValue(),
      combingDirection: inferred(COMBING_DIRECTION_BY_DISTRIBUTION[plan.distribution]),
      overdirection: inferred(OVERDIRECTED_DISTRIBUTIONS.has(plan.distribution)),

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
