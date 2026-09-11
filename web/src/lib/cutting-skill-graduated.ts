import type { CuttingTechnique, StructuralTechnique, TechnicalCutDistribution, TechnicalCutElevation, TechnicalCutGuideline } from "@/lib/contracts";
import { CUTTING_TECHNIQUES, DISTRIBUTION_OPTIONS, ELEVATION_OPTIONS, GUIDELINE_OPTIONS, STRUCTURAL_TECHNIQUES } from "@/lib/proposal-validators";
import type { SkillDefinition } from "@/lib/professional-skill-contracts";
import { EXECUTION_RULE_CONDITION_FACTS, type ExecutionRuleConditionFact } from "@/lib/technical-demonstration-execution-profile-contracts";
import type { SkillInstance, SkillInstanceParameterBinding } from "@/lib/professional-skill-instance-contracts";
import type { ExecutionUnit, ExecutionUnitParameterRule } from "@/lib/professional-skill-execution-unit-contracts";

// AI Hair Architect, Stage 8.5S1B -- REAL PROFESSIONAL AUTHORITY CONTENT,
// NOT a synthetic fixture. Authored directly from Ionuț's professional
// definition (STAGE 8.5S1A.1 correction + this stage's own verbatim
// professional input). ZERO Composition Engine, ZERO automatic Skill
// selection, ZERO wiring into Technical Demonstration Plan/readiness/
// coherence/derivation/the generator -- exporting these constants has ZERO
// runtime effect anywhere in the application today. Mirrors the exact
// Stage 2.5.i.6/i.7/i.25 file convention (cutting-skill-establish-central-
// nape-guide.ts / cutting-skill-occipital-transition.ts / cutting-skill-
// continue-central-nape-construction.ts) throughout.
//
// SKILL: "Graduated Cutting" -- reusable structural cutting primitive.
// Core rule, verbatim: "Any strand elevated out of its natural fall is
// graduation." Elevation is a PARAMETER of this Skill, never a duplicate
// independent Skill -- see the `elevation` SkillParameterDefinition below,
// which declares the FULL real ELEVATION_OPTIONS menu (never narrowed to
// one value, unlike the existing 3 pilots' single-locked-profile
// parameters), because this Skill is NOT scoped to one locked profile: it
// is explicitly reusable across zones/results/professional intent
// ("Elevation depends on zone, target result, structure, professional
// intent... Do NOT encode: zone X always = angle Y").
//
// TWO GUIDE CONCEPTS, KEPT STRUCTURALLY DISTINCT (Ionuț's own explicit
// requirement): the PERIMETER/CONTOUR GUIDE (established first, for longer
// hair, before internal graduation -- defines contour/termination
// line/final perimeter length) is represented as its own Execution Unit
// (EU1) using the real GUIDELINE_OPTIONS value "visual_perimeter" + a
// new local `guideReferenceMode` value "contour_guide_reference". The
// PROGRESSIVE GRADUATION GUIDE (a cut strand becomes the guide for the
// next strand) reuses the exact "previous_subsection" value + relative
// rule already proven correct in cutting-skill-continue-central-nape-
// construction.ts, with GUIDELINE_OPTIONS value "traveling". These are
// two DIFFERENT real vocabulary values, never one ambiguous generic guide.
//
// ELEVATION -> HAND/FINGER CONTROL, ANATOMY-CONDITIONAL (Ionuț's own
// approved semantics): "For 45° work: fingers oriented upward, strand held
// between index and middle finger, cutting on the palm-facing side. For
// 90° work: fingers oriented downward, strand held between index and
// middle finger, cutting on the back-of-hand side." Represented as ONE
// closed `handOrientation` parameter combining orientation+cutting-side
// into a single well-defined value per elevation family (mirrors this
// domain's own established "one closed value for one whole professional
// micro-fact" discipline, e.g. guideIdentifiabilityCriterion), bound via
// REQUIRED_FIXED per Execution Unit -- the SKILL still supports the full
// open elevation vocabulary (parameterization requirement); a given,
// stable-context Execution Unit legitimately pins ONE elevation/hand-
// geometry pairing for its own segment, exactly like Occipital
// Transition's own real controlMethod-per-Execution-Unit precedent.
//
// 180° (crown/upper, considerable weight reduction) IS a real, declared
// `elevation` allowedValue (professionally approved, reusable by any
// future Skill Instance) but this v1 pilot does NOT build a dedicated
// Execution Unit demonstrating it: Ionuț did not specify distinct hand/
// finger geometry for 180° the way he did for 45°/90°, and inventing one
// would be exactly the "do not invent professional content" violation
// this whole engagement refuses. A future Execution Unit for 180° can be
// added, additively, once professionally specified -- v1 is not mutated
// retroactively (see file footer note).
//
// CROSS-CHECK (Ionuț's own approved rule): "If primary work used vertical
// partings, cross-check using wider horizontal sections... correct
// protruding longer ends." Represented as its own Execution Unit (EU4,
// capability CROSS_CHECK_VALIDATE -- reused verbatim from Continue Central
// Nape Construction's own precedent), with `partingOrientation` FIXED
// "vertical" on the graduation Execution Units and FIXED "horizontal" on
// the cross-check unit -- a single closed parameter, two real values,
// never a second ambiguous concept.
//
// CAPABILITY MODEL -- MG1 GAP, EXPLICITLY REPORTED (task's own explicit
// instruction: "Do NOT assign Graduation = BUILD_WEIGHT... DO NOT fake
// it"): graduation's real weight/length effect genuinely depends on WHICH
// elevation a given Skill Instance selects (Ionuț's own words: "180° ...
// to reduce considerable weight" implies the converse at 45° -- weight is
// relatively retained/built near the perimeter; 90°/180° progressively
// remove it). `SkillCapability` is a STATIC, whole-skill declaration --
// it cannot be conditioned on a parameter value. The only OUTCOME
// capability truthfully universal across every elevation choice is
// MODIFY_PERIMETER_RELATIONSHIP (any strand elevated out of natural fall
// and cut necessarily creates an interior-shorter-than-perimeter
// relationship -- this is the definitional core of graduation itself) and
// REDUCE_LENGTH (the graduated zone's own relativeLength shortens
// regardless of elevation). BUILD_WEIGHT and REDUCE_WEIGHT are BOTH
// declared (each professionally real for a real subset of this Skill's
// own parameterization) rather than silently picking one -- this is the
// MG1 gap: the current static capability contract cannot express "which
// one applies" without knowing the chosen elevation. Stage 5/6 (or a
// future capability-parameter-conditioning extension, not built here)
// must resolve which of the two actually applies for a real case. Not
// faked as a single universal effect.
//
// CONNECT_ZONES is justified structurally, mirroring Occipital
// Transition's own exact reasoning: this Skill's own Execution Unit chain
// (EU1 -> EU2/EU3, both prerequisite on EU1) continues execution FROM the
// established perimeter/contour guide INTO the graduated zones --
// structurally connecting them, never a disconnected cut.
//
// PRESERVE_LENGTH is justified narrowly: the perimeter/contour guide
// Execution Unit (EU1) establishes a reference line that, once cut, is
// itself preserved going forward (exactly like One-Length's own identical
// guide-establishment reasoning) -- not a claim about the graduated zones
// themselves, which by definition change length.
//
// DOMAIN GAP, continuity note (first reported Stage 2.5.i.6, not
// re-litigated): no dedicated wet/dry hair-state axis exists in the
// contract stack; this Skill uses the same established `hairState`
// parameter workaround as every real Skill before it.

const GRADUATED_CUTTING_VERTICAL = "cutting";
const GRADUATED_CUTTING_AUTHORITY_SOURCE = "Professional authority -- Ionuț's approved definition, Stage 8.5S1A.1 correction + Stage 8.5S1B implementation authorization (2026-09-11).";

export function isGraduatedCuttingFact(value: unknown): value is ExecutionRuleConditionFact {
  return typeof value === "string" && (EXECUTION_RULE_CONDITION_FACTS as readonly string[]).includes(value);
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

void (STRUCTURAL_TECHNIQUES satisfies readonly StructuralTechnique[]);
void (CUTTING_TECHNIQUES satisfies readonly CuttingTechnique[]);
void (ELEVATION_OPTIONS satisfies readonly TechnicalCutElevation[]);
void (DISTRIBUTION_OPTIONS satisfies readonly TechnicalCutDistribution[]);
void (GUIDELINE_OPTIONS satisfies readonly TechnicalCutGuideline[]);

export const GRADUATED_CUTTING_SKILL: SkillDefinition<ExecutionRuleConditionFact> = {
  skillId: "skill-cutting-graduated",
  version: 1,
  vertical: GRADUATED_CUTTING_VERTICAL,
  name: "Graduated Cutting",
  description:
    "Constructs a graduated structure by elevating strands out of their natural fall to a professionally chosen degree, optionally preceded by establishing a perimeter/contour guide for longer hair, progressing subsection-by-subsection through the intended graduated area, and cross-checked in the opposing parting direction.",
  status: "ACTIVE",
  authorityType: "PROFESSIONALLY_AUTHORED",
  rationale:
    "Professionally authorized by Ionuț (Stage 8.5S1A.1 correction + Stage 8.5S1B authorization): elevation out of natural fall IS graduation; elevation is a parameter, never a duplicate skill; effect depends on zone/target/structure, never a hardcoded zone-to-angle recipe. Scope: structural graduation construction + cross-check. Does NOT include final soft-integration refinement of terminations -- that is Slice-and-Slide Refinement's own, separate, later authority.",
  parameters: [
    {
      name: "clientHeadPosition",
      valueKind: "enum",
      allowedValues: ["tilted_forward_down", "upright"],
      description: "Client head position for the current execution segment -- forward-tilted for lower/posterior work, upright for upper/crown work.",
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
      description: "Before every cut: comb the strand from root to tip, remove slack, and control/tension it evenly.",
    },
    {
      name: "guideIdentifiabilityCriterion",
      valueKind: "enum",
      allowedValues: ["must_remain_visually_identifiable"],
      description: "The relevant prior guide (perimeter/contour guide or the previously cut subsection) must remain visually identifiable before the next cut proceeds.",
    },
    {
      name: "controlMethod",
      valueKind: "enum",
      allowedValues: ["comb", "fingers"],
      description: "Control method -- comb for the natural-fall perimeter/contour guide, fingers for elevated graduation work.",
    },
    {
      name: "handOrientation",
      valueKind: "enum",
      allowedValues: ["comb_control_no_finger_hold", "fingers_upward_palm_facing_cut", "fingers_downward_back_of_hand_cut"],
      description:
        "Combined finger orientation + cutting side, per Ionuț's own approved semantics: 45° work holds the strand between index and middle finger with fingers oriented upward, cutting on the palm-facing side; 90° work holds it the same way with fingers oriented downward, cutting on the back-of-hand side.",
    },
    {
      name: "elevation",
      valueKind: "enum",
      allowedValues: [GUIDE_ESTABLISHMENT_ELEVATION, LOWER_GRADUATION_ELEVATION, UPPER_GRADUATION_ELEVATION, CONSIDERABLE_REDUCTION_ELEVATION],
      description:
        "How far the strand is elevated out of its natural fall -- 0° for the natural-fall perimeter/contour guide; 45° commonly in the lower area between lower implantation and the occipital region; 90° perpendicular to the scalp, commonly above the occipital area; 180° in the crown/upper head for considerable weight reduction and more evident graduation. Zone-and-result-dependent, never a hardcoded zone-to-angle recipe.",
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
        "Strand distribution during the cut. Natural fall / direct-from-position control expresses uniform progression/graduation; a redirected (overdirected) strand changes the resulting length relationship -- e.g. lateral hair pulled backward and cut to a shorter posterior guide falls longer laterally once returned to its natural position. A real geometry/control choice, never descriptive prose only.",
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
      description: "Parting orientation -- vertical for primary graduation progression, horizontal for the cross-check pass in the opposing direction.",
    },
    {
      name: "tool",
      valueKind: "enum",
      allowedValues: ["straight_shear"],
      description: "The tool used to execute every cut in this Skill.",
    },
  ],
  procedure: [
    {
      order: 1,
      instruction:
        "For longer hair, before constructing internal graduation, establish the authoritative perimeter/contour guide defining the haircut's contour, termination line, and final perimeter length, in natural fall with no elevation.",
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
        "In the lower graduated area (between the lower implantation and the occipital region), hold the strand between index and middle finger with fingers oriented upward, elevate it to approximately 45°, and cut on the palm-facing side.",
      referencedParameters: ["controlMethod", "handOrientation", "elevation", "clientHeadPosition"],
    },
    {
      order: 4,
      instruction:
        "In the upper graduated area (commonly above the occipital region), hold the strand between index and middle finger with fingers oriented downward, elevate it to approximately 90° perpendicular to the scalp, and cut on the back-of-hand side.",
      referencedParameters: ["controlMethod", "handOrientation", "elevation", "clientHeadPosition"],
    },
    {
      order: 5,
      instruction:
        "Each freshly cut strand becomes the traveling guide for the next; progress strand-by-strand/subsection-by-subsection through the full intended area using vertical partings, applying the required elevation, distribution/overdirection, and control method for that area. One cut does not complete the Skill.",
      referencedParameters: ["guideReferenceMode", "partingOrientation", "distribution", "structuralTechnique"],
    },
    {
      order: 6,
      instruction:
        "After the primary progression, cross-check using wider horizontal partings in the opposing direction, re-elevating according to the relevant angle for that area, and correct any protruding longer ends to align the intended structure.",
      referencedParameters: ["partingOrientation", "elevation", "controlMethod"],
    },
  ],
  applicableZones: ["perimeter_contour_reference", "lower_graduated_area", "upper_graduated_area", "cross_check_area"],
  // Stage 4 addition -- see file header for full MG1 justification of
  // each kind below. MODIFY_PERIMETER_RELATIONSHIP and REDUCE_LENGTH are
  // truthful across the whole elevation parameterization; BUILD_WEIGHT and
  // REDUCE_WEIGHT are each truthful only for a real subset of it (the MG1
  // gap, explicitly not silently resolved to one); CONNECT_ZONES and
  // PRESERVE_LENGTH are justified structurally by the EU1 -> EU2/EU3
  // guide-establishment-then-graduation chain. Zones use the canonical
  // HeadZone vocabulary where scoped; left unscoped elsewhere, falling
  // back to this Skill's own applicableZones per SkillCapability's own
  // documented semantics.
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

function fixedBinding(parameterName: string, value: string | boolean | number): SkillInstanceParameterBinding<ExecutionRuleConditionFact> {
  return { parameterName, bindingState: "FIXED_FROM_AUTHORITY", value, sourceReference: GRADUATED_CUTTING_AUTHORITY_SOURCE };
}

// PROFESSIONAL_CHOICE -- exactly the binding state this contract was
// designed for (professional-skill-instance-contracts.ts's own header):
// "a value IS selected, from a required, non-empty allowedOptions set,
// always confirmedByUserId/confirmedAt-stamped." elevation/distribution
// are NOT fixed at Skill-Instance level for the two graduation Execution
// Units (EU2/EU3 fix their own, per file header) -- this binding is the
// fallthrough used only by EU1 (elevation) is instead EU-level-fixed
// there too; distribution/elevation reach the cross-check Execution Unit
// (EU4) THROUGH this instance-level professional choice, since cross-check
// re-elevates "according to the relevant value for that area" -- a real,
// case-dependent professional choice, never a fixed universal one.
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

export const GRADUATED_CUTTING_SKILL_INSTANCE: SkillInstance<ExecutionRuleConditionFact> = {
  skillInstanceId: "skillinstance-cutting-graduated-pilot",
  vertical: GRADUATED_CUTTING_VERTICAL,
  sourceSkillId: GRADUATED_CUTTING_SKILL.skillId,
  sourceSkillVersion: GRADUATED_CUTTING_SKILL.version,
  compositionId: "composition-cutting-graduated-pilot-placeholder",
  order: 1,
  parameterBindings: [
    // Constant across the whole Skill -- bound once at instance level.
    fixedBinding("hairState", "wet"),
    fixedBinding("strandPreparation", "combed_root_to_tip_tensioned"),
    fixedBinding("guideIdentifiabilityCriterion", "must_remain_visually_identifiable"),
    fixedBinding("structuralTechnique", GRADUATION_STRUCTURAL_TECHNIQUE),
    fixedBinding("tool", "straight_shear"),
    // Fallthrough for the cross-check Execution Unit (EU4), which
    // deliberately does not fix elevation/distribution at EU level -- see
    // file header ("re-elevates according to the relevant value for that
    // area", a genuine case-dependent professional choice).
    professionalChoiceBinding("elevation", UPPER_GRADUATION_ELEVATION, [GUIDE_ESTABLISHMENT_ELEVATION, LOWER_GRADUATION_ELEVATION, UPPER_GRADUATION_ELEVATION, CONSIDERABLE_REDUCTION_ELEVATION]),
    professionalChoiceBinding("distribution", GUIDE_ESTABLISHMENT_DISTRIBUTION, DISTRIBUTION_OPTIONS),
  ],
  createdAt: "2026-09-11T00:00:00.000Z",
};

function requiredFixedRule(parameterName: string, value: string | boolean | number, rationale: string): ExecutionUnitParameterRule<ExecutionRuleConditionFact> {
  return { parameterName, semantic: "REQUIRED_FIXED", fixedValue: value, rationale };
}

// EXECUTION UNIT COUNT DECISION: 4 -- one per genuinely stable-context
// professional segment Ionuț's own approved definition names: establishing
// the perimeter/contour guide (natural fall, comb), lower graduated area
// (45°, fingers upward, palm-facing), upper graduated area (90°, fingers
// downward, back-of-hand-facing), and the cross-check/correction pass
// (opposing horizontal partings). Each boundary is a real "tool/control-
// method transition" or "anatomical/geometric threshold" trigger, exactly
// the Stage 2.5.i.2 Execution Unit boundary test already used by every
// real Skill before this one -- never split per procedure sentence, never
// collapsed into one unit hiding a real technical transition.
export const GRADUATED_CUTTING_EXECUTION_UNITS: readonly ExecutionUnit<ExecutionRuleConditionFact>[] = [
  {
    executionUnitId: "executionunit-cutting-graduated-perimeter-guide",
    vertical: GRADUATED_CUTTING_VERTICAL,
    order: 1,
    label: "Establish Perimeter/Contour Guide (Longer Hair)",
    description:
      "For longer hair, before internal graduation is constructed: establish the authoritative perimeter/contour guide defining the haircut's contour, termination line, and final perimeter length -- in natural fall, comb control, zero elevation. This is the PERIMETER/CONTOUR guide, structurally distinct from the progressive graduation guide the following Execution Units use.",
    zoneId: "perimeter_contour_reference",
    laterality: "NOT_APPLICABLE",
    parameterRules: [
      requiredFixedRule("clientHeadPosition", "tilted_forward_down", "Posterior/nape-adjacent perimeter reference execution."),
      requiredFixedRule("controlMethod", "comb", "The natural-fall perimeter/contour guide is comb-controlled, mirroring the established central-nape guide precedent."),
      requiredFixedRule("handOrientation", "comb_control_no_finger_hold", "No finger-hold technique applies to a comb-controlled natural-fall guide cut."),
      requiredFixedRule("elevation", GUIDE_ESTABLISHMENT_ELEVATION, "The perimeter/contour guide fixes the authoritative final length in natural fall -- zero elevation."),
      requiredFixedRule("cuttingTechnique", GUIDE_ESTABLISHMENT_CUTTING_TECHNIQUE, "A natural-fall reference line is a blunt-line cut."),
      requiredFixedRule("distribution", GUIDE_ESTABLISHMENT_DISTRIBUTION, "Natural fall, no redirection, for the authoritative perimeter reference."),
      requiredFixedRule("guideType", GUIDE_ESTABLISHMENT_GUIDELINE, "A fixed visual-perimeter guide, distinct from the traveling progressive graduation guide."),
      requiredFixedRule("guideReferenceMode", "contour_guide_reference", "This cut establishes the authoritative contour/perimeter reference itself."),
      requiredFixedRule("partingOrientation", "horizontal", "The perimeter/contour reference is established via a horizontal parting, mirroring perimeter-construction precedent."),
    ],
    sourceSkillInstanceId: GRADUATED_CUTTING_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-11T00:00:00.000Z",
  },
  {
    executionUnitId: "executionunit-cutting-graduated-lower-45",
    vertical: GRADUATED_CUTTING_VERTICAL,
    order: 2,
    label: "Lower Graduated Area -- 45°, Fingers Upward",
    description:
      "Between the lower implantation and the occipital region: strand elevated to approximately 45° out of natural fall, held between index and middle finger with fingers oriented upward, cut on the palm-facing side. Repeats subsection-by-subsection, each cut strand becoming the traveling guide for the next.",
    zoneId: "lower_graduated_area",
    laterality: "NOT_APPLICABLE",
    prerequisiteExecutionUnitIds: ["executionunit-cutting-graduated-perimeter-guide"],
    parameterRules: [
      requiredFixedRule("clientHeadPosition", "tilted_forward_down", "Lower/posterior-adjacent graduation execution."),
      requiredFixedRule("controlMethod", "fingers", "Elevated graduation work is finger-controlled."),
      requiredFixedRule("handOrientation", "fingers_upward_palm_facing_cut", "45° work: fingers oriented upward, cutting on the palm-facing side."),
      requiredFixedRule("elevation", LOWER_GRADUATION_ELEVATION, "Commonly used in the lower area between the lower implantation and the occipital region."),
      requiredFixedRule("cuttingTechnique", GRADUATION_CUTTING_TECHNIQUE, "Elevated graduation cutting."),
      requiredFixedRule("guideType", PROGRESSIVE_GRADUATION_GUIDELINE, "Traveling guide -- each cut strand guides the next."),
      requiredFixedRule("guideReferenceMode", "previous_subsection", "Each subsection references the immediately preceding cut, never a fixed pointer to the original guide."),
      requiredFixedRule("partingOrientation", "vertical", "Primary graduation progression uses vertical partings."),
    ],
    verticalPayload: {
      iterationPolicy: {
        actionKinds: ["CONTROL", "EXECUTE"],
        iteration: {
          mode: "UNTIL_EXECUTION_UNIT_COMPLETE",
          note: "Repeat subsection-by-subsection through the full lower graduated area, each referencing the immediately preceding cut, while this Execution Unit's own conditions remain true. One cut does not complete the Skill.",
        },
      },
    },
    sourceSkillInstanceId: GRADUATED_CUTTING_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-11T00:00:00.000Z",
  },
  {
    executionUnitId: "executionunit-cutting-graduated-upper-90",
    vertical: GRADUATED_CUTTING_VERTICAL,
    order: 3,
    label: "Upper Graduated Area -- 90°, Fingers Downward",
    description:
      "Commonly above the occipital area: strand elevated to approximately 90°, perpendicular to the scalp, held between index and middle finger with fingers oriented downward, cut on the back-of-hand side. Repeats subsection-by-subsection, each cut strand becoming the traveling guide for the next.",
    zoneId: "upper_graduated_area",
    laterality: "NOT_APPLICABLE",
    prerequisiteExecutionUnitIds: ["executionunit-cutting-graduated-perimeter-guide"],
    parameterRules: [
      requiredFixedRule("clientHeadPosition", "upright", "Upper/crown-adjacent graduation execution."),
      requiredFixedRule("controlMethod", "fingers", "Elevated graduation work is finger-controlled."),
      requiredFixedRule("handOrientation", "fingers_downward_back_of_hand_cut", "90° work: fingers oriented downward, cutting on the back-of-hand side."),
      requiredFixedRule("elevation", UPPER_GRADUATION_ELEVATION, "Strand elevated perpendicular to the scalp, commonly above the occipital area."),
      requiredFixedRule("cuttingTechnique", GRADUATION_CUTTING_TECHNIQUE, "Elevated graduation cutting."),
      requiredFixedRule("guideType", PROGRESSIVE_GRADUATION_GUIDELINE, "Traveling guide -- each cut strand guides the next."),
      requiredFixedRule("guideReferenceMode", "previous_subsection", "Each subsection references the immediately preceding cut, never a fixed pointer to the original guide."),
      requiredFixedRule("partingOrientation", "vertical", "Primary graduation progression uses vertical partings."),
    ],
    verticalPayload: {
      iterationPolicy: {
        actionKinds: ["CONTROL", "EXECUTE"],
        iteration: {
          mode: "UNTIL_EXECUTION_UNIT_COMPLETE",
          note: "Repeat subsection-by-subsection through the full upper graduated area, each referencing the immediately preceding cut, while this Execution Unit's own conditions remain true. One cut does not complete the Skill.",
        },
      },
    },
    sourceSkillInstanceId: GRADUATED_CUTTING_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-11T00:00:00.000Z",
  },
  {
    executionUnitId: "executionunit-cutting-graduated-cross-check",
    vertical: GRADUATED_CUTTING_VERTICAL,
    order: 4,
    label: "Cross-Check & Correction",
    description:
      "After the full lower/upper progression: cross-check using wider horizontal partings in the direction opposing the primary vertical partings, re-elevating according to the relevant angle for that area, and correcting any protruding longer ends. Graduation is not complete after one cut -- completion requires full-area progression plus this cross-check.",
    zoneId: "cross_check_area",
    laterality: "NOT_APPLICABLE",
    prerequisiteExecutionUnitIds: ["executionunit-cutting-graduated-lower-45", "executionunit-cutting-graduated-upper-90"],
    parameterRules: [
      requiredFixedRule("clientHeadPosition", "upright", "Full-head cross-check execution."),
      requiredFixedRule("controlMethod", "fingers", "Cross-check on already-graduated (elevated) sections is finger-controlled."),
      requiredFixedRule("handOrientation", "fingers_downward_back_of_hand_cut", "Cross-check re-elevation mirrors the upper-area hand geometry."),
      requiredFixedRule("cuttingTechnique", GRADUATION_CUTTING_TECHNIQUE, "Corrective cutting on already-elevated structure."),
      requiredFixedRule("guideType", PROGRESSIVE_GRADUATION_GUIDELINE, "Cross-check re-references the already-established traveling guide."),
      requiredFixedRule("guideReferenceMode", "previous_subsection", "Correction references the already-cut graduated structure."),
      requiredFixedRule("partingOrientation", "horizontal", "Cross-check uses wider horizontal sections, opposing the primary vertical partings."),
    ],
    sourceSkillInstanceId: GRADUATED_CUTTING_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-11T00:00:00.000Z",
  },
];
