import {
  isProvenanceNotApplicable,
  isProvenancePopulated,
  type TechnicalDemonstrationProvenanceValue,
  type TechnicalDemonstrationStepRecord,
} from "@/lib/technical-demonstration-contracts";
import type { CuttingDemonstrationStepPayload, CuttingExecutionActionType, CuttingExecutionPhase } from "@/lib/technical-demonstration-cutting-contracts";
import { resolveEffectiveActionType } from "@/lib/technical-demonstration-derivation";
import { readable } from "@/lib/recommendation-engine-shared";

// Technical Demonstration, Stage 2.5.h.1 -- DETERMINISTIC EXECUTION STATE
// DERIVATION. Pure, deterministic, server-only domain logic: no I/O, no
// database, no provider call, no AI, no free-text parsing. Answers exactly
// the question the Stage 2.5.h audit proved safe to answer: for `stateBefore`,
// `stateAfter`, and the FINAL_OBSERVATION step's own `crossCheck`, can a real
// value be built with certainty from OTHER structured fields this step (or
// its immediate predecessor) has already approved -- without inventing a
// single new fact?
//
// SCOPE LOCK (Stage 2.5.h.1's own explicit boundary): exactly 3 fields.
// Every other currently-UNKNOWN field this audit classified as
// PROFESSIONAL_DECISION_REQUIRED (zones, subsectioning, subsectionThickness,
// progression, zoneConnection, styling, observationView, clientHeadPosition,
// fingerPosition, fingerAngle, cuttingAngle, cuttingLine, toolOrientation) is
// NEVER touched here, and never will be by this file -- there is no
// deterministic domain authority for any of them today (Stage 2.5.h audit,
// Question 4). A later, separately-audited stage may investigate Professional
// Technique Execution Profiles for those; this file must never grow into that
// without its own new audit.
//
// INPUT DISCIPLINE: only ever reads the fields the Stage 2.5.h.1 task itself
// named as safe -- actionType, phase, structuralTechnique, cuttingTechnique,
// texturizingTechnique, sectioning, guideType, elevation, combingDirection,
// overdirection, tool, and (for stateBefore only) the immediately preceding
// step's own already-resolved stateAfter. NEVER reads `step.explanation` (the
// generated free-text description) -- exactly like
// technical-demonstration-cutting-coherence.ts's own explicit rule, a stale
// or contradictory description has ZERO influence here. NEVER reads any field
// this audit found no domain source for (zones, subsectioning, hair
// length/texture/condition, anything from Technical Visual Map or Spatial
// Map) -- pulling those in, even though they exist elsewhere in the app,
// would exceed this stage's own explicitly authorized input list.
//
// PROVENANCE: every field this module writes is tagged
// "DETERMINISTIC_DERIVATION" (technical-demonstration-contracts.ts), a value
// distinct from OBSERVED/INFERRED/PROFESSIONAL_OVERRIDE/NOT_APPLICABLE/
// UNKNOWN -- never disguised as a plain INFERRED value, so a later reader (or
// the Stage 2.5.g.4 source-level classifier) can always tell "the system
// computed this fresh, from currently-effective sibling fields" apart from
// "this was decided, once, by a human or the creation-time engine". This
// module NEVER overwrites a field whose provenance is already anything other
// than UNKNOWN -- a real value (however it got there) and an explicit
// NOT_APPLICABLE decision are both left completely untouched. Precedence,
// restated: LOCAL_PLAN_OVERRIDE > UPSTREAM_PROFESSIONAL value > deterministic
// derivation > UNKNOWN. This module runs strictly AFTER
// resolveEffectiveCuttingStepPayload (technical-demonstration-cutting-
// overrides.ts) has already applied every professional override, so by the
// time this file ever looks at a field, any professional value it might have
// had has already won.
//
// CALCULATED, NEVER PERSISTED: this module is called from
// resolveEffectiveCuttingStepsForRecord (technical-demonstration-
// repository.ts), the ONE existing choke point every reader (readiness route,
// coherence route, plan detail/create/current routes, confirmation's own
// coherence recheck) already goes through for "the effective view of this
// plan's steps" -- exactly like every override before it, this is computed
// fresh on every read, NEVER written back to TechnicalDemonstrationStep.payload
// in the database. A historical plan (V1/V2/V3, or any plan schema-versioned
// before Stage 2.5.a even added these 3 fields) is therefore NEVER rewritten
// -- it simply receives these same calculated values the next time it is
// read, exactly like resolveEffectiveActionType's own existing backward-
// compatibility fallback already does for `actionType`.
export const TECHNICAL_DEMONSTRATION_STATE_DERIVATION_VERSION = "1.0.0-st25h1";

function shouldDerive(entry: { provenance: string } | undefined): boolean {
  // Treats a genuinely MISSING key (a step persisted before Stage 2.5.a even
  // added stateBefore/stateAfter/crossCheck to the payload shape) exactly
  // like an honest UNKNOWN -- both mean "we don't have this yet", never
  // "this was decided". A real value (any provenance) or an explicit
  // NOT_APPLICABLE professional decision is never disturbed either way.
  return !isProvenancePopulated(entry) && !isProvenanceNotApplicable(entry);
}

function deterministic<T>(value: T): TechnicalDemonstrationProvenanceValue<T> {
  return { value, provenance: "DETERMINISTIC_DERIVATION" };
}

function populatedValue<T>(entry: { value: unknown; provenance: string } | undefined): T | null {
  return isProvenancePopulated(entry) ? (entry!.value as T) : null;
}

// ---------------------------------------------------------------------------
// stateAfter -- one template per execution phase, each reading ONLY the
// fields FIELD_APPLICABLE_PHASES (technical-demonstration-derivation.ts)
// already proves are genuinely scoped to that phase. Returns null (never a
// degenerate, half-empty sentence) whenever the one or two CORE facts a
// phase's sentence needs are themselves not yet populated -- an optional
// supporting fact (tool, elevation, combing direction) is included only when
// present, but is never required to produce a sentence at all.
// ---------------------------------------------------------------------------

function withTool(sentence: string, payload: CuttingDemonstrationStepPayload): string {
  const tool = populatedValue<string>(payload.tool);
  return tool ? `${sentence}. Tool: ${tool}.` : `${sentence}.`;
}

function buildStateAfterForPreparationAndSectioning(payload: CuttingDemonstrationStepPayload): string | null {
  const sectioning = populatedValue<string>(payload.sectioning);
  if (!sectioning) return null;
  return withTool(`Hair sectioned using ${readable(sectioning)}`, payload);
}

function buildStateAfterForGuideAndStructure(payload: CuttingDemonstrationStepPayload, effectiveActionType: CuttingExecutionActionType | null): string | null {
  const guideType = populatedValue<string>(payload.guideType);
  if (!guideType) return null;
  const verb =
    effectiveActionType === "GUIDE_CUTTING"
      ? "Guideline cut and established"
      : effectiveActionType === "GUIDE_OBSERVATION"
        ? "Guideline referenced (no cutting performed)"
        : "Guideline set";
  return withTool(`${verb} using ${readable(guideType)}`, payload);
}

function buildStateAfterForStructuralCutting(payload: CuttingDemonstrationStepPayload): string | null {
  const structuralTechnique = populatedValue<string>(payload.structuralTechnique);
  const cuttingTechnique = populatedValue<string>(payload.cuttingTechnique);
  if (!structuralTechnique || !cuttingTechnique) return null;

  // Built as a list of independent, already-complete sentences (rather than
  // one big concatenated clause) because `combingDirection` is itself
  // already a full sentence with its own trailing period (see
  // COMBING_DIRECTION_BY_DISTRIBUTION, technical-demonstration-
  // derivation.ts) -- joining fragments into a single "Distribution: X; Y"
  // clause would read as broken punctuation ("...pull.; non-overdirected...").
  const elevation = populatedValue<string>(payload.elevation);
  const parts: string[] = [
    `${readable(structuralTechnique)} structural shape established using ${readable(cuttingTechnique)}` + (elevation ? ` at ${readable(elevation)}.` : "."),
  ];

  const combingDirection = populatedValue<string>(payload.combingDirection);
  if (combingDirection) parts.push(combingDirection);

  const overdirection = populatedValue<boolean>(payload.overdirection);
  if (overdirection !== null) parts.push(overdirection ? "Distribution is overdirected." : "Distribution is not overdirected.");

  const tool = populatedValue<string>(payload.tool);
  if (tool) parts.push(`Tool: ${tool}.`);

  return parts.join(" ");
}

function buildStateAfterForRefinementTexturizing(payload: CuttingDemonstrationStepPayload): string | null {
  const texturizingTechnique = populatedValue<string>(payload.texturizingTechnique);
  if (!texturizingTechnique) return null;
  return withTool(`Texture refined using ${readable(texturizingTechnique)}`, payload);
}

// The FINAL_OBSERVATION action type is itself DEFINED, in this codebase's own
// closed domain contract, as exactly this fixed set of criteria (cutting-
// plan-engine.ts's own unconditional Cross-check-and-finish template
// sentence -- see technical-demonstration-derivation.ts's own Stage 2.5.e
// comment for why FINAL_OBSERVATION means exactly this and only this).
// Hard-coded here as a closed constant for the SAME reason
// DETERMINISTIC_ACTION_TYPE_BY_PHASE is hard-coded -- this is restating an
// already-fixed domain fact, never parsing or matching the step's own live
// free-text `explanation`.
const FINAL_OBSERVATION_CRITERIA = "symmetry, perimeter balance, and silhouette, confirmed via frontal and profile comparison";

function buildStateAfterForCrossCheckAndFinish(payload: CuttingDemonstrationStepPayload, effectiveActionType: CuttingExecutionActionType | null): string | null {
  // CORRECTIVE_CUTTING and an unresolved actionType are both genuinely
  // ambiguous -- a correction of unknown scope is never safely summarized
  // without inventing what was corrected. Only the one action type whose own
  // meaning IS a fixed, closed set of criteria is ever derived here.
  if (effectiveActionType !== "FINAL_OBSERVATION") return null;
  return withTool(`Final cross-check completed: ${FINAL_OBSERVATION_CRITERIA}`, payload);
}

function buildDerivedStateAfterSentence(
  phase: CuttingExecutionPhase,
  effectiveActionType: CuttingExecutionActionType | null,
  payload: CuttingDemonstrationStepPayload,
): string | null {
  switch (phase) {
    case "PREPARATION_AND_SECTIONING":
      return buildStateAfterForPreparationAndSectioning(payload);
    case "GUIDE_AND_STRUCTURE":
      return buildStateAfterForGuideAndStructure(payload, effectiveActionType);
    case "STRUCTURAL_CUTTING":
      return buildStateAfterForStructuralCutting(payload);
    case "REFINEMENT_TEXTURIZING":
      return buildStateAfterForRefinementTexturizing(payload);
    case "CROSS_CHECK_AND_FINISH":
      return buildStateAfterForCrossCheckAndFinish(payload, effectiveActionType);
    default:
      return null;
  }
}

// The ONE fixed sentence for a step with no predecessor. Deliberately makes
// NO claim about the client's actual hair (length/texture/condition/zones) --
// none of that is in this stage's authorized input list (Stage 2.5.h audit,
// Question 5) -- it states only the one certain, structural fact: this is
// the first action in this plan, so no PRIOR technical demonstration state
// transition exists yet.
const INITIAL_STATE_SENTENCE = "Initial state: no prior technical demonstration action has occurred in this plan.";

// ---------------------------------------------------------------------------
// The full pass -- processes steps in stepNumber order (re-sorted here,
// never trusting caller order, since this is a pure function with its own
// contract) so `stateBefore` can chain from the immediately preceding step's
// own EFFECTIVE `stateAfter` (professional-authored, or derived by this same
// pass one iteration earlier -- either way, the best-known truth about "the
// state after step N-1"). Never mutates its input.
// ---------------------------------------------------------------------------

export function deriveEffectiveExecutionState(steps: readonly TechnicalDemonstrationStepRecord[]): TechnicalDemonstrationStepRecord[] {
  const ordered = [...steps].sort((a, b) => a.stepNumber - b.stepNumber);
  let previousStateAfter: TechnicalDemonstrationProvenanceValue<string> | null = null;

  return ordered.map((step, index) => {
    const payload: CuttingDemonstrationStepPayload = { ...(step.payload as unknown as CuttingDemonstrationStepPayload) };

    const phaseEntry = payload.phase;
    const phase: CuttingExecutionPhase | null = isProvenancePopulated(phaseEntry) ? (phaseEntry.value as CuttingExecutionPhase) : null;
    const effectiveActionType = resolveEffectiveActionType(payload.actionType, phase);

    if (shouldDerive(payload.stateBefore)) {
      if (index === 0) {
        payload.stateBefore = deterministic(INITIAL_STATE_SENTENCE);
      } else if (previousStateAfter) {
        payload.stateBefore = deterministic(previousStateAfter.value as string);
      }
      // else: no proven chain input (the predecessor's own stateAfter is
      // itself UNKNOWN or NOT_APPLICABLE) -- left honestly UNKNOWN.
    }

    if (shouldDerive(payload.stateAfter) && phase !== null) {
      const sentence = buildDerivedStateAfterSentence(phase, effectiveActionType, payload);
      if (sentence) payload.stateAfter = deterministic(sentence);
    }

    if (shouldDerive(payload.crossCheck) && effectiveActionType === "FINAL_OBSERVATION") {
      payload.crossCheck = deterministic(true);
    }

    previousStateAfter = isProvenancePopulated(payload.stateAfter) ? (payload.stateAfter as TechnicalDemonstrationProvenanceValue<string>) : null;

    return { ...step, payload: payload as unknown as Record<string, unknown> };
  });
}
