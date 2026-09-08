import {
  classifyFramingSemantic,
  VIEWPOINT_FAMILIES,
  type FramingSemantic,
  type ViewpointConstraint,
  type ViewpointFamily,
} from "@/lib/professional-skill-viewpoint-constraint-contracts";
import { isValidDemonstrationRequirement, type DemonstrationRequirement } from "@/lib/professional-skill-demonstration-requirement-contracts";

// AI Hair Architect, Stage 2.5.i.12 -- CUTTING SKILL VIEWPOINT CONSTRAINT
// DERIVER. A small, pure, deterministic function that groups one Atomic
// Action's own real Demonstration Requirements (Stage 2.5.i.10, real
// content from Stage 2.5.i.6/i.7) by semantic framing need, then proves
// whether a single known viewpoint family can satisfy ALL of them
// together -- ZERO VideoInstruction, ZERO provider call, ZERO DB, ZERO
// wiring into any runtime path. Calling this function has ZERO effect
// anywhere in the application today.
//
// CUTTING-SPECIFIC, not universal -- named accordingly (mirrors cutting-
// skill-demonstration-requirement-deriver.ts exactly): FAMILY_FRAMING_
// COMPATIBILITY below encodes a judgment ("a POSTERIOR viewpoint can show
// context/relationship/geometry together") that is a head-shaped-subject
// assumption, not asserted to generalize to other verticals -- kept out
// of the universal contract file per Stage 2.5.i.12's own explicit
// "cutting-specific mappings may live in cutting-specific derivation
// rules" instruction. classifyFramingSemantic itself (imported, not
// duplicated) stays universal, since it is a pure mapping between two
// already-universal vocabularies with no vertical-specific keying at all.
//
// SCOPE: this function evaluates coverage for ONE Atomic Action's own
// Demonstration Requirement set at a time (every requirement passed in
// must share the same sourceAtomicActionId) -- mirrors the exact scoping
// discipline Stage 2.5.i.10's own deriver already established (one
// Atomic Action's worth of context is the natural unit; a caller wanting
// coverage across a whole Execution Unit calls this once per action).
//
// ONLY ONE REAL VIEWPOINT FAMILY EXISTS TODAY ("POSTERIOR", Stage
// 2.5.i.12's own universal contract) -- the "no family satisfies
// everything" (VIEWPOINT_UNSATISFIED) and "multiple families could work"
// (tie-break) paths are therefore NEVER reached by real content; both are
// proven correct only via SYNTHETIC test fixtures that introduce a second
// hypothetical family. This is honest: real content never needs more than
// one family, so nothing here pretends otherwise.
//
// NO TIE-BREAK MECHANISM IMPLEMENTED -- deliberately. Stage 2.5.i.11 §18
// authorized one ONLY if genuinely necessary ("if no tie-breaker is
// required, omit it"). With exactly one real family, `satisfyingFamilies`
// can only ever be empty or a singleton for real data -- there is nothing
// to break a tie between. When a second real family is eventually
// justified by new real content, the smallest correct extension point is
// an optional `preferredFamily` parameter (e.g. the previous Execution
// Unit's own resolved family, for viewpoint-change smoothness) -- not
// implemented here, reported as a deferred, well-scoped future addition,
// never a full continuity/state model.
//
// FAIL-CLOSED: malformed/untrusted input is rejected before coverage is
// even attempted (INVALID_INPUT); a structurally valid but unsatisfiable
// requirement set is rejected explicitly (VIEWPOINT_UNSATISFIED) -- never
// a silently-degraded "best effort" result.
//
// AUTHORITY BOUNDARY: mirrors Stage 2.5.i.10's own exact reasoning --
// this function has no SkillDefinition/eligibility input by design;
// eligibility is already enforced upstream (Stage 2.5.i.8's compiler
// refuses ineligible authority; Stage 2.5.i.10's deriver only ever
// receives already-trustworthy Atomic Actions). This function only ever
// classifies and groups what its structurally-valid input already
// contains -- it cannot add new certainty, and therefore cannot
// "launder" untrusted content into a trusted viewpoint result.

const FAMILY_FRAMING_COMPATIBILITY: Readonly<Record<ViewpointFamily, readonly FramingSemantic[]>> = {
  POSTERIOR: ["ANATOMICAL_CONTEXT_VISIBLE", "TECHNICAL_RELATIONSHIP_READABLE", "GEOMETRY_READABLE"],
};

export type ViewpointSatisfactionResult =
  | { status: "COVERED"; constraints: readonly ViewpointConstraint[] }
  | { status: "VIEWPOINT_UNSATISFIED"; reason: string; uncoveredDemonstrationRequirementIds: readonly string[] }
  | { status: "INVALID_INPUT"; reason: string };

export function deriveViewpointConstraintsFromDemonstrationRequirements<TFact extends string>(
  demonstrationRequirements: readonly DemonstrationRequirement<TFact>[],
  isValidFact: (candidate: unknown) => candidate is TFact,
  derivedAt: string,
): ViewpointSatisfactionResult {
  if (demonstrationRequirements.length === 0) {
    return { status: "INVALID_INPUT", reason: "no Demonstration Requirements supplied" };
  }
  for (const requirement of demonstrationRequirements) {
    if (!isValidDemonstrationRequirement(requirement, isValidFact)) {
      return { status: "INVALID_INPUT", reason: "one or more Demonstration Requirements failed structural validation" };
    }
  }
  const sourceActionId = demonstrationRequirements[0].sourceAtomicActionId;
  if (!demonstrationRequirements.every((r) => r.sourceAtomicActionId === sourceActionId)) {
    return { status: "INVALID_INPUT", reason: "Demonstration Requirements must all share the same source Atomic Action" };
  }

  const byFraming = new Map<FramingSemantic, DemonstrationRequirement<TFact>[]>();
  for (const requirement of demonstrationRequirements) {
    const framing = classifyFramingSemantic(requirement.category);
    const existing = byFraming.get(framing);
    if (existing) {
      existing.push(requirement);
    } else {
      byFraming.set(framing, [requirement]);
    }
  }
  const neededFramings = [...byFraming.keys()];

  const satisfyingFamilies = VIEWPOINT_FAMILIES.filter((family) =>
    neededFramings.every((framing) => FAMILY_FRAMING_COMPATIBILITY[family].includes(framing)),
  );

  if (satisfyingFamilies.length === 0) {
    return {
      status: "VIEWPOINT_UNSATISFIED",
      reason: "no known viewpoint family satisfies every required framing semantic for this Atomic Action",
      uncoveredDemonstrationRequirementIds: demonstrationRequirements.map((r) => r.demonstrationRequirementId),
    };
  }

  // Deterministic, ordered choice -- VIEWPOINT_FAMILIES is a fixed array;
  // the first satisfying family is always chosen. See file header for why
  // no further tie-break mechanism is implemented.
  const chosenFamily = satisfyingFamilies[0];

  let counter = 1;
  const constraints: ViewpointConstraint[] = neededFramings.map((framing) => ({
    viewpointConstraintId: `${sourceActionId}#viewpoint-${counter++}`,
    vertical: demonstrationRequirements[0].vertical,
    viewpointFamily: chosenFamily,
    framingSemantic: framing,
    satisfiedDemonstrationRequirementIds: byFraming.get(framing)!.map((r) => r.demonstrationRequirementId),
    derivedAt,
  }));

  return { status: "COVERED", constraints };
}
