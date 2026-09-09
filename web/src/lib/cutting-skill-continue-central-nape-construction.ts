import type { CuttingTechnique, StructuralTechnique, TechnicalCutDistribution, TechnicalCutElevation } from "@/lib/contracts";
import { CUTTING_TECHNIQUES, DISTRIBUTION_OPTIONS, ELEVATION_OPTIONS, STRUCTURAL_TECHNIQUES } from "@/lib/proposal-validators";
import type { SkillDefinition } from "@/lib/professional-skill-contracts";
import type { SkillInstance, SkillInstanceParameterBinding } from "@/lib/professional-skill-instance-contracts";
import type { ExecutionUnit } from "@/lib/professional-skill-execution-unit-contracts";
import { ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE } from "@/lib/cutting-skill-establish-central-nape-guide";
import { isOccipitalTransitionFact, type OccipitalTransitionFact } from "@/lib/cutting-skill-occipital-transition";

// AI Hair Architect, Stage 2.5.i.25 -- REAL PROFESSIONAL AUTHORITY CONTENT,
// NOT a synthetic fixture. Authored directly from explicit professional
// input closing the Stage 2.5.i.24 audit's own identified prerequisite.
// ZERO Composition Engine, ZERO automatic Skill selection, ZERO wiring
// into Technical Demonstration Plan/readiness/coherence/derivation/the
// generator -- exporting these constants has ZERO runtime effect anywhere
// in the application today.
//
// PILOT SKILL: "Continue Central Nape Construction". SCOPE, exactly as
// authorized -- starts AFTER the central nape guide (Stage 2.5.i.6) is
// already established, and covers the REPEATED construction of successive
// subsections upward from that guide, strictly BELOW the occipital
// anatomical threshold. Does NOT include: establishing the initial guide
// itself (Stage 2.5.i.6's own Skill), the occipital transition or anything
// at/above it (Stage 2.5.i.7's own Skill, entirely untouched by this
// file), lateral execution, fringe, finishing, or any other not-yet-
// authored Skill.
//
// A NEW, SEPARATE SKILL -- NOT an edit to Central Nape Guide or Occipital
// Transition (Stage 2.5.i.24 audit's own explicit conclusion): Central
// Nape Guide's own header already locks its scope to "ends once the guide
// strand's straight reference line exists" -- extending it would
// contradict its own already-shipped, already-tested authority. Occipital
// Transition's own lower Execution Unit already covers the same stable
// technical facts (comb, below threshold) but was never built to
// represent REPETITION -- adding that here, as a new file, avoids any risk
// of regressing Occipital Transition's own real, already-tested content
// (its own Skill Definition's every parameter would otherwise need a new
// binding too, per compileExecutionUnitToAtomicActions's own "every
// declared parameter must resolve" fail-closed rule).
//
// FACT VOCABULARY -- REUSED, NOT REDECLARED: this Skill's own TFact type
// is `OccipitalTransitionFact` (cutting-skill-occipital-transition.ts),
// imported directly rather than re-declaring an identical
// `aboveOccipitalThreshold` boolean fact a second time. The anatomical
// threshold this Skill's own applicabilityCondition gates on
// (`aboveOccipitalThreshold: false`) is the EXACT SAME real-world boundary
// Occipital Transition's own lower Execution Unit already gates on --
// reusing the identical fact is this domain's own established "reuse a
// value only when the meaning is identical" discipline, not a new
// dependency invented for convenience.
//
// ITERATION -- THE STAGE 2.5.i.24 AUDIT'S OWN RECOMMENDED MECHANISM,
// ACTIVATED HERE FOR THE FIRST TIME: this Skill's own single Execution
// Unit declares `verticalPayload.iterationPolicy` (a small, cutting-scoped
// convention read by cutting-skill-atomic-action-compiler.ts's own new
// resolveIterationForActionKind, Stage 2.5.i.25) naming CONTROL and
// EXECUTE (never POSITION, which is a one-shot client-positioning action,
// never repeated) as the action kinds that repeat, with
// `mode: "UNTIL_EXECUTION_UNIT_COMPLETE"` -- the professional truth is
// "repeat while this Execution Unit's own conditions remain true", NEVER
// a fixed count. The current pilot's own "2-4 subsections" and "~1cm"
// targets are DELIBERATELY ABSENT from this file entirely -- both are
// demonstration-layer rendering parameters (task's own explicit "NOT
// universal authority" instruction), supplied only at the provider-
// request/serializer boundary, never written into this Skill.
//
// PROGRESSIVE GUIDE REFERENCE -- NOT a fixed pointer back to the original
// guide: `guideReferenceMode` is bound to exactly one value,
// "previous_subsection" -- the immediately preceding cut, which itself
// becomes the reference for the NEXT subsection, and so on. This is a
// single, uniform, RELATIVE rule (mirrors a recurrence relation: the same
// rule applied at every step produces a different concrete guide each
// time) -- it does not need N different values for N repetitions, because
// the rule itself never changes. Explicitly rejected: any value naming a
// FIXED target (e.g. "central_guide" or "original_guide"), which would
// misrepresent the professional's own explicit instruction that "S2 does
// not incorrectly reference only original G0".
//
// GUIDE IDENTIFIABILITY -- a SEPARATE fact from the reference rule above
// (professional's own explicit "represent target thickness and guide-
// identifiability as distinct semantics" instruction): `guideIdentifiabilityCriterion`
// states the professional CONDITION ("the previously cut guide must
// remain visually identifiable, or the subsection is too thick and must
// be reduced") -- never itself a thickness value, never itself the
// reference rule.
//
// WHAT THIS FILE DOES NOT DO: it does not name a subsection thickness, a
// repeat count, a video duration, a provider, or a model anywhere. It
// does not modify cutting-skill-establish-central-nape-guide.ts or
// cutting-skill-occipital-transition.ts (both remain byte-unchanged). It
// does not introduce FINGERS control, graduation, Slice And Slide,
// texturizing, elevation above 0deg, or overdirection -- none of those
// facts exist anywhere in this file's own parameters/bindings, so no
// downstream layer can ever render them from this Skill.

const CONTINUE_CENTRAL_NAPE_CONSTRUCTION_VERTICAL = "cutting";
const CONTINUE_CENTRAL_NAPE_CONSTRUCTION_AUTHORITY_SOURCE =
  "Closed professional authority -- Stage 2.5.h.2c interview series (One Length / Linie Plina straight profile) + explicit Stage 2.5.i.24/i.25 professional input closing the procedural-progression prerequisite.";

// Reused directly -- see file header. No new fact is declared here.
export type ContinueCentralNapeConstructionFact = OccipitalTransitionFact;
export const isContinueCentralNapeConstructionFact = isOccipitalTransitionFact;

const CONSTRUCTION_STRUCTURAL_TECHNIQUE: StructuralTechnique = "one_length";
const CONSTRUCTION_CUTTING_TECHNIQUE: CuttingTechnique = "blunt_line";
const CONSTRUCTION_ELEVATION: TechnicalCutElevation = "0_deg_blunt";
const CONSTRUCTION_DISTRIBUTION: TechnicalCutDistribution = "natural_fall";

void (STRUCTURAL_TECHNIQUES satisfies readonly StructuralTechnique[]);
void (CUTTING_TECHNIQUES satisfies readonly CuttingTechnique[]);
void (ELEVATION_OPTIONS satisfies readonly TechnicalCutElevation[]);
void (DISTRIBUTION_OPTIONS satisfies readonly TechnicalCutDistribution[]);

export const CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL: SkillDefinition<ContinueCentralNapeConstructionFact> = {
  skillId: "skill-cutting-continue-central-nape-construction",
  version: 1,
  vertical: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_VERTICAL,
  name: "Continue Central Nape Construction",
  description:
    "Continues posterior structural execution upward from the already-established central nape guide, repeating comb-controlled subsection construction while strictly below the occipital anatomical threshold, for the closed straight One Length / Linie Plina profile.",
  status: "ACTIVE",
  authorityType: "PROFESSIONALLY_AUTHORED",
  rationale:
    "Professionally authorized continuation of the closed straight One Length / Linie Plina profile (Stage 2.5.h.2c interview series), closing the procedural-progression prerequisite identified by the Stage 2.5.i.24 audit and confirmed by explicit professional input. Scope ends at the occipital anatomical threshold -- the Occipital Transition Skill (Stage 2.5.i.7) owns everything at and above it; this Skill never continues silently past that boundary.",
  parameters: [
    {
      name: "hairState",
      valueKind: "enum",
      allowedValues: ["wet"],
      description: "Hair condition throughout repeated subsection construction -- stable across every repetition.",
    },
    {
      name: "clientHeadPosition",
      valueKind: "enum",
      allowedValues: ["tilted_forward_down"],
      description: "Client head position for posterior/nape execution -- stable across every repetition.",
    },
    {
      name: "controlMethod",
      valueKind: "enum",
      allowedValues: ["comb"],
      description: "Control method while strictly below the occipital threshold -- for this Skill's own scope, no exceptions (fingers is Occipital Transition's own, separate authority).",
    },
    {
      name: "distribution",
      valueKind: "enum",
      allowedValues: [CONSTRUCTION_DISTRIBUTION],
      description: "Each new subsection hangs with its own natural fall, no overdirection, stable across every repetition.",
    },
    {
      name: "elevation",
      valueKind: "enum",
      allowedValues: [CONSTRUCTION_ELEVATION],
      description: "Zero-degree elevation preserved across every repetition -- hair is never lifted away from the head.",
    },
    {
      name: "overdirection",
      valueKind: "boolean",
      description: "No overdirection -- part of the authorized profile context, stable across every repetition.",
    },
    {
      name: "structuralTechnique",
      valueKind: "enum",
      allowedValues: [CONSTRUCTION_STRUCTURAL_TECHNIQUE],
      description: "The overall structural technique this repeated construction continues -- no new cutting technique is introduced.",
    },
    {
      name: "cuttingTechnique",
      valueKind: "enum",
      allowedValues: [CONSTRUCTION_CUTTING_TECHNIQUE],
      description: "The cutting technique used for every repeated subsection cut.",
    },
    {
      name: "cuttingLineShape",
      valueKind: "enum",
      allowedValues: ["straight"],
      description: "The resulting structural line shape for every repeated subsection -- kept structurally distinct from elevation, strand direction, and shear orientation.",
    },
    {
      name: "shearOrientation",
      valueKind: "enum",
      allowedValues: ["horizontal"],
      description: "Physical orientation the shear is held at during every repeated cut.",
    },
    {
      name: "tool",
      valueKind: "enum",
      allowedValues: ["straight_shear"],
      description: "The tool used for every repeated subsection cut.",
    },
    {
      name: "guideReferenceMode",
      valueKind: "enum",
      allowedValues: ["previous_subsection"],
      description:
        "Each new subsection is cut to the guide established by the IMMEDIATELY PRECEDING subsection -- never a fixed pointer back to the original guide. The same relative rule applies at every repetition; only the concrete guide it resolves to changes as construction progresses upward.",
    },
    {
      name: "guideIdentifiabilityCriterion",
      valueKind: "enum",
      allowedValues: ["must_remain_visually_identifiable"],
      description:
        "After separating and combing the new subsection into working position, the previously cut guide must remain sufficiently visible/identifiable to determine unambiguously where the new subsection is cut. If it cannot be identified, the subsection is too thick for the current conditions and must be reduced -- a criterion distinct from any specific thickness target.",
    },
  ],
  procedure: [
    {
      order: 1,
      instruction: "Maintain the client's head tilted forward and down and the hair wet throughout repeated posterior/nape construction.",
      referencedParameters: ["clientHeadPosition", "hairState"],
    },
    {
      order: 2,
      instruction: "Take the next subsection and comb it into natural fall with the comb, controlling it downward while strictly below the occipital threshold.",
      referencedParameters: ["controlMethod", "distribution"],
    },
    {
      order: 3,
      instruction: "Confirm the previously cut guide remains visually identifiable through or alongside the new subsection; if it cannot be identified, reduce the subsection.",
      referencedParameters: ["guideIdentifiabilityCriterion"],
    },
    {
      order: 4,
      instruction: "Hold the subsection at zero degrees of elevation with no overdirection, and cut it horizontally with the straight shear to the guide established by the immediately preceding subsection.",
      referencedParameters: ["elevation", "overdirection", "tool", "shearOrientation", "guideReferenceMode"],
    },
    {
      order: 5,
      instruction: "The freshly cut subsection itself becomes the guide reference for the next subsection; advance upward and repeat while still strictly below the occipital threshold, maintaining the One Length, blunt-line, straight structural context throughout.",
      referencedParameters: ["cuttingTechnique", "structuralTechnique", "cuttingLineShape"],
    },
  ],
  applicableZones: ["posterior_below_occipital"],
  createdAt: "2026-09-09T00:00:00.000Z",
};

function fixedBinding(parameterName: string, value: string | boolean | number): SkillInstanceParameterBinding<ContinueCentralNapeConstructionFact> {
  return {
    parameterName,
    bindingState: "FIXED_FROM_AUTHORITY",
    value,
    sourceReference: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_AUTHORITY_SOURCE,
  };
}

export const CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE: SkillInstance<ContinueCentralNapeConstructionFact> = {
  skillInstanceId: "skillinstance-cutting-continue-central-nape-construction-pilot",
  vertical: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_VERTICAL,
  sourceSkillId: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.skillId,
  sourceSkillVersion: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.version,
  // Same placeholder pilot composition as Stage 2.5.i.6/i.7 -- no
  // ProfessionalComposition record is constructed.
  compositionId: "composition-cutting-one-length-pilot-placeholder",
  order: 2,
  // Real cross-Skill ordering, using the already-existing Stage 2.5.i.5
  // mechanism -- this Skill continues only after the central nape guide.
  prerequisiteSkillInstanceIds: [ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.skillInstanceId],
  parameterBindings: [
    fixedBinding("hairState", "wet"),
    fixedBinding("clientHeadPosition", "tilted_forward_down"),
    fixedBinding("controlMethod", "comb"),
    fixedBinding("distribution", CONSTRUCTION_DISTRIBUTION),
    fixedBinding("elevation", CONSTRUCTION_ELEVATION),
    fixedBinding("overdirection", false),
    fixedBinding("structuralTechnique", CONSTRUCTION_STRUCTURAL_TECHNIQUE),
    fixedBinding("cuttingTechnique", CONSTRUCTION_CUTTING_TECHNIQUE),
    fixedBinding("cuttingLineShape", "straight"),
    fixedBinding("shearOrientation", "horizontal"),
    fixedBinding("tool", "straight_shear"),
    fixedBinding("guideReferenceMode", "previous_subsection"),
    fixedBinding("guideIdentifiabilityCriterion", "must_remain_visually_identifiable"),
  ],
  createdAt: "2026-09-09T00:00:00.000Z",
};

// EXECUTION UNIT COUNT DECISION: exactly ONE, mirroring Central Nape
// Guide's own identical reasoning -- every fact this Skill binds is stable
// across the ENTIRE Skill (the zone never moves off "posterior, strictly
// below occipital"; control never shifts from comb; no side/laterality is
// ever engaged). The single boundary trigger that WOULD warrant a second
// unit (the occipital anatomical threshold) is exactly where this Skill's
// own authority ends -- it is Occipital Transition's own, separate
// Execution Unit that begins past that boundary, never a second unit
// inside this file.
export const CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS: readonly ExecutionUnit<ContinueCentralNapeConstructionFact>[] = [
  {
    executionUnitId: "executionunit-cutting-continue-central-nape-construction-1",
    vertical: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_VERTICAL,
    order: 1,
    label: "Continue Central Nape Construction",
    description:
      "The single stable-context execution scope covering the whole Skill: posterior nape, strictly below the occipital threshold, wet hair, comb control, zero-degree elevation, horizontal straight-shear cuts, repeated subsection-by-subsection construction referencing the immediately preceding guide -- valid only while this Execution Unit's own conditions remain true.",
    zoneId: "posterior_below_occipital",
    laterality: "NOT_APPLICABLE",
    // Reuses the EXACT SAME real-world anatomical boundary Occipital
    // Transition's own lower Execution Unit gates on -- see file header.
    applicabilityCondition: { op: "equals", fact: "aboveOccipitalThreshold", value: false },
    // Stage 2.5.i.25 -- see file header. Read by
    // cutting-skill-atomic-action-compiler.ts's own resolveIterationForActionKind;
    // POSITION is deliberately absent (one-shot, never repeated).
    verticalPayload: {
      iterationPolicy: {
        actionKinds: ["CONTROL", "EXECUTE"],
        iteration: {
          mode: "UNTIL_EXECUTION_UNIT_COMPLETE",
          note: "Repeat subsection-by-subsection, each referencing the immediately preceding cut guide, advancing anatomically upward, while this Execution Unit's own conditions (strictly below the occipital threshold) remain true.",
        },
      },
    },
    sourceSkillInstanceId: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-09T00:00:00.000Z",
  },
];
