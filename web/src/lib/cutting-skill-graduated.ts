import type { CuttingTechnique, StructuralTechnique, TechnicalCutDistribution, TechnicalCutElevation, TechnicalCutGuideline } from "@/lib/contracts";
import { CUTTING_TECHNIQUES, DISTRIBUTION_OPTIONS, ELEVATION_OPTIONS, GUIDELINE_OPTIONS, STRUCTURAL_TECHNIQUES } from "@/lib/proposal-validators";
import type { SkillDefinition } from "@/lib/professional-skill-contracts";
import { EXECUTION_RULE_CONDITION_FACTS, type ExecutionRuleConditionFact } from "@/lib/technical-demonstration-execution-profile-contracts";
import type { SkillInstance, SkillInstanceParameterBinding } from "@/lib/professional-skill-instance-contracts";
import type { ExecutionUnit, ExecutionUnitParameterRule } from "@/lib/professional-skill-execution-unit-contracts";

// AI Hair Architect, Stage 8.5S1B -- REAL PROFESSIONAL AUTHORITY CONTENT,
// NOT a synthetic fixture. Authored directly from Ionuț's professional
// definition. Stage 8.5S1B.R1 CORRECTION (this revision): the original
// S1B cut compiled "lower area / 45°" and "upper area / 90°" as TWO
// separate, permanently fixed Execution Units, which read as -- and would
// have compiled as -- a mandatory universal sequence every real use of
// this Skill must follow. That is exactly the violation this correction
// exists to fix: SKILL = reusable professional transformation, never one
// fixed haircut recipe. See the "GENERALIZED EXECUTION MODEL" section
// below for the corrected shape. ZERO Composition Engine, ZERO automatic
// Skill selection, ZERO wiring into Technical Demonstration Plan/
// readiness/coherence/derivation/the generator -- exporting these
// constants has ZERO runtime effect anywhere in the application today.
//
// SKILL: "Graduated Cutting" -- reusable structural cutting primitive.
// Core rule, verbatim: "Any strand elevated out of its natural fall is
// graduation." Elevation is a PARAMETER of this Skill, never a duplicate
// independent Skill, and -- corrected -- never a fixed zone-to-angle
// recipe either: 45°/90°/180° are professionally valid EXAMPLE/working
// values, not a mandatory sequence. A valid execution may use only one
// elevation, a different single elevation, or a combination across
// different real cases -- see GENERALIZED EXECUTION MODEL below.
//
// GENERALIZED EXECUTION MODEL (Stage 8.5S1B.R1): exactly 3 Execution
// Units, each a genuinely stable-context professional segment -- never
// per-elevation:
//   EU1 "Establish Perimeter/Contour Guide" -- CONDITIONAL (carries a
//     real `applicabilityCondition` on the new local fact
//     `perimeterGuideRequired`; per Stage 6's own documented policy this
//     EU still compiles as prepared guidance, but its condition honestly
//     states it applies only "when the execution plan/target structure
//     requires a perimeter or termination-length authority" -- e.g.
//     longer hair -- never universally).
//   EU2 "Graduated Execution Zone" -- the ONE reusable graduation
//     segment. `elevation`, `handOrientation`, `clientHeadPosition`,
//     `zone`, `tool`, `partingOrientation`, `distribution`,
//     `overdirection` are ALL left unresolved at the Execution-Unit level
//     (no REQUIRED_FIXED rule for any of them) -- per cutting-skill-
//     atomic-action-compiler.ts's own precedence rule, this means each
//     one resolves from whichever value a REAL case's own Skill Instance
//     binds (PROFESSIONAL_CHOICE, from the full open allowedOptions set).
//     THIS is "the execution plan decides WHERE and AT WHAT ELEVATION it
//     is applied": a different real case is represented by authoring a
//     DIFFERENT Skill Instance with different bindings, reusing this
//     exact same Execution Unit -- never by editing this Skill
//     Definition, and never by requiring a second, differently-angled
//     Execution Unit to exist. `controlMethod` stays REQUIRED_FIXED
//     "fingers" on this unit ONLY because Ionuț stated finger control for
//     EVERY elevation he described (45°, 90°) -- a genuinely universal
//     fact about elevated graduation work, not a per-angle assumption.
//   EU3 "Cross-Check & Correction" -- fixes only what Ionuț stated
//     unconditionally ("cross-check using wider horizontal sections");
//     `elevation`/`handOrientation`/`zone` stay open (re-elevates
//     "according to the relevant value for that area").
// This pilot's own Skill Instance binds ONE representative elevation
// (45°) purely as a demonstration value -- it is explicitly NOT the
// Skill's own permanent truth; a sibling real case would author its own
// Skill Instance binding 90°, 180°, or a different zone, reusing the
// identical Execution Units unchanged (proven directly in this file's
// own test suite, which compiles the SAME EU2 against a SECOND,
// alternate Skill Instance binding a different elevation).
//
// TWO GUIDE CONCEPTS, KEPT STRUCTURALLY DISTINCT (Ionuț's own explicit
// requirement, unchanged by this correction): the PERIMETER/CONTOUR GUIDE
// (EU1, "visual_perimeter" + `guideReferenceMode` "contour_guide_reference")
// versus the PROGRESSIVE GRADUATION GUIDE (EU2/EU3, "traveling" +
// `guideReferenceMode` "previous_subsection", reusing the exact relative
// rule already proven correct in cutting-skill-continue-central-nape-
// construction.ts). Two different real vocabulary values, never one
// ambiguous generic guide.
//
// ELEVATION -> HAND/FINGER CONTROL, GUIDANCE NOT LAW (corrected): Ionuț's
// own words -- "For 45° work: fingers oriented upward... cutting on the
// palm-facing side. For 90° work: fingers oriented downward... cutting on
// the back-of-hand side" -- are real professional knowledge, preserved in
// `handOrientation`'s own description and in its 3 closed values, but are
// now a PROFESSIONAL_CHOICE the real case's Skill Instance selects
// (correlated with whichever elevation it also selects), never an
// Execution-Unit-level law forcing exactly one hand geometry per unit.
//
// 180° (crown/upper, considerable weight reduction) IS a real, declared
// `elevation` allowedValue, fully representable by EU2/EU3 exactly like
// 45°/90° (no separate Execution Unit needed, since none of the three is
// per-angle anymore) -- but this pilot's own Skill Instance does not bind
// 180° as its demonstration value, and no dedicated hand geometry is
// invented for it: Ionuț did not specify distinct hand/finger geometry
// for 180° the way he did for 45°/90°. UNKNOWN stays UNKNOWN; a real case
// selecting 180° would bind `handOrientation` from the SAME 3 existing
// values (most likely the fingers-downward/back-of-hand value already
// used for elevated work above the occipital) or leave it UNRESOLVED,
// never a fabricated fourth value.
//
// CAPABILITY MODEL -- MG1 GAP, UNCHANGED BY THIS CORRECTION (task's own
// explicit instruction: "Do NOT solve MG1... do NOT assign false
// BUILD_WEIGHT or REDUCE_WEIGHT semantics"): graduation's real weight/
// length effect genuinely depends on WHICH elevation a given Skill
// Instance selects. The only OUTCOME capabilities truthfully universal
// across every elevation choice are MODIFY_PERIMETER_RELATIONSHIP (any
// strand elevated out of natural fall and cut necessarily creates an
// interior-shorter-than-perimeter relationship) and REDUCE_LENGTH (the
// graduated zone's own relativeLength shortens regardless of elevation).
// BUILD_WEIGHT and REDUCE_WEIGHT are BOTH still declared (each
// professionally real for a real subset of this Skill's own
// parameterization) rather than silently picking one -- documented gap,
// not resolved here, not faked.
//
// CONNECT_ZONES is justified structurally: this Skill's own Execution
// Unit chain (EU2/EU3 prerequisite on EU1, when EU1 applies) continues
// execution FROM the established perimeter/contour guide INTO the
// graduated zone -- structurally connecting them, never a disconnected
// cut. PRESERVE_LENGTH is justified narrowly: EU1's own established
// reference line, once cut, is itself preserved going forward.
//
// DOMAIN GAP, continuity note (first reported Stage 2.5.i.6, not
// re-litigated): no dedicated wet/dry hair-state axis exists in the
// contract stack; this Skill uses the same established `hairState`
// parameter workaround as every real Skill before it.

const GRADUATED_CUTTING_VERTICAL = "cutting";
const GRADUATED_CUTTING_AUTHORITY_SOURCE = "Professional authority -- Ionuț's approved definition, Stage 8.5S1A.1 correction + Stage 8.5S1B/8.5S1B.R1 implementation authorization (2026-09-11).";

// Stage 8.5S1B.R1 -- one new, LOCALLY-SCOPED, informational fact naming
// whether THIS real case requires a perimeter/contour guide before
// graduation (e.g. longer hair needing an established final-length
// authority). Purely informational, per Stage 6's own documented
// non-filtering policy (professional-execution-plan-compiler.ts's own
// header: an Execution Unit's applicabilityCondition is never evaluated
// to decide inclusion/exclusion at compile time -- both/all Execution
// Units of a matched Skill still compile as prepared professional
// guidance; which one currently applies is for the professional
// executing the plan to observe/decide live). Mirrors the exact
// `aboveOccipitalThreshold` precedent (Stage 2.5.i.7) a third time.
export type GraduatedCuttingFact = ExecutionRuleConditionFact | "perimeterGuideRequired";

export function isGraduatedCuttingFact(value: unknown): value is GraduatedCuttingFact {
  return value === "perimeterGuideRequired" || (typeof value === "string" && (EXECUTION_RULE_CONDITION_FACTS as readonly string[]).includes(value));
}

// Type-safe intermediate constants -- checked by the compiler against the
// REAL, already-shipped union types, exactly mirroring the existing 3
// skills' own precedent.
const GUIDE_ESTABLISHMENT_ELEVATION: TechnicalCutElevation = "0_deg_blunt";
const LOWER_GRADUATION_ELEVATION: TechnicalCutElevation = "45_deg_graduation";
const UPPER_GRADUATION_ELEVATION: TechnicalCutElevation = "90_deg_uniform_layer";
const CONSIDERABLE_REDUCTION_ELEVATION: TechnicalCutElevation = "180_deg_overdirection";
const GRADUATION_STRUCTURAL_TECHNIQUE: StructuralTechnique = "graduation";
const GUIDE_ESTABLISHMENT_CUTTING_TECHNIQUE: CuttingTechnique = "blunt_line";
const GRADUATION_CUTTING_TECHNIQUE: CuttingTechnique = "elevation_cutting";
const GUIDE_ESTABLISHMENT_GUIDELINE: TechnicalCutGuideline = "visual_perimeter";
const PROGRESSIVE_GRADUATION_GUIDELINE: TechnicalCutGuideline = "traveling";
const GUIDE_ESTABLISHMENT_DISTRIBUTION: TechnicalCutDistribution = "natural_fall";

// The full, open zone menu -- Ionuț's own three descriptive examples,
// represented as SELECTABLE options a real case's Skill Instance picks
// from (never as three separate permanent Execution Units), plus the
// distinct value naming EU1's own non-graduated contour-establishment
// scope.
const GRADUATED_ZONE_VALUES = [
  "perimeter_contour_establishment",
  "lower_between_implantation_and_occipital",
  "above_occipital_perpendicular_to_scalp",
  "crown_superior_significant_reduction",
] as const;

void (STRUCTURAL_TECHNIQUES satisfies readonly StructuralTechnique[]);
void (CUTTING_TECHNIQUES satisfies readonly CuttingTechnique[]);
void (ELEVATION_OPTIONS satisfies readonly TechnicalCutElevation[]);
void (DISTRIBUTION_OPTIONS satisfies readonly TechnicalCutDistribution[]);
void (GUIDELINE_OPTIONS satisfies readonly TechnicalCutGuideline[]);

export const GRADUATED_CUTTING_SKILL: SkillDefinition<GraduatedCuttingFact> = {
  skillId: "skill-cutting-graduated",
  version: 1,
  vertical: GRADUATED_CUTTING_VERTICAL,
  name: "Graduated Cutting",
  description:
    "Constructs a graduated structure by elevating strands out of their natural fall to a professionally chosen degree, optionally preceded by establishing a perimeter/contour guide when the target structure requires a termination-length authority, progressing subsection-by-subsection through the intended graduated zone, and cross-checked in the opposing parting direction.",
  status: "ACTIVE",
  authorityType: "PROFESSIONALLY_AUTHORED",
  rationale:
    "Professionally authorized by Ionuț: elevation out of natural fall IS graduation; elevation, zone, hand geometry, distribution/overdirection, and tool are all real case-dependent parameters, never a hardcoded zone-to-angle recipe or mandatory 45deg-then-90deg sequence (Stage 8.5S1B.R1 correction). Scope: structural graduation construction + cross-check. Does NOT include final soft-integration refinement of terminations -- that is Slice-and-Slide Refinement's own, separate, later authority.",
  parameters: [
    {
      name: "clientHeadPosition",
      valueKind: "enum",
      allowedValues: ["tilted_forward_down", "upright"],
      description: "Client head position for the current execution segment -- case-dependent on which zone is being worked (forward-tilted for lower/posterior work, upright for upper/crown work).",
    },
    {
      name: "hairState",
      valueKind: "enum",
      allowedValues: ["wet"],
      description: "Hair condition during graduation execution.",
    },
    {
      name: "strandPreparation",
      valueKind: "enum",
      allowedValues: ["combed_root_to_tip_tensioned"],
      description: "Before every cut, without exception: comb the strand from root to tip, remove slack, and control/tension it evenly.",
    },
    {
      name: "guideIdentifiabilityCriterion",
      valueKind: "enum",
      allowedValues: ["must_remain_visually_identifiable"],
      description: "The relevant prior guide (perimeter/contour guide or the previously cut subsection) must remain visually identifiable before the next cut proceeds -- a universal criterion, not case-dependent.",
    },
    {
      name: "controlMethod",
      valueKind: "enum",
      allowedValues: ["comb", "fingers"],
      description: "Control method -- comb for the natural-fall perimeter/contour guide; fingers for elevated graduation work, stated by Ionuț for every elevation he described (45deg and 90deg alike), never angle-specific.",
    },
    {
      name: "handOrientation",
      valueKind: "enum",
      allowedValues: ["comb_control_no_finger_hold", "fingers_upward_palm_facing_cut", "fingers_downward_back_of_hand_cut"],
      description:
        "Combined finger orientation + cutting side. Real professional examples, per Ionuț: 45° work commonly holds the strand between index and middle finger with fingers oriented upward, cutting on the palm-facing side; 90° work commonly holds it the same way with fingers oriented downward, cutting on the back-of-hand side. A case-dependent PROFESSIONAL CHOICE correlated with the selected elevation, never a fixed law of one particular Execution Unit. No hand geometry is declared for 180 deg -- not professionally specified, left representable only via the existing 3 values or left unresolved.",
    },
    {
      name: "elevation",
      valueKind: "enum",
      allowedValues: [GUIDE_ESTABLISHMENT_ELEVATION, LOWER_GRADUATION_ELEVATION, UPPER_GRADUATION_ELEVATION, CONSIDERABLE_REDUCTION_ELEVATION],
      description:
        "How far the strand is elevated out of its natural fall -- 0° for the natural-fall perimeter/contour guide; 45°, 90°, and 180° are professionally valid EXAMPLE working values (45° commonly in the lower area between the lower implantation and the occipital region; 90° perpendicular to the scalp, commonly above the occipital area; 180° in the crown/upper head for considerable weight reduction and more evident graduation) -- never a mandatory sequence and never a hardcoded zone-to-angle recipe. A single real execution may use one selected elevation, or a professionally chosen combination across zones via separate Skill Instances of this same Skill.",
    },
    {
      name: "zone",
      valueKind: "enum",
      allowedValues: GRADUATED_ZONE_VALUES,
      description:
        "Which real anatomical area this execution addresses -- an open, case-selected value (never a permanent per-Execution-Unit identity). 'perimeter_contour_establishment' is EU1's own non-graduated scope; the remaining three are Ionuț's own example graduated areas, each professionally correlated with (but not structurally forced to) a typical elevation.",
    },
    {
      name: "cuttingTechnique",
      valueKind: "enum",
      allowedValues: [GUIDE_ESTABLISHMENT_CUTTING_TECHNIQUE, GRADUATION_CUTTING_TECHNIQUE],
      description: "The cutting technique executed -- blunt-line for the natural-fall guide, elevation-cutting for the graduated sections.",
    },
    {
      name: "structuralTechnique",
      valueKind: "enum",
      allowedValues: [GRADUATION_STRUCTURAL_TECHNIQUE],
      description: "The overall structural technique this Skill constructs.",
    },
    {
      name: "distribution",
      valueKind: "enum",
      allowedValues: DISTRIBUTION_OPTIONS,
      description:
        "Strand distribution during the cut -- a real, case-dependent geometry/control choice, never descriptive prose only. Natural fall / direct-from-position control expresses uniform progression/graduation; a redirected (overdirected) strand changes the resulting length relationship -- e.g. lateral hair pulled backward and cut to a shorter posterior guide falls longer laterally once returned to its natural position.",
    },
    {
      name: "overdirection",
      valueKind: "boolean",
      description: "Whether the strand was intentionally redirected (overdirected) before cutting, rather than taken directly from its natural position -- a distinct yes/no fact from the specific `distribution` value, case-dependent, never assumed.",
    },
    {
      name: "guideType",
      valueKind: "enum",
      allowedValues: [GUIDE_ESTABLISHMENT_GUIDELINE, PROGRESSIVE_GRADUATION_GUIDELINE],
      description: "Guide type -- a fixed visual-perimeter contour guide for the initial reference cut, or a traveling guide for progressive graduation.",
    },
    {
      name: "guideReferenceMode",
      valueKind: "enum",
      allowedValues: ["contour_guide_reference", "previous_subsection"],
      description:
        "Which guide concept this cut references -- 'contour_guide_reference' for the cut that itself establishes the authoritative perimeter/contour guide (contour, termination line, final perimeter length), distinct from 'previous_subsection': the immediately preceding graduated cut becomes the reference for the next one, the same relative rule at every repetition.",
    },
    {
      name: "partingOrientation",
      valueKind: "enum",
      allowedValues: ["vertical", "horizontal"],
      description:
        "Parting orientation. Ionuț's own framing is conditional (\"IF primary work used vertical partings, cross-check using wider horizontal sections\") -- vertical is a common, not a universally mandatory, primary orientation, so it is a case-dependent choice for graduation itself; the cross-check pass is unconditionally stated as horizontal, opposing whichever primary orientation was used.",
    },
    {
      name: "tool",
      valueKind: "enum",
      allowedValues: ["straight_shear", "texturizer_shear"],
      description: "The tool used to execute the cut -- open to either real tool value; Ionuț did not restrict graduation to exactly one.",
    },
  ],
  procedure: [
    {
      order: 1,
      instruction:
        "When the target structure requires a perimeter or termination-length authority (e.g. longer hair), establish that authoritative perimeter/contour guide first, in natural fall with no elevation, before constructing internal graduation. Otherwise this step does not apply.",
      referencedParameters: ["guideType", "guideReferenceMode", "elevation", "distribution", "cuttingTechnique"],
    },
    {
      order: 2,
      instruction: "Before every cut, comb the strand from root to tip, remove slack, control/tension it evenly, and identify the relevant guide -- it must remain visually identifiable.",
      referencedParameters: ["strandPreparation", "guideIdentifiabilityCriterion"],
    },
    {
      order: 3,
      instruction:
        "In the intended graduated zone, hold the strand between index and middle finger and elevate it to the professionally selected degree for that zone/result -- e.g. commonly around 45° in the lower area between the lower implantation and the occipital region, around 90° perpendicular to the scalp above it, or around 180° in the crown/upper head for considerable weight reduction. Hand orientation and cutting side follow the selected elevation.",
      referencedParameters: ["controlMethod", "handOrientation", "elevation", "clientHeadPosition", "zone"],
    },
    {
      order: 4,
      instruction:
        "Each freshly cut strand becomes the traveling guide for the next; progress strand-by-strand/subsection-by-subsection through the full intended zone, applying the selected elevation, distribution/overdirection, and control method for that zone. One cut does not complete the Skill.",
      referencedParameters: ["guideReferenceMode", "partingOrientation", "distribution", "overdirection", "structuralTechnique"],
    },
    {
      order: 5,
      instruction:
        "After the primary progression, cross-check using wider horizontal partings in the direction opposing the primary parting, re-elevating according to the relevant angle for that area, and correct any protruding longer ends to align the intended structure.",
      referencedParameters: ["partingOrientation", "elevation", "controlMethod"],
    },
  ],
  applicableZones: ["perimeter_contour_reference", "graduated_execution_zone", "cross_check_area"],
  // Stage 4 addition -- see file header for full MG1 justification of
  // each kind below. MODIFY_PERIMETER_RELATIONSHIP and REDUCE_LENGTH are
  // truthful across the whole elevation parameterization; BUILD_WEIGHT
  // and REDUCE_WEIGHT are each truthful only for a real subset of it (the
  // MG1 gap, explicitly not silently resolved to one); CONNECT_ZONES and
  // PRESERVE_LENGTH are justified structurally by the EU1 -> EU2/EU3
  // guide-establishment-then-graduation chain, when EU1 applies. Zones
  // use the canonical HeadZone vocabulary where scoped; left unscoped
  // elsewhere, falling back to this Skill's own applicableZones per
  // SkillCapability's own documented semantics.
  capabilities: [
    { kind: "MODIFY_PERIMETER_RELATIONSHIP" },
    { kind: "REDUCE_LENGTH" },
    { kind: "CONNECT_ZONES" },
    { kind: "PRESERVE_LENGTH", zones: ["nape", "occipital", "crown", "top"] },
    { kind: "BUILD_WEIGHT" },
    { kind: "REDUCE_WEIGHT" },
  ],
  createdAt: "2026-09-11T00:00:00.000Z",
};

function fixedBinding(parameterName: string, value: string | boolean | number): SkillInstanceParameterBinding<GraduatedCuttingFact> {
  return { parameterName, bindingState: "FIXED_FROM_AUTHORITY", value, sourceReference: GRADUATED_CUTTING_AUTHORITY_SOURCE };
}

// PROFESSIONAL_CHOICE -- exactly the binding state this contract was
// designed for (professional-skill-instance-contracts.ts's own header):
// "a value IS selected, from a required, non-empty allowedOptions set,
// always confirmedByUserId/confirmedAt-stamped." Stage 8.5S1B.R1: this is
// now the resolution path for EVERY genuinely case-dependent fact
// (elevation, handOrientation, zone, clientHeadPosition, distribution,
// overdirection, partingOrientation, tool) -- none of them is fixed at
// Execution-Unit level anymore (see EU2/EU3 below). This pilot binds ONE
// representative demonstration value per fact; a different real case is
// represented by a DIFFERENT SkillInstance object binding different
// values to these SAME open parameters against these SAME Execution
// Units -- proven directly in this file's own test suite (a second,
// alternate instance compiled against the identical EU2).
function professionalChoiceBinding(
  parameterName: string,
  value: string | boolean | number,
  allowedOptions: readonly (string | boolean | number)[],
): SkillInstanceParameterBinding<GraduatedCuttingFact> {
  return {
    parameterName,
    bindingState: "PROFESSIONAL_CHOICE",
    value,
    allowedOptions,
    confirmedByUserId: "professional-ionut-2026-09-11",
    confirmedAt: "2026-09-11T00:00:00.000Z",
  };
}

export const GRADUATED_CUTTING_SKILL_INSTANCE: SkillInstance<GraduatedCuttingFact> = {
  skillInstanceId: "skillinstance-cutting-graduated-pilot",
  vertical: GRADUATED_CUTTING_VERTICAL,
  sourceSkillId: GRADUATED_CUTTING_SKILL.skillId,
  sourceSkillVersion: GRADUATED_CUTTING_SKILL.version,
  compositionId: "composition-cutting-graduated-pilot-placeholder",
  order: 1,
  parameterBindings: [
    // Genuinely constant across the whole Skill, per Ionuț's own
    // unconditional statements -- bound once at instance level.
    fixedBinding("hairState", "wet"),
    fixedBinding("strandPreparation", "combed_root_to_tip_tensioned"),
    fixedBinding("guideIdentifiabilityCriterion", "must_remain_visually_identifiable"),
    fixedBinding("structuralTechnique", GRADUATION_STRUCTURAL_TECHNIQUE),
    // Case-dependent facts -- this pilot's own ONE representative
    // demonstration choice, never this Skill's permanent truth. A sibling
    // real case authors its own Skill Instance with different values
    // here, reusing the identical Execution Units below unchanged.
    professionalChoiceBinding("elevation", LOWER_GRADUATION_ELEVATION, [GUIDE_ESTABLISHMENT_ELEVATION, LOWER_GRADUATION_ELEVATION, UPPER_GRADUATION_ELEVATION, CONSIDERABLE_REDUCTION_ELEVATION]),
    professionalChoiceBinding("handOrientation", "fingers_upward_palm_facing_cut", ["comb_control_no_finger_hold", "fingers_upward_palm_facing_cut", "fingers_downward_back_of_hand_cut"]),
    professionalChoiceBinding("clientHeadPosition", "tilted_forward_down", ["tilted_forward_down", "upright"]),
    professionalChoiceBinding("zone", "lower_between_implantation_and_occipital", GRADUATED_ZONE_VALUES),
    professionalChoiceBinding("distribution", GUIDE_ESTABLISHMENT_DISTRIBUTION, DISTRIBUTION_OPTIONS),
    professionalChoiceBinding("overdirection", false, [true, false]),
    professionalChoiceBinding("partingOrientation", "vertical", ["vertical", "horizontal"]),
    professionalChoiceBinding("tool", "straight_shear", ["straight_shear", "texturizer_shear"]),
  ],
  createdAt: "2026-09-11T00:00:00.000Z",
};

function requiredFixedRule(parameterName: string, value: string | boolean | number, rationale: string): ExecutionUnitParameterRule<GraduatedCuttingFact> {
  return { parameterName, semantic: "REQUIRED_FIXED", fixedValue: value, rationale };
}

// EXECUTION UNIT COUNT DECISION (Stage 8.5S1B.R1, corrected): exactly 3 --
// one per genuinely stable-context professional segment that is NOT
// itself an elevation choice: establishing the perimeter/contour guide
// (conditional), executing graduation in the intended zone (ONE reusable
// segment, open to whichever elevation/zone/hand-geometry a real case
// selects), and the cross-check/correction pass. Elevation is
// deliberately NOT an Execution Unit boundary trigger -- unlike a real
// tool/control-method transition (Occipital Transition's own precedent)
// or a real anatomical threshold, "which angle was chosen for this case"
// is professional CASE DATA, not a structural transition in the Skill's
// own stable-context segmentation. Splitting one Execution Unit per
// elevation would misrepresent a parameter choice as a permanent
// procedural boundary -- exactly the over-specification this correction
// removes.
export const GRADUATED_CUTTING_EXECUTION_UNITS: readonly ExecutionUnit<GraduatedCuttingFact>[] = [
  {
    executionUnitId: "executionunit-cutting-graduated-perimeter-guide",
    vertical: GRADUATED_CUTTING_VERTICAL,
    order: 1,
    label: "Establish Perimeter/Contour Guide (When Required)",
    description:
      "When the execution plan/target structure requires a perimeter or termination-length authority (e.g. longer hair), before internal graduation is constructed: establish the authoritative perimeter/contour guide defining the haircut's contour, termination line, and final perimeter length -- in natural fall, comb control, zero elevation. This is the PERIMETER/CONTOUR guide, structurally distinct from the progressive graduation guide the following Execution Unit uses. CONDITIONAL -- see applicabilityCondition; otherwise not applicable for this case.",
    zoneId: "perimeter_contour_reference",
    laterality: "NOT_APPLICABLE",
    applicabilityCondition: { op: "equals", fact: "perimeterGuideRequired", value: true },
    parameterRules: [
      requiredFixedRule("controlMethod", "comb", "The natural-fall perimeter/contour guide is comb-controlled, mirroring the established central-nape guide precedent."),
      requiredFixedRule("handOrientation", "comb_control_no_finger_hold", "No finger-hold technique applies to a comb-controlled natural-fall guide cut."),
      requiredFixedRule("elevation", GUIDE_ESTABLISHMENT_ELEVATION, "The perimeter/contour guide fixes the authoritative final length in natural fall -- zero elevation, definitional to what a contour/perimeter guide is."),
      requiredFixedRule("cuttingTechnique", GUIDE_ESTABLISHMENT_CUTTING_TECHNIQUE, "A natural-fall reference line is a blunt-line cut."),
      requiredFixedRule("distribution", GUIDE_ESTABLISHMENT_DISTRIBUTION, "Natural fall, no redirection, for the authoritative perimeter reference."),
      requiredFixedRule("guideType", GUIDE_ESTABLISHMENT_GUIDELINE, "A fixed visual-perimeter guide, distinct from the traveling progressive graduation guide."),
      requiredFixedRule("guideReferenceMode", "contour_guide_reference", "This cut establishes the authoritative contour/perimeter reference itself."),
      requiredFixedRule("zone", "perimeter_contour_establishment", "This Execution Unit's own scope is establishing the contour/perimeter reference, not a graduated zone."),
      requiredFixedRule("clientHeadPosition", "tilted_forward_down", "Posterior/nape-adjacent perimeter reference execution."),
    ],
    sourceSkillInstanceId: GRADUATED_CUTTING_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-11T00:00:00.000Z",
  },
  {
    executionUnitId: "executionunit-cutting-graduated-execution-zone",
    vertical: GRADUATED_CUTTING_VERTICAL,
    order: 2,
    label: "Graduated Execution Zone",
    description:
      "The ONE reusable graduation segment: elevate the strand out of natural fall to the professionally selected degree for the intended zone/result, held between index and middle finger, and repeat strand-by-strand through that zone, each cut becoming the traveling guide for the next. Elevation, hand orientation, zone, client head position, distribution/overdirection, tool, and parting orientation are ALL case-dependent (resolved from this Execution Unit's own source Skill Instance, never fixed here) -- a DIFFERENT real case reuses this identical Execution Unit with a DIFFERENT Skill Instance. Only finger control is stated as universal across every elevation Ionuț described.",
    zoneId: "graduated_execution_zone",
    laterality: "NOT_APPLICABLE",
    prerequisiteExecutionUnitIds: ["executionunit-cutting-graduated-perimeter-guide"],
    parameterRules: [
      requiredFixedRule("controlMethod", "fingers", "Elevated graduation work is finger-controlled -- stated by Ionuț for every elevation (45deg and 90deg alike), never angle-specific."),
      requiredFixedRule("cuttingTechnique", GRADUATION_CUTTING_TECHNIQUE, "Elevated graduation cutting."),
      requiredFixedRule("guideType", PROGRESSIVE_GRADUATION_GUIDELINE, "Traveling guide -- each cut strand guides the next."),
      requiredFixedRule("guideReferenceMode", "previous_subsection", "Each subsection references the immediately preceding cut, never a fixed pointer to the original guide."),
      // elevation / handOrientation / zone / clientHeadPosition /
      // distribution / overdirection / tool / partingOrientation are
      // DELIBERATELY absent here -- see file header. Each resolves from
      // the source Skill Instance's own PROFESSIONAL_CHOICE binding.
    ],
    verticalPayload: {
      iterationPolicy: {
        actionKinds: ["CONTROL", "EXECUTE"],
        iteration: {
          mode: "UNTIL_EXECUTION_UNIT_COMPLETE",
          note: "Repeat strand-by-strand/subsection-by-subsection through the full intended graduated zone, each referencing the immediately preceding cut, while this Execution Unit's own conditions remain true. One cut does not complete the Skill.",
        },
      },
    },
    sourceSkillInstanceId: GRADUATED_CUTTING_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-11T00:00:00.000Z",
  },
  {
    executionUnitId: "executionunit-cutting-graduated-cross-check",
    vertical: GRADUATED_CUTTING_VERTICAL,
    order: 3,
    label: "Cross-Check & Correction",
    description:
      "After the primary graduation progression: cross-check using wider horizontal partings in the direction opposing the primary parting, re-elevating according to the relevant angle for that area, and correcting any protruding longer ends. Graduation is not complete after one cut -- completion requires full-zone progression plus this cross-check. Elevation/hand orientation/zone stay case-dependent, resolved from the source Skill Instance -- cross-check re-elevates \"according to the relevant value for that area\", never one fixed angle.",
    zoneId: "cross_check_area",
    laterality: "NOT_APPLICABLE",
    prerequisiteExecutionUnitIds: ["executionunit-cutting-graduated-execution-zone"],
    parameterRules: [
      requiredFixedRule("controlMethod", "fingers", "Cross-check on already-graduated (elevated) sections is finger-controlled."),
      requiredFixedRule("cuttingTechnique", GRADUATION_CUTTING_TECHNIQUE, "Corrective cutting on already-elevated structure."),
      requiredFixedRule("guideType", PROGRESSIVE_GRADUATION_GUIDELINE, "Cross-check re-references the already-established traveling guide."),
      requiredFixedRule("guideReferenceMode", "previous_subsection", "Correction references the already-cut graduated structure."),
      requiredFixedRule("partingOrientation", "horizontal", "Cross-check unconditionally uses wider horizontal sections, opposing the primary parting -- Ionuț's own unconditional instruction, unlike the case-dependent primary orientation."),
      requiredFixedRule("clientHeadPosition", "upright", "Full-zone cross-check execution."),
      // elevation / handOrientation / zone / distribution / overdirection
      // / tool stay case-dependent -- resolved from the source Skill
      // Instance, re-elevating "according to the relevant value for that
      // area" per Ionuț's own words.
    ],
    sourceSkillInstanceId: GRADUATED_CUTTING_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-11T00:00:00.000Z",
  },
];
