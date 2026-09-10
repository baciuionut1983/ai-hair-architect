import type { CuttingTechnique, StructuralTechnique, TechnicalCutDistribution, TechnicalCutElevation } from "@/lib/contracts";
import { CUTTING_TECHNIQUES, DISTRIBUTION_OPTIONS, ELEVATION_OPTIONS, STRUCTURAL_TECHNIQUES } from "@/lib/proposal-validators";
import type { SkillDefinition } from "@/lib/professional-skill-contracts";
import { EXECUTION_RULE_CONDITION_FACTS, type ExecutionRuleConditionFact } from "@/lib/technical-demonstration-execution-profile-contracts";
import type { SkillInstance, SkillInstanceParameterBinding } from "@/lib/professional-skill-instance-contracts";
import type { ExecutionUnit, ExecutionUnitParameterRule } from "@/lib/professional-skill-execution-unit-contracts";
import { ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE } from "@/lib/cutting-skill-establish-central-nape-guide";

// AI Hair Architect, Stage 2.5.i.7 -- REAL PROFESSIONAL AUTHORITY CONTENT,
// NOT a synthetic fixture, NOT AI-generated draft knowledge. The SECOND
// real Skill authored under the Stage 2.5.i.1/i.3/i.4/i.5/i.6a contract
// stack, using ONLY professional authority already closed by this
// engagement's own interview series (Stage 2.5.h.2c.1/.2/.3). ZERO
// Composition Engine, ZERO automatic Skill selection, ZERO Atomic Action
// compilation, ZERO wiring into Technical Demonstration Plan/readiness/
// coherence/derivation/the generator -- exporting these constants has
// ZERO runtime effect anywhere in the application today.
//
// PILOT SKILL: "Occipital Transition" (TRANZITIA OCCIPITALA). SCOPE,
// exactly as authorized -- starts AFTER the central nape guide (Stage
// 2.5.i.6) is already established, and covers ONLY the professional
// control-method transition associated with the occipital curvature/
// anatomical threshold. Does NOT include: establishing the central nape
// guide itself (that is Stage 2.5.i.6's own Skill), lateral execution,
// fringe, Slice And Slide, final verification, drying, finish/styling, the
// optional 45-degree interior-graduation technique, or the rest of the
// One Length haircut -- all separate, not-yet-authored Skills.
//
// EXECUTION UNIT COUNT DECISION -- resolved from the architecture, not
// assumed: TWO. Per the locked authority (facts #3/#4/#6 below), control
// method genuinely changes at the anatomical threshold -- comb below,
// fingers at/above -- which is exactly the "tool/control-method
// transition" boundary trigger Stage 2.5.i.2's own Execution Unit
// definition names as a reason a NEW unit is warranted (relevant
// professional facts stop remaining stable). A single unit with an
// internal branch was considered and rejected: the Execution Unit's own
// definition requires facts to remain stable WITHIN a unit's own scope,
// and control method is not stable across this Skill -- collapsing both
// contexts into one unit would misrepresent that. Two units, each with
// its own `applicabilityCondition`, is the smallest correct
// representation. NOT created per procedure sentence (the 4-step
// procedure below maps onto 2 units, not 4).
//
// CONDITION FACT VOCABULARY -- extends (never edits) technical-
// demonstration-execution-profile-contracts.ts's own real
// ExecutionRuleConditionFact list (Stage 2.5.h.2b, left byte-unchanged --
// see NON-REGRESSION) with exactly ONE new, LOCALLY-SCOPED fact:
// `aboveOccipitalThreshold` (boolean). This is NOT an architecture gap:
// SkillCondition<TFact> is explicitly generic over any closed fact
// vocabulary the skill author supplies (professional-skill-contracts.ts's
// own documented design) -- a new Skill needing a new fact declares it in
// its own local vocabulary, exactly as intended, without touching any
// shared file. The fact is a plain BOOLEAN, never a numeric coordinate --
// the locked authority is explicit that the occipital threshold is
// anatomical, not a measured centimeter position (fact #11); no numeric
// value is invented anywhere in this file.
//
// DOMAIN GAP, continuity note (first reported in Stage 2.5.i.6, not
// re-litigated here): no dedicated wet/dry hair-state axis exists in the
// contract stack. This pilot uses the exact same, already-established
// workaround -- a correctly-named, honest `hairState` Skill parameter --
// for consistency with Stage 2.5.i.6, not as a new decision.
//
// REJECTED FALSE RULE, explicitly (locked authority fact #5): "One Length
// at 0 degrees is never held between fingers" is FALSE and is never
// encoded here -- see the occipital/above-threshold context below, which
// legitimately uses finger control while preserving 0-degree elevation.
//
// CROSS-SKILL DEPENDENCY: this Skill Instance's own
// `prerequisiteSkillInstanceIds` names Stage 2.5.i.6's real Skill Instance
// -- the already-existing, already-built Stage 2.5.i.5 mechanism for
// exactly this kind of cross-Skill ordering. Both instances share the same
// placeholder `compositionId` (order 1 = central nape guide, order 2 =
// this Skill) -- still no ProfessionalComposition record is constructed
// (same reasoning as Stage 2.5.i.6: doing so would imply a real, composed
// client haircut session, out of scope here).

const OCCIPITAL_TRANSITION_VERTICAL = "cutting";
const OCCIPITAL_TRANSITION_AUTHORITY_SOURCE =
  "Closed professional authority -- Stage 2.5.h.2c interview series (One Length / Linie Plina straight profile), Stage 2.5.i.7 pilot authorization.";

export type OccipitalTransitionFact = ExecutionRuleConditionFact | "aboveOccipitalThreshold";

export function isOccipitalTransitionFact(value: unknown): value is OccipitalTransitionFact {
  return value === "aboveOccipitalThreshold" || (typeof value === "string" && (EXECUTION_RULE_CONDITION_FACTS as readonly string[]).includes(value));
}

// Type-safe intermediate constants -- each literal checked by the
// TypeScript compiler against the REAL, already-shipped union type.
const OCCIPITAL_STRUCTURAL_TECHNIQUE: StructuralTechnique = "one_length";
const OCCIPITAL_CUTTING_TECHNIQUE: CuttingTechnique = "blunt_line";
const OCCIPITAL_ELEVATION: TechnicalCutElevation = "0_deg_blunt";
const OCCIPITAL_DISTRIBUTION: TechnicalCutDistribution = "natural_fall";

void (STRUCTURAL_TECHNIQUES satisfies readonly StructuralTechnique[]);
void (CUTTING_TECHNIQUES satisfies readonly CuttingTechnique[]);
void (ELEVATION_OPTIONS satisfies readonly TechnicalCutElevation[]);
void (DISTRIBUTION_OPTIONS satisfies readonly TechnicalCutDistribution[]);

export const OCCIPITAL_TRANSITION_SKILL: SkillDefinition<OccipitalTransitionFact> = {
  skillId: "skill-cutting-occipital-transition",
  version: 1,
  vertical: OCCIPITAL_TRANSITION_VERTICAL,
  name: "Occipital Transition",
  description:
    "Continues posterior structural execution upward from the already-established central nape guide through the occipital anatomical threshold, transitioning control method from comb (below) to fingers (at/above), for the closed straight One Length / Linie Plina profile.",
  status: "ACTIVE",
  authorityType: "PROFESSIONALLY_AUTHORED",
  rationale:
    "Professionally authorized continuation of the closed straight One Length / Linie Plina profile (Stage 2.5.h.2c interview series). The anatomy-conditional comb-to-finger control transition is explicitly authorized, including the explicit rejection of the false universal rule that 0-degree One Length is never held between fingers. Scope ends at this control-method transition -- lateral execution, fringe, finishing, and the optional 45-degree interior graduation are separate, not-yet-authored Skills.",
  parameters: [
    {
      name: "hairState",
      valueKind: "enum",
      allowedValues: ["wet"],
      description: "Hair condition during this Skill's execution -- stable across both control-method contexts.",
    },
    {
      name: "clientHeadPosition",
      valueKind: "enum",
      allowedValues: ["tilted_forward_down"],
      description: "Client head position for posterior/occipital execution -- stable across both control-method contexts.",
    },
    {
      name: "elevation",
      valueKind: "enum",
      allowedValues: [OCCIPITAL_ELEVATION],
      description:
        "The intended zero-degree relationship, preserved across both control-method contexts -- structurally distinct from controlMethod, never a synonym.",
    },
    {
      name: "distribution",
      valueKind: "enum",
      allowedValues: [OCCIPITAL_DISTRIBUTION],
      description: "Strand direction -- controlled downward with natural fall, stable across both control-method contexts.",
    },
    {
      name: "structuralTechnique",
      valueKind: "enum",
      allowedValues: [OCCIPITAL_STRUCTURAL_TECHNIQUE],
      description: "The overall structural technique this transition continues -- no new cutting technique is introduced.",
    },
    {
      name: "cuttingTechnique",
      valueKind: "enum",
      allowedValues: [OCCIPITAL_CUTTING_TECHNIQUE],
      description: "The cutting technique this transition continues.",
    },
    {
      name: "overdirection",
      valueKind: "boolean",
      description: "No overdirection -- part of the authorized profile context, stable across both control-method contexts.",
    },
    {
      name: "controlMethod",
      valueKind: "enum",
      allowedValues: ["comb", "fingers"],
      description:
        "Control method -- ANATOMY/ZONE CONDITIONAL, not stable across this Skill: comb below the occipital curvature, fingers at/above it. Bound per Execution Unit, never as a single Skill-Instance-level value (see Execution Units below).",
    },
  ],
  procedure: [
    {
      order: 1,
      instruction:
        "Continue posterior structural execution upward from the already-established central nape guide, maintaining wet hair and the client's head tilted forward and down throughout.",
      referencedParameters: ["hairState", "clientHeadPosition"],
    },
    {
      order: 2,
      instruction:
        "Below the occipital curvature, control the strand downward with the comb; do not hold the strand between the fingers in this lower area, since finger thickness may lift the hair and introduce unwanted elevation or accidental graduation.",
      referencedParameters: ["controlMethod", "distribution"],
    },
    {
      order: 3,
      instruction:
        "At and above the occipital curvature, the head's changing geometry allows the strand to be controlled downward with the fingers instead, while the client's head remains tilted forward and the strand direction preserves the intended zero-degree relationship.",
      referencedParameters: ["controlMethod", "elevation", "clientHeadPosition"],
    },
    {
      order: 4,
      instruction:
        "Maintain the One Length, blunt-line, natural-fall, zero-degree, no-overdirection structural context across both control-method contexts, without introducing any additional cutting technique.",
      referencedParameters: ["structuralTechnique", "cuttingTechnique", "elevation", "distribution", "overdirection"],
    },
  ],
  applicableZones: ["posterior_below_occipital", "occipital_and_above"],
  // Stage 4 addition -- structured capability declaration, added
  // additively. PRESERVE_LENGTH: the zero-degree/one-length relationship
  // is explicitly maintained across both control-method contexts (this
  // Skill's own rationale: "no new cutting technique is introduced").
  // CONNECT_ZONES: this Skill's entire purpose is continuing posterior
  // execution FROM the already-established central-nape guide INTO the
  // occipital zone -- structurally connecting the two, never a separate,
  // disconnected cut. Zones use the canonical HeadZone vocabulary
  // ("nape", "occipital"), deliberately distinct from this Skill's own
  // vertical-specific applicableZones above.
  capabilities: [
    { kind: "PRESERVE_LENGTH", zones: ["nape", "occipital"] },
    { kind: "CONNECT_ZONES", zones: ["nape", "occipital"] },
  ],
  createdAt: "2026-09-08T00:00:00.000Z",
};

function fixedBinding(parameterName: string, value: string | boolean | number): SkillInstanceParameterBinding<OccipitalTransitionFact> {
  return {
    parameterName,
    bindingState: "FIXED_FROM_AUTHORITY",
    value,
    sourceReference: OCCIPITAL_TRANSITION_AUTHORITY_SOURCE,
  };
}

export const OCCIPITAL_TRANSITION_SKILL_INSTANCE: SkillInstance<OccipitalTransitionFact> = {
  skillInstanceId: "skillinstance-cutting-occipital-transition-pilot",
  vertical: OCCIPITAL_TRANSITION_VERTICAL,
  sourceSkillId: OCCIPITAL_TRANSITION_SKILL.skillId,
  sourceSkillVersion: OCCIPITAL_TRANSITION_SKILL.version,
  // Same placeholder pilot composition as Stage 2.5.i.6 -- see file
  // header. No ProfessionalComposition record is constructed.
  compositionId: "composition-cutting-one-length-pilot-placeholder",
  order: 2,
  // Real cross-Skill ordering, using the already-existing Stage 2.5.i.5
  // mechanism -- this Skill starts only after the central nape guide.
  prerequisiteSkillInstanceIds: [ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.skillInstanceId],
  // NOTE: `controlMethod` is deliberately NOT bound here -- it is not a
  // stable, single Skill-Instance-level fact for this Skill (see the
  // parameter's own description above). It is bound per Execution Unit
  // instead (see ExecutionUnitParameterRule usage below).
  parameterBindings: [
    fixedBinding("hairState", "wet"),
    fixedBinding("clientHeadPosition", "tilted_forward_down"),
    fixedBinding("elevation", OCCIPITAL_ELEVATION),
    fixedBinding("distribution", OCCIPITAL_DISTRIBUTION),
    fixedBinding("structuralTechnique", OCCIPITAL_STRUCTURAL_TECHNIQUE),
    fixedBinding("cuttingTechnique", OCCIPITAL_CUTTING_TECHNIQUE),
    fixedBinding("overdirection", false),
  ],
  createdAt: "2026-09-08T00:00:00.000Z",
};

function controlMethodRule(value: "comb" | "fingers", rationale: string): ExecutionUnitParameterRule<OccipitalTransitionFact> {
  return {
    parameterName: "controlMethod",
    semantic: "REQUIRED_FIXED",
    fixedValue: value,
    rationale,
  };
}

export const OCCIPITAL_TRANSITION_EXECUTION_UNITS: readonly ExecutionUnit<OccipitalTransitionFact>[] = [
  {
    executionUnitId: "executionunit-cutting-occipital-transition-lower-1",
    vertical: OCCIPITAL_TRANSITION_VERTICAL,
    order: 1,
    label: "Posterior / Below Occipital Threshold",
    description:
      "Stable-context scope: below the occipital curvature, comb control, strand controlled downward, zero-degree elevation preserved -- avoids finger-induced unwanted elevation/accidental graduation.",
    zoneId: "posterior_below_occipital",
    laterality: "NOT_APPLICABLE",
    applicabilityCondition: { op: "equals", fact: "aboveOccipitalThreshold", value: false },
    parameterRules: [
      controlMethodRule(
        "comb",
        "Below the occipital curvature, finger thickness may lift the hair, introducing unwanted elevation and accidental graduation that would disturb the intended straight structural line -- control is performed with the comb.",
      ),
    ],
    sourceSkillInstanceId: OCCIPITAL_TRANSITION_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-08T00:00:00.000Z",
  },
  {
    executionUnitId: "executionunit-cutting-occipital-transition-upper-1",
    vertical: OCCIPITAL_TRANSITION_VERTICAL,
    order: 2,
    label: "Occipital / At-and-Above Threshold",
    description:
      "Stable-context scope: at and above the occipital curvature, the head's changing geometry permits finger control while preserving the intended zero-degree relationship -- the false rule that 0-degree One Length is never held between fingers is explicitly rejected here.",
    zoneId: "occipital_and_above",
    laterality: "NOT_APPLICABLE",
    applicabilityCondition: { op: "equals", fact: "aboveOccipitalThreshold", value: true },
    parameterRules: [
      controlMethodRule(
        "fingers",
        "At and above the occipital curvature, the head's curvature changes the geometry such that, with the head tilted forward and the strand kept downward, finger control still preserves the intended zero-degree relationship for this authorized profile.",
      ),
    ],
    // Execution naturally proceeds upward from the lower context.
    prerequisiteExecutionUnitIds: ["executionunit-cutting-occipital-transition-lower-1"],
    sourceSkillInstanceId: OCCIPITAL_TRANSITION_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-08T00:00:00.000Z",
  },
];
