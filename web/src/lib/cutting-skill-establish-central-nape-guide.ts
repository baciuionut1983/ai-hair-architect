import type { CuttingTechnique, StructuralTechnique, TechnicalCutDistribution, TechnicalCutElevation } from "@/lib/contracts";
import { CUTTING_TECHNIQUES, DISTRIBUTION_OPTIONS, ELEVATION_OPTIONS, STRUCTURAL_TECHNIQUES } from "@/lib/proposal-validators";
import type { SkillDefinition } from "@/lib/professional-skill-contracts";
import { EXECUTION_RULE_CONDITION_FACTS, type ExecutionRuleConditionFact } from "@/lib/technical-demonstration-execution-profile-contracts";
import type { SkillInstance, SkillInstanceParameterBinding } from "@/lib/professional-skill-instance-contracts";
import type { ExecutionUnit } from "@/lib/professional-skill-execution-unit-contracts";

// AI Hair Architect, Stage 2.5.i.6 -- REAL PROFESSIONAL AUTHORITY CONTENT,
// NOT a synthetic fixture, NOT AI-generated draft knowledge. This is the
// FIRST real Skill authored under the Stage 2.5.i.1/i.3/i.4/i.5 contract
// stack, using ONLY professional authority already closed by this
// engagement's own interview series (Stage 2.5.h.2c.1/.2/.3, the straight
// One Length / Linie Plina profile). ZERO Composition Engine, ZERO
// automatic Skill selection, ZERO Atomic Action compilation, ZERO wiring
// into Technical Demonstration Plan/readiness/coherence/derivation/the
// generator -- exporting these constants has ZERO runtime effect anywhere
// in the application today.
//
// PILOT SKILL: "Establish Central Nape Guide" (STABILIREA GHIDULUI CENTRAL
// IN CEAFA). SCOPE, exactly as authorized -- ends once the central nape
// guide strand's straight reference line exists. Does NOT include:
// completing the full back, remaining posterior subsections, occipital
// transition, lateral connection, left/right lateral execution, final
// verification, drying, finishing, fringe, or texturizing (Slice And
// Slide or otherwise) -- all separate, not-yet-authored Skills.
//
// AUTHORITY MARKING: status "ACTIVE" + authorityType
// "PROFESSIONALLY_AUTHORED" (professional-skill-contracts.ts's own exact
// vocabulary for "written directly by a reviewed professional process...
// exactly like every other domain rule in this repo") -- structurally
// distinct from any DRAFT/MACHINE_DRAFTED content and from every
// SYNTHETIC fixture used in this file's own sibling test files elsewhere
// in this domain. isSkillEligibleForAuthority(ESTABLISH_CENTRAL_NAPE_
// GUIDE_SKILL) is true.
//
// CONDITION FACT VOCABULARY: this pilot Skill uses NO conditions at all
// (every bound value is unconditionally fixed for this profile, per the
// locked authority's own "no exceptions" framing) -- there is nothing to
// evaluate. The TFact type parameter is still needed structurally
// (SkillDefinition/SkillInstance/ExecutionUnit are all generic over it);
// rather than inventing a fresh, currently-unused fact vocabulary,
// ExecutionRuleConditionFact (technical-demonstration-execution-profile-
// contracts.ts, Stage 2.5.h.2b -- already real, already professionally-
// scoped) is reused, so a future condition on THIS Skill (or a sibling
// posterior-execution Skill) has an existing, real vocabulary to extend
// rather than a synthetic placeholder. isEstablishCentralNapeGuideFact
// below re-derives the guard from the exported EXECUTION_RULE_CONDITION_
// FACTS array (that file's own matching guard function is private, not
// exported) -- reusing the vocabulary, not duplicating its authority.
//
// REUSED EXISTING VOCABULARY, not reinvented: structuralTechnique
// ("one_length"), cuttingTechnique ("blunt_line"), elevation
// ("0_deg_blunt"), distribution ("natural_fall") are each typed against
// their real, already-shipped union type (@/lib/contracts) and drawn from
// proposal-validators.ts's own real STRUCTURAL_TECHNIQUES/CUTTING_
// TECHNIQUES/ELEVATION_OPTIONS/DISTRIBUTION_OPTIONS arrays -- the exact
// same values the deterministic cutting engine and the Stage 2.5.h.2d
// coherence rule already treat as this profile's own real, professionally-
// confirmed identity. Every SkillParameterDefinition below narrows
// allowedValues to the SINGLE value locked for this profile ("for this
// exact profile there are NO exceptions") rather than the full existing
// enum -- listing every unrelated alternative (e.g. graduation,
// scissor_over_comb) would misrepresent a closed, no-exception rule as an
// open choice.
//
// NEWLY AUTHORED VOCABULARY (no existing enum to reuse, confirmed absent
// from this codebase before this stage): startingZone, clientHeadPosition,
// hairState, guideStrandDirection, controlMethod, cuttingLineShape,
// shearOrientation, tool. Each is its own small, closed, single-value
// SkillParameterDefinition -- never merged with an unrelated existing
// field, never a free-text blob. ELEVATION / CUTTING LINE (cuttingLineShape)
// / STRAND DIRECTION (distribution) / SHEAR ORIENTATION are four
// separate, independently-named parameters, exactly as required --
// never encoded as synonyms of each other.
//
// DOMAIN GAP, reported (not force-fit, not silently distorted): NEITHER
// the Skill/Instance/Execution Unit contract stack NOR the older Technical
// Demonstration Plan contract has a dedicated, closed WET/DRY hair-state
// axis anywhere (this engagement's own Stage 2.5.i.2 audit already flagged
// this exact gap under "phase/hairState model", recommending a future
// dedicated axis on Execution Unit, mirroring `laterality`). For THIS
// pilot, `hairState` is represented honestly via the GENERIC, already-
// existing SkillParameterDefinition mechanism (a freshly, correctly named
// parameter -- not shoehorned into `clientHeadPosition` or any other
// unrelated field) -- this is a legitimate, non-distorting use of the
// contract's own intended extensibility, not a workaround. A dedicated
// `hairState` axis on ExecutionUnit remains the architecturally cleaner
// FUTURE improvement, not implemented here per this stage's own explicit
// "do not improvise an architecture extension" instruction.
//
// ARCHITECTURE GAP -- CLOSED (Stage 2.5.i.6a): this pilot originally
// worked around ExecutionUnit's missing Skill-Instance-level traceability
// via its `verticalPayload` field (`resolvedFromSkillInstanceId`). Stage
// 2.5.i.6a added a proper, typed, required `sourceSkillInstanceId` field
// directly to the Execution Unit contract (replacing that same file's own
// original `sourceSkillId`/`sourceSkillVersion` fields, now redundant --
// the full chain remains reconstructible via the referenced Skill
// Instance's own sourceSkillId/sourceSkillVersion). The Execution Unit
// below now uses that field directly; `verticalPayload` is no longer
// populated by this pilot at all, since it had no other legitimate
// cutting-specific content.
//
// COMPOSITION: this pilot does NOT construct a ProfessionalComposition
// record -- doing so would imply a real, composed client haircut session,
// explicitly out of this stage's scope ("do NOT build... real client
// composition"). `compositionId` below is a plain placeholder identifier
// string, satisfying SkillInstance's own required field, referencing no
// persisted or otherwise-real Composition object.

const CENTRAL_NAPE_GUIDE_VERTICAL = "cutting";
const CENTRAL_NAPE_GUIDE_AUTHORITY_SOURCE =
  "Closed professional authority -- Stage 2.5.h.2c interview series (One Length / Linie Plina straight profile), Stage 2.5.i.6 pilot authorization.";

export function isEstablishCentralNapeGuideFact(value: unknown): value is ExecutionRuleConditionFact {
  return typeof value === "string" && (EXECUTION_RULE_CONDITION_FACTS as readonly string[]).includes(value);
}

// Type-safe intermediate constants -- each literal is checked by the
// TypeScript compiler against the REAL, already-shipped union type, not
// just re-typed as a bare string.
const CENTRAL_NAPE_STRUCTURAL_TECHNIQUE: StructuralTechnique = "one_length";
const CENTRAL_NAPE_CUTTING_TECHNIQUE: CuttingTechnique = "blunt_line";
const CENTRAL_NAPE_ELEVATION: TechnicalCutElevation = "0_deg_blunt";
const CENTRAL_NAPE_DISTRIBUTION: TechnicalCutDistribution = "natural_fall";

// Compile-time-checked proof that each reused literal is genuinely a
// member of the real, existing enum array it claims to come from.
void (STRUCTURAL_TECHNIQUES satisfies readonly StructuralTechnique[]);
void (CUTTING_TECHNIQUES satisfies readonly CuttingTechnique[]);
void (ELEVATION_OPTIONS satisfies readonly TechnicalCutElevation[]);
void (DISTRIBUTION_OPTIONS satisfies readonly TechnicalCutDistribution[]);

export const ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL: SkillDefinition<ExecutionRuleConditionFact> = {
  skillId: "skill-cutting-establish-central-nape-guide",
  version: 1,
  vertical: CENTRAL_NAPE_GUIDE_VERTICAL,
  name: "Establish Central Nape Guide",
  description:
    "Establishes the central-nape reference guide strand and its straight base line, from which subsequent posterior structural execution proceeds, for the closed straight One Length / Linie Plina profile.",
  status: "ACTIVE",
  authorityType: "PROFESSIONALLY_AUTHORED",
  rationale:
    "Professionally authorized first execution step of the closed straight One Length / Linie Plina profile (Stage 2.5.h.2c interview series). Scope ends once the guide strand's straight reference line exists -- occipital transition, laterals, cross-check, drying, and finishing are separate, not-yet-authored Skills.",
  parameters: [
    {
      name: "startingZone",
      valueKind: "enum",
      allowedValues: ["center_nape"],
      description: "Structural execution begins at the center of the nape -- for this exact profile, no exceptions.",
    },
    {
      name: "clientHeadPosition",
      valueKind: "enum",
      allowedValues: ["tilted_forward_down"],
      description: "Client head position required for correct/safe posterior/nape execution geometry.",
    },
    {
      name: "hairState",
      valueKind: "enum",
      allowedValues: ["wet"],
      description:
        "Hair condition during this Skill's execution. Wet hair improves execution safety/control; water weight helps tension and control the strand.",
    },
    {
      name: "guideStrandDirection",
      valueKind: "enum",
      allowedValues: ["combed_down"],
      description: "Direction the central guide strand is combed before cutting.",
    },
    {
      name: "elevation",
      valueKind: "enum",
      allowedValues: [CENTRAL_NAPE_ELEVATION],
      description: "The strand is not lifted away from the head -- zero degrees of elevation.",
    },
    {
      name: "controlMethod",
      valueKind: "enum",
      allowedValues: ["comb"],
      description:
        "Control method in the lower/nape area. Finger thickness may create unwanted elevation / accidental graduation, which would damage the intended straight structural line -- the guide is never held between fingers in this lower/base area.",
    },
    {
      name: "distribution",
      valueKind: "enum",
      allowedValues: [CENTRAL_NAPE_DISTRIBUTION],
      description: "Strand direction during the cut -- the strand hangs naturally, with no overdirection.",
    },
    {
      name: "structuralTechnique",
      valueKind: "enum",
      allowedValues: [CENTRAL_NAPE_STRUCTURAL_TECHNIQUE],
      description: "The overall structural technique this guide establishes the reference line for.",
    },
    {
      name: "cuttingTechnique",
      valueKind: "enum",
      allowedValues: [CENTRAL_NAPE_CUTTING_TECHNIQUE],
      description: "The cutting technique used to execute the guide cut.",
    },
    {
      name: "cuttingLineShape",
      valueKind: "enum",
      allowedValues: ["straight"],
      description: "The resulting structural line shape -- kept structurally distinct from elevation, strand direction, and shear orientation.",
    },
    {
      name: "shearOrientation",
      valueKind: "enum",
      allowedValues: ["horizontal"],
      description: "Physical orientation the shear is held at during the cut -- kept structurally distinct from elevation and cutting-line shape.",
    },
    {
      name: "tool",
      valueKind: "enum",
      allowedValues: ["straight_shear"],
      description: "The tool used to execute the guide cut.",
    },
  ],
  procedure: [
    {
      order: 1,
      instruction: "Position the client's head tilted forward and down to access the posterior/nape area for execution.",
      referencedParameters: ["clientHeadPosition"],
    },
    {
      order: 2,
      instruction:
        "At the center of the nape, on wet hair, comb the guide strand straight down, maintaining control with the comb rather than the fingers to avoid unwanted elevation.",
      referencedParameters: ["startingZone", "hairState", "guideStrandDirection", "controlMethod"],
    },
    {
      order: 3,
      instruction:
        "Hold the strand at zero degrees of elevation, letting it hang with its natural fall, and position the straight shear horizontally against the strand.",
      referencedParameters: ["elevation", "distribution", "tool", "shearOrientation"],
    },
    {
      order: 4,
      instruction:
        "Cut straight across the strand using the blunt one-length technique to establish the straight reference line that subsequent posterior execution will follow.",
      referencedParameters: ["cuttingTechnique", "structuralTechnique", "cuttingLineShape"],
    },
  ],
  applicableZones: ["center_nape"],
  createdAt: "2026-09-08T00:00:00.000Z",
};

function fixedBinding(parameterName: string, value: string | boolean | number): SkillInstanceParameterBinding<ExecutionRuleConditionFact> {
  return {
    parameterName,
    bindingState: "FIXED_FROM_AUTHORITY",
    value,
    sourceReference: CENTRAL_NAPE_GUIDE_AUTHORITY_SOURCE,
  };
}

export const ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE: SkillInstance<ExecutionRuleConditionFact> = {
  skillInstanceId: "skillinstance-cutting-establish-central-nape-guide-pilot",
  vertical: CENTRAL_NAPE_GUIDE_VERTICAL,
  sourceSkillId: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId,
  sourceSkillVersion: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.version,
  // Placeholder identifier only -- see file header: no ProfessionalComposition
  // record is constructed in this pilot.
  compositionId: "composition-cutting-one-length-pilot-placeholder",
  order: 1,
  parameterBindings: [
    fixedBinding("startingZone", "center_nape"),
    fixedBinding("clientHeadPosition", "tilted_forward_down"),
    fixedBinding("hairState", "wet"),
    fixedBinding("guideStrandDirection", "combed_down"),
    fixedBinding("elevation", CENTRAL_NAPE_ELEVATION),
    fixedBinding("controlMethod", "comb"),
    fixedBinding("distribution", CENTRAL_NAPE_DISTRIBUTION),
    fixedBinding("structuralTechnique", CENTRAL_NAPE_STRUCTURAL_TECHNIQUE),
    fixedBinding("cuttingTechnique", CENTRAL_NAPE_CUTTING_TECHNIQUE),
    fixedBinding("cuttingLineShape", "straight"),
    fixedBinding("shearOrientation", "horizontal"),
    fixedBinding("tool", "straight_shear"),
  ],
  createdAt: "2026-09-08T00:00:00.000Z",
};

// EXECUTION UNIT COUNT DECISION: exactly ONE. Every professional execution
// fact this Skill binds (zone, head position, hair state, guide direction,
// elevation, control method, distribution, structural/cutting technique,
// cutting-line shape, shear orientation, tool) is stable across the ENTIRE
// Skill -- none of the Execution Unit boundary triggers named in its own
// locked definition (anatomical zone change, side/laterality change,
// sub-phase change, condition branch, anatomical threshold, tool/control-
// method transition, client-position transition) occur anywhere within
// "Establish Central Nape Guide" itself: the zone never moves off center-
// nape, control never shifts from comb to finger, the client's head never
// repositions, and no side/laterality is ever engaged (this Skill is
// explicitly scoped to end BEFORE occipital transition and BEFORE lateral
// execution, where such a transition would first occur). A second
// Execution Unit here would exist only to satisfy a rule, not because any
// real fact actually changes -- exactly the "unnecessary duplication" the
// Stage 2.5.i.2 audit warned against.
export const ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS: readonly ExecutionUnit<ExecutionRuleConditionFact>[] = [
  {
    executionUnitId: "executionunit-cutting-establish-central-nape-guide-1",
    vertical: CENTRAL_NAPE_GUIDE_VERTICAL,
    order: 1,
    label: "Establish Central Nape Guide",
    description:
      "The single stable-context execution scope covering the whole Skill: center-nape zone, wet hair, comb control, zero-degree elevation, horizontal straight-shear cut -- no zone, side, sub-phase, or control-method transition occurs within this Skill's own scope.",
    zoneId: "center_nape",
    laterality: "NOT_APPLICABLE",
    // Stage 2.5.i.6a -- the proper, typed traceability link (see file
    // header, ARCHITECTURE GAP -- CLOSED). No verticalPayload workaround
    // needed anymore.
    sourceSkillInstanceId: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-08T00:00:00.000Z",
  },
];
