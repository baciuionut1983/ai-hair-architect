import type { CuttingTechnique, StructuralTechnique, TechnicalCutElevation, TexturizingTechnique } from "@/lib/contracts";
import { CUTTING_TECHNIQUES, ELEVATION_OPTIONS, STRUCTURAL_TECHNIQUES, TEXTURIZING_TECHNIQUES } from "@/lib/proposal-validators";
import type { SkillDefinition } from "@/lib/professional-skill-contracts";
import { EXECUTION_RULE_CONDITION_FACTS, type ExecutionRuleConditionFact } from "@/lib/technical-demonstration-execution-profile-contracts";
import type { SkillInstance, SkillInstanceParameterBinding } from "@/lib/professional-skill-instance-contracts";
import type { ExecutionUnit } from "@/lib/professional-skill-execution-unit-contracts";

// AI Hair Architect, Stage 8.5S1B -- REAL PROFESSIONAL AUTHORITY CONTENT,
// NOT a synthetic fixture. Authored directly from Ionuț's corrected
// definition (Stage 8.5S1A.1 correction #1 + this stage's own verbatim
// professional input). ZERO Composition Engine, ZERO automatic Skill
// selection, ZERO wiring into Technical Demonstration Plan/readiness/
// coherence/derivation/the generator -- exporting these constants has ZERO
// runtime effect anywhere in the application today.
//
// SKILL: "Slice-and-Slide Refinement" -- a FINAL REFINEMENT skill, NOT
// primary structural construction, NOT a generic "remove weight" skill.
// Primary professional purpose, verbatim from Ionuț: "SOFT INTEGRATION OF
// THE ENDS / TERMINATIONS AFTER A GRADUATED STRUCTURE." Applied only where
// a graduated structure already exists -- never to preserve a pure
// straight one-length/blunt line (incompatibleSkillIds below).
//
// CAPABILITY: REFINE_ENDS, deliberately the ONLY declared capability.
// REFINE_ENDS is a PROCEDURAL capability kind (professional-skill-
// contracts.ts's own SKILL_CAPABILITY_KINDS header) -- "a real, honest
// thing a skill does, but NOT a state transformation a delta ever
// expresses on its own." This is the precise, honest fit for "soft
// integration of terminations": no OUTCOME capability (REDUCE_WEIGHT
// included) is declared, per Ionuț's own explicit correction ("It is NOT
// primarily a generic REDUCE_WEIGHT skill... Do NOT make REDUCE_WEIGHT the
// defining purpose unless Ionuț later confirms that for a particular
// execution"). Consequence, accepted and reported (not worked around):
// because REFINE_ENDS is procedural, this Skill can NEVER become a Stage 4
// deterministic candidate via selectCandidateSkillsForDelta -- it is a
// composition-time finishing step, chosen because a composition already
// contains a graduated structure and soft integration is professionally
// intended, never because a HairStateDelta entry required it. This is the
// architecturally correct, honest consequence of the capability model,
// not a gap to be faked around.
//
// DEPENDENCY / INCOMPATIBILITY, both structural, both declarative only
// (consulted by a future composition engine, never enforced by any
// runtime code today): `prerequisiteSkillIds` names Graduated Cutting's
// own real skillKey directly ("applied after a graduated structure
// exists"); `incompatibleSkillIds` names Construct One-Length Perimeter's
// own real skillKey directly ("NOT used to preserve a pure straight
// one-length line") -- the exact mirror of that Skill's own reciprocal
// declaration.
//
// REAL VOCABULARY REUSE: `cuttingTechnique` binds the real, already-
// shipped CuttingTechnique value "slice_cutting" (contracts.ts) -- the
// mechanical action Ionuț describes (partially open scissors, controlled
// sliding/scraping, partial closure through the strand) is exactly what
// this existing enum value already names. `texturizingTechnique` binds
// the real TexturizingTechnique value "slice_and_slide" -- this Skill's
// own name IS an already-shipped enum member, confirming strong,
// pre-existing vocabulary alignment rather than a coincidence.
//
// WORKING DEPTH, PROFESSIONAL RANGES NOT UNIVERSAL CONSTANTS (Ionuț's own
// explicit instruction): "shorter hair ~2-3cm... longer hair commonly
// ~5cm, potentially 5-10cm depending on case." Represented via
// `workingDepth` as a free-text `valueKind: "string"` parameter, bound at
// Skill-Instance level with `bindingState: "DEMONSTRATION_SPECIFIC"` --
// the exact same mechanism used by Construct One-Length Perimeter's own
// `subsectionThickness` for the identical "real range, fixed only for one
// deterministic demonstration" situation.
//
// COMPLETION -- ONE SLIDE IS NOT A COMPLETED TECHNIQUE (task's own
// permanent rule, Ionuț's own explicit instruction): represented via
// `verticalPayload.iterationPolicy` (UNTIL_EXECUTION_UNIT_COMPLETE),
// exactly the mechanism Continue Central Nape Construction already
// activated -- this Skill's own Execution Unit repeats across the
// intended graduated area, never a single isolated slide.
//
// NOT DECLARED, ON PURPOSE (no professional content to represent
// honestly): exact hand/finger geometry beyond what Ionuț specified is
// never invented; no numeric working-depth constant; no claim that
// refinement "removes as much weight as possible."
//
// STAGE 8.5S1B.R1 CORRECTION: `tool`, `elevation`, and `hairState` were
// each declared with a real, OPEN parameter (multiple allowedValues) --
// correctly parameterized -- but bound at Skill-Instance level with
// FIXED_FROM_AUTHORITY, which structurally claims "this is the one
// authoritative universal value," contradicting their own parameter
// descriptions ("never a fixed value of this Skill's own" /
// "depending on case"). Corrected to PROFESSIONAL_CHOICE: a real,
// open, case-dependent choice, never Ionuț's own stated universal law
// (unlike `controlMethod`="fingers" and `strandControl`/`scissorControl`,
// which ARE his own stated, definitive technique and stay
// FIXED_FROM_AUTHORITY).

const SLICE_AND_SLIDE_REFINEMENT_VERTICAL = "cutting";
const SLICE_AND_SLIDE_REFINEMENT_AUTHORITY_SOURCE = "Professional authority -- Ionuț's approved corrected definition, Stage 8.5S1A.1 correction + Stage 8.5S1B implementation authorization (2026-09-11).";

export function isSliceAndSlideRefinementFact(value: unknown): value is ExecutionRuleConditionFact {
  return typeof value === "string" && (EXECUTION_RULE_CONDITION_FACTS as readonly string[]).includes(value);
}

const REFINEMENT_CUTTING_TECHNIQUE: CuttingTechnique = "slice_cutting";
const REFINEMENT_TEXTURIZING_TECHNIQUE: TexturizingTechnique = "slice_and_slide";
const REFINEMENT_STRUCTURAL_TECHNIQUE: StructuralTechnique = "graduation";
const REFINEMENT_ELEVATION_DEFAULT: TechnicalCutElevation = "90_deg_uniform_layer";

void (STRUCTURAL_TECHNIQUES satisfies readonly StructuralTechnique[]);
void (CUTTING_TECHNIQUES satisfies readonly CuttingTechnique[]);
void (TEXTURIZING_TECHNIQUES satisfies readonly TexturizingTechnique[]);
void (ELEVATION_OPTIONS satisfies readonly TechnicalCutElevation[]);

export const SLICE_AND_SLIDE_REFINEMENT_SKILL: SkillDefinition<ExecutionRuleConditionFact> = {
  skillId: "skill-cutting-slice-and-slide-refinement",
  version: 1,
  vertical: SLICE_AND_SLIDE_REFINEMENT_VERTICAL,
  name: "Slice-and-Slide Refinement",
  description:
    "Final refinement applied across an already-graduated structure's terminations, softly integrating the ends via a controlled, partial-closure scissor slide -- never a primary structural technique, never used where a pure straight one-length line must remain intact.",
  status: "ACTIVE",
  authorityType: "PROFESSIONALLY_AUTHORED",
  rationale:
    "Professionally authorized by Ionuț: applied at the end, for final finishing, so terminations integrate softly, only on graduated haircuts, never on straight-line ones. Purpose is soft termination integration, not primary weight removal -- REFINE_ENDS, not REDUCE_WEIGHT.",
  parameters: [
    {
      name: "hairState",
      valueKind: "enum",
      allowedValues: ["wet", "dry"],
      description: "Hair condition during refinement -- performed as a final step, on wet or dry hair depending on case.",
    },
    {
      name: "strandControl",
      valueKind: "enum",
      allowedValues: ["index_middle_finger_fingers_downward"],
      description: "The strand is held between the index and middle fingers, fingers oriented downward.",
    },
    {
      name: "scissorControl",
      valueKind: "enum",
      allowedValues: ["partially_open_tip_toward_strand_horizontal_blade_partial_closure_slide"],
      description:
        "Scissors partially open, tip oriented toward the strand, blade approximately horizontal relative to the strand, moved in a controlled sliding/scraping motion; the scissors do not fully close through the strand -- controlled partial closure cuts only part of the fibers.",
    },
    {
      name: "clientHeadPosition",
      valueKind: "enum",
      allowedValues: ["upright"],
      description: "Client head position for refinement execution -- a natural, resting upright position, appropriate across the graduated surface generally.",
    },
    {
      name: "controlMethod",
      valueKind: "enum",
      allowedValues: ["fingers"],
      description: "Control method -- the strand is held between the fingers throughout this Skill's own refinement pass.",
    },
    {
      name: "workingDepth",
      valueKind: "string",
      description:
        "Approximate working depth from the termination -- shorter hair approximately 2-3 cm, longer hair commonly approximately 5 cm, potentially within 5-10 cm depending on case. Professional ranges, never a fixed universal depth.",
    },
    {
      name: "tool",
      valueKind: "enum",
      allowedValues: ["straight_shear", "texturizer_shear"],
      description: "The tool used to execute the refinement slide.",
    },
    {
      name: "cuttingTechnique",
      valueKind: "enum",
      allowedValues: [REFINEMENT_CUTTING_TECHNIQUE],
      description: "The mechanical cutting action -- a controlled sliding/scraping cut through part of the strand.",
    },
    {
      name: "texturizingTechnique",
      valueKind: "enum",
      allowedValues: [REFINEMENT_TEXTURIZING_TECHNIQUE],
      description: "The overall texturizing technique this Skill executes.",
    },
    {
      name: "structuralTechnique",
      valueKind: "enum",
      allowedValues: [REFINEMENT_STRUCTURAL_TECHNIQUE],
      description: "The structural technique this refinement is applied to -- an already-graduated structure. This Skill never constructs the structure itself.",
    },
    {
      name: "elevation",
      valueKind: "enum",
      allowedValues: ELEVATION_OPTIONS,
      description: "The elevation of the already-graduated section being refined -- inherited from whichever graduation was performed, never a fixed value of this Skill's own.",
    },
  ],
  procedure: [
    {
      order: 1,
      instruction: "Select a section within the intended graduated area whose structure already exists -- never a zone intended to remain a pure straight one-length/blunt line.",
      referencedParameters: ["structuralTechnique"],
    },
    {
      order: 2,
      instruction:
        "Hold the strand between the index and middle fingers, fingers oriented downward. Open the scissors partially, orient the tip toward the strand, keep the blade approximately horizontal relative to the strand, and perform a controlled sliding/scraping movement, closing the scissors only partially through the strand.",
      referencedParameters: ["clientHeadPosition", "controlMethod", "strandControl", "scissorControl", "tool", "cuttingTechnique"],
    },
    {
      order: 3,
      instruction: "Work the intended approximate depth from the termination -- shorter for shorter hair, deeper for longer hair -- reducing termination thickness enough for softer integration.",
      referencedParameters: ["workingDepth", "texturizingTechnique"],
    },
    {
      order: 4,
      instruction: "Progress across the intended graduated area, section by section -- one slide does not complete the technique.",
      referencedParameters: ["texturizingTechnique"],
    },
    {
      order: 5,
      instruction: "Stop refinement on a subsection once its termination is sufficiently refined/thinned -- the desired termination is a soft, pointed transition, never a hard blunt step.",
      referencedParameters: ["scissorControl"],
    },
    {
      order: 6,
      instruction:
        "Completion requires the full intended graduated area to be reviewed/refined: graduated steps blend softly, no unintended hard straight lines remain, and the intended structural form -- including any preserved perimeter -- is still preserved.",
      referencedParameters: ["structuralTechnique", "hairState"],
    },
  ],
  applicableZones: ["graduated_surface_refinement_area"],
  // Stage 4 addition -- see file header. REFINE_ENDS only, per Ionuț's own
  // explicit correction: no OUTCOME capability (REDUCE_WEIGHT included) is
  // declared unless a real execution later confirms it. This Skill is
  // therefore never a Stage 4 candidate via selectCandidateSkillsForDelta
  // -- an accepted, honest, structural consequence, not a gap.
  capabilities: [{ kind: "REFINE_ENDS" }],
  // Declarative only -- see file header.
  prerequisiteSkillIds: ["skill-cutting-graduated"],
  incompatibleSkillIds: ["skill-cutting-one-length-perimeter"],
  createdAt: "2026-09-11T00:00:00.000Z",
};

function fixedBinding(parameterName: string, value: string | boolean | number): SkillInstanceParameterBinding<ExecutionRuleConditionFact> {
  return { parameterName, bindingState: "FIXED_FROM_AUTHORITY", value, sourceReference: SLICE_AND_SLIDE_REFINEMENT_AUTHORITY_SOURCE };
}

function professionalChoiceBinding(
  parameterName: string,
  value: string | boolean | number,
  allowedOptions: readonly (string | boolean | number)[],
): SkillInstanceParameterBinding<ExecutionRuleConditionFact> {
  return {
    parameterName,
    bindingState: "PROFESSIONAL_CHOICE",
    value,
    allowedOptions,
    confirmedByUserId: "professional-ionut-2026-09-11",
    confirmedAt: "2026-09-11T00:00:00.000Z",
  };
}

export const SLICE_AND_SLIDE_REFINEMENT_SKILL_INSTANCE: SkillInstance<ExecutionRuleConditionFact> = {
  skillInstanceId: "skillinstance-cutting-slice-and-slide-refinement-pilot",
  vertical: SLICE_AND_SLIDE_REFINEMENT_VERTICAL,
  sourceSkillId: SLICE_AND_SLIDE_REFINEMENT_SKILL.skillId,
  sourceSkillVersion: SLICE_AND_SLIDE_REFINEMENT_SKILL.version,
  compositionId: "composition-cutting-slice-and-slide-refinement-pilot-placeholder",
  order: 1,
  // Real cross-Skill ordering -- this Skill is only ever applied after a
  // graduated structure exists. No prior real Skill Instance to point at
  // in this stand-alone pilot (Graduated Cutting's own pilot instance
  // belongs to a separate composition); the declarative
  // prerequisiteSkillIds on the Skill Definition itself already records
  // the real dependency for a future composition engine.
  parameterBindings: [
    fixedBinding("clientHeadPosition", "upright"),
    fixedBinding("controlMethod", "fingers"),
    fixedBinding("strandControl", "index_middle_finger_fingers_downward"),
    fixedBinding("scissorControl", "partially_open_tip_toward_strand_horizontal_blade_partial_closure_slide"),
    fixedBinding("cuttingTechnique", REFINEMENT_CUTTING_TECHNIQUE),
    fixedBinding("texturizingTechnique", REFINEMENT_TEXTURIZING_TECHNIQUE),
    fixedBinding("structuralTechnique", REFINEMENT_STRUCTURAL_TECHNIQUE),
    // Stage 8.5S1B.R1 correction -- open, case-dependent choices, never
    // one fixed universal value (see file header).
    professionalChoiceBinding("tool", "straight_shear", ["straight_shear", "texturizer_shear"]),
    professionalChoiceBinding("elevation", REFINEMENT_ELEVATION_DEFAULT, ELEVATION_OPTIONS),
    professionalChoiceBinding("hairState", "dry", ["wet", "dry"]),
    // DEMONSTRATION_SPECIFIC -- see file header.
    {
      parameterName: "workingDepth",
      bindingState: "DEMONSTRATION_SPECIFIC",
      value: "approximately 5 cm from the termination (longer-hair professional range; shorter hair uses approximately 2-3 cm, case-dependent)",
      rationale: "Ionuț's own real professional range -- fixed here only for a deterministic demonstration; the real rule adapts by hair length/case.",
    },
  ],
  createdAt: "2026-09-11T00:00:00.000Z",
};

// EXECUTION UNIT COUNT DECISION: 1 -- every professional fact this Skill
// binds (strand control, scissor control, tool, technique, working depth)
// is stable across its own entire scope: a single refinement pass across
// the intended graduated area. No anatomical/control-method/laterality
// transition occurs within this Skill's own scope -- it is intentionally
// narrower and later than Graduated Cutting's own multi-Execution-Unit
// construction. Repetition across the graduated area is represented via
// iteration, not multiple Execution Units, mirroring Continue Central Nape
// Construction's own identical single-unit-plus-iteration precedent.
export const SLICE_AND_SLIDE_REFINEMENT_EXECUTION_UNITS: readonly ExecutionUnit<ExecutionRuleConditionFact>[] = [
  {
    executionUnitId: "executionunit-cutting-slice-and-slide-refinement-1",
    vertical: SLICE_AND_SLIDE_REFINEMENT_VERTICAL,
    order: 1,
    label: "Refine Terminations -- Graduated Surface",
    description:
      "Final refinement pass across the intended graduated area: index/middle finger strand control, fingers downward, partially-open scissors sliding through part of the strand, progressing section by section until the intended terminations are softly integrated. Never applied to preserve a pure straight one-length line.",
    zoneId: "graduated_surface_refinement_area",
    laterality: "NOT_APPLICABLE",
    sourceSkillInstanceId: SLICE_AND_SLIDE_REFINEMENT_SKILL_INSTANCE.skillInstanceId,
    verticalPayload: {
      iterationPolicy: {
        actionKinds: ["CONTROL", "EXECUTE"],
        iteration: {
          mode: "UNTIL_EXECUTION_UNIT_COMPLETE",
          note: "Repeat across the intended graduated area, section by section, until terminations are sufficiently refined -- one slide does not complete the technique.",
        },
      },
    },
    createdAt: "2026-09-11T00:00:00.000Z",
  },
];
