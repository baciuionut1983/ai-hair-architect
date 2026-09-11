import type { CuttingTechnique, StructuralTechnique, TechnicalCutDistribution, TechnicalCutElevation } from "@/lib/contracts";
import { CUTTING_TECHNIQUES, DISTRIBUTION_OPTIONS, ELEVATION_OPTIONS, STRUCTURAL_TECHNIQUES } from "@/lib/proposal-validators";
import type { SkillDefinition } from "@/lib/professional-skill-contracts";
import { EXECUTION_RULE_CONDITION_FACTS, type ExecutionRuleConditionFact } from "@/lib/technical-demonstration-execution-profile-contracts";
import type { SkillInstance, SkillInstanceParameterBinding } from "@/lib/professional-skill-instance-contracts";
import type { ExecutionUnit, ExecutionUnitParameterRule } from "@/lib/professional-skill-execution-unit-contracts";

// AI Hair Architect, Stage 8.5S1B -- REAL PROFESSIONAL AUTHORITY CONTENT,
// NOT a synthetic fixture. Authored directly from Ionuț's approved
// definition. Stage 8.5S1B.R1 CORRECTION (this revision): the original
// S1B cut split posterior construction into "below occipital = comb" /
// "at-and-above occipital = fingers" as two permanently fixed Execution
// Units. That specific anatomical-threshold rule is real, APPROVED,
// existing repository authority -- but only for Occipital Transition's
// own narrow, historically-authorized pilot scope (cutting-skill-
// occipital-transition.ts, Stage 2.5.i.7). Ionuț did NOT approve it as a
// universal law for THIS general, reusable One-Length Perimeter skill.
// Per this correction's own explicit instruction ("if no such approved
// rule exists [for THIS skill], remove that universal assumption"), the
// two posterior units are merged into ONE, and control method becomes a
// case-dependent PROFESSIONAL CHOICE -- never an automatic anatomical
// threshold baked into this skill's own permanent definition. ZERO
// Composition Engine, ZERO automatic Skill selection, ZERO wiring into
// Technical Demonstration Plan/readiness/coherence/derivation/the
// generator -- exporting these constants has ZERO runtime effect
// anywhere in the application today.
//
// SKILL: "Construct One-Length Perimeter" -- the full, reusable posterior
// + lateral one-length perimeter primitive. The DEFINING TRUTH, verbatim
// per Ionuț's own restatement: NATURAL FALL + ZERO ELEVATION + CONTINUOUS
// PERIMETER GUIDE. Structural perimeter construction with hair maintained
// in NATURAL FALL, NO elevation (elevation out of natural fall is
// Graduated Cutting's own, separate authority, never this Skill's). No
// Slice-and-Slide when preserving this pure straight structure --
// represented structurally via `incompatibleSkillIds` below, never a
// required successor.
//
// CONTROL METHOD, CORRECTED (Stage 8.5S1B.R1): comb versus fingers is now
// a real, open `controlMethod` parameter, resolved at Skill-Instance
// level via PROFESSIONAL_CHOICE for the posterior-construction and
// lateral Execution Units -- a different real case's own Skill Instance
// may bind a different value, reusing these identical Execution Units
// unchanged. It stays REQUIRED_FIXED "comb" on exactly two units where a
// real, CITABLE, already-approved reason exists independent of any
// anatomical threshold: (1) establishing the guide itself, mirroring
// Establish Central Nape Guide's own approved rationale (cutting-skill-
// establish-central-nape-guide.ts, Stage 2.5.i.6 -- "finger thickness may
// create unwanted elevation... the guide is never held between fingers in
// this lower/base area", a rule about GUIDE ESTABLISHMENT specifically,
// not about posterior height); and (2) final verification, which is an
// inspection action (checking the line), never a construction technique
// choice.
//
// RELATIONSHIP TO THE THREE EXISTING SKILLS (Stage 2.5.i.6/i.7/i.25):
// those pilots are narrower, byte-unchanged, historically-authored
// sub-pieces of exactly this technique (central-nape guide only, occipital
// transition only, continue-nape-construction only -- each explicitly
// scoped to exclude lateral execution). This Skill is Ionuț's now-approved
// COMPLETE reusable primitive covering the whole posterior+lateral
// perimeter. It is a NEW, DISTINCT skillId/version -- it does not import,
// alias, retire, or mutate any of the three existing skills' own
// Execution Units. The professional-content overlap (both model "0°
// natural-fall central-nape guide") is a REAL, reported architectural
// observation for a future stage to resolve -- NOT resolved unilaterally
// here.
//
// DEMONSTRATION-SPECIFIC SUBSECTION THICKNESS (Ionuț's own explicit
// instruction, unchanged by this correction): "Horizontal partings may
// progress... approximately 1 cm working sections... Do NOT make exactly
// 1 cm an immutable universal constant." Represented via
// `subsectionThickness` as a free-text `valueKind: "string"` parameter,
// bound at Skill-Instance level with `bindingState:
// "DEMONSTRATION_SPECIFIC"` -- EXACTLY the binding state professional-
// skill-instance-contracts.ts's own header designed for this precise
// situation.
//
// LATERALITY -- the FIRST real use of ExecutionUnit.laterality beyond
// NOT_APPLICABLE anywhere in this codebase: the two lateral Execution
// Units use LEFT/RIGHT directly, exactly as that field was designed for.
//
// FINAL WET-TO-DRY VERIFICATION (Ionuț's own explicit instruction):
// represented via `hairState`'s own second real value ("dry"), bound on
// the dedicated final-verification Execution Unit -- the SAME parameter
// every real Skill already declares, never a second, parallel "phase"
// concept.
//
// INCOMPATIBILITY: `incompatibleSkillIds` names Slice-and-Slide
// Refinement's own real skillKey directly -- a structural, declarative
// record of Ionuț's own explicit rule ("No Slice-and-Slide when
// preserving the pure one-length straight structure"), consulted by a
// FUTURE composition engine (not built here), never enforced by any
// runtime code today -- exactly this field's own already-documented
// boundary.

const ONE_LENGTH_PERIMETER_VERTICAL = "cutting";
const ONE_LENGTH_PERIMETER_AUTHORITY_SOURCE = "Professional authority -- Ionuț's approved definition, Stage 8.5S1B/8.5S1B.R1 implementation authorization (2026-09-11).";

// Stage 8.5S1B.R1 -- reverted to the base, shared fact vocabulary. The
// prior revision reused Occipital Transition's own `aboveOccipitalThreshold`
// boolean specifically to gate a comb/fingers Execution-Unit split this
// correction removes (see file header) -- this Skill's own Execution
// Units no longer reference that fact at all, so importing it would be a
// dependency with no real purpose, never restored merely for
// convenience.
export type OneLengthPerimeterFact = ExecutionRuleConditionFact;

export function isOneLengthPerimeterFact(value: unknown): value is OneLengthPerimeterFact {
  return typeof value === "string" && (EXECUTION_RULE_CONDITION_FACTS as readonly string[]).includes(value);
}

const PERIMETER_ELEVATION: TechnicalCutElevation = "0_deg_blunt";
const PERIMETER_STRUCTURAL_TECHNIQUE: StructuralTechnique = "one_length";
const PERIMETER_CUTTING_TECHNIQUE: CuttingTechnique = "blunt_line";
const PERIMETER_DISTRIBUTION: TechnicalCutDistribution = "natural_fall";

void (STRUCTURAL_TECHNIQUES satisfies readonly StructuralTechnique[]);
void (CUTTING_TECHNIQUES satisfies readonly CuttingTechnique[]);
void (ELEVATION_OPTIONS satisfies readonly TechnicalCutElevation[]);
void (DISTRIBUTION_OPTIONS satisfies readonly TechnicalCutDistribution[]);

export const ONE_LENGTH_PERIMETER_SKILL: SkillDefinition<OneLengthPerimeterFact> = {
  skillId: "skill-cutting-one-length-perimeter",
  version: 1,
  vertical: ONE_LENGTH_PERIMETER_VERTICAL,
  name: "Construct One-Length Perimeter",
  description:
    "Constructs a complete one-length perimeter -- posterior guide establishment, full posterior construction, and left/right lateral connection using the guide behind the ear -- with hair maintained in natural fall and no elevation throughout, verified on dry hair.",
  status: "ACTIVE",
  authorityType: "PROFESSIONALLY_AUTHORED",
  rationale:
    "Professionally authorized by Ionuț (Stage 8.5S1B, corrected Stage 8.5S1B.R1): start posterior, establish the authoritative contour/perimeter guide, progress upward through horizontal subsections (approximately 1 cm as a working reference, not a universal constant), continue into left and right laterals using the already-cut guide behind the ear, no elevation throughout, no Slice-and-Slide when preserving this structure, verified wet-progression-checked and re-verified on dry hair in natural fall. Control method (comb/fingers) is a case-dependent professional choice, not a hardcoded anatomical rule for this general skill.",
  parameters: [
    {
      name: "clientHeadPosition",
      valueKind: "enum",
      allowedValues: ["tilted_forward_down", "upright"],
      description: "Client head position -- forward-tilted throughout posterior/lateral execution, upright for the final dry verification.",
    },
    {
      name: "hairState",
      valueKind: "enum",
      allowedValues: ["wet", "dry"],
      description: "Hair condition -- wet throughout construction, dry for the final re-verification in natural fall.",
    },
    {
      name: "elevation",
      valueKind: "enum",
      allowedValues: [PERIMETER_ELEVATION],
      description: "No elevation, no exceptions -- an elevated strand becomes Graduated Cutting's own, separate authority.",
    },
    {
      name: "distribution",
      valueKind: "enum",
      allowedValues: [PERIMETER_DISTRIBUTION],
      description: "Every section drops into its own natural fall, no exceptions.",
    },
    {
      name: "cuttingTechnique",
      valueKind: "enum",
      allowedValues: [PERIMETER_CUTTING_TECHNIQUE],
      description: "The cutting technique used for every cut in this Skill.",
    },
    {
      name: "structuralTechnique",
      valueKind: "enum",
      allowedValues: [PERIMETER_STRUCTURAL_TECHNIQUE],
      description: "The overall structural technique this Skill constructs.",
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
      description: "Physical orientation the shear is held at during every cut.",
    },
    {
      name: "tool",
      valueKind: "enum",
      allowedValues: ["straight_shear"],
      description: "The tool used for every cut in this Skill.",
    },
    {
      name: "controlMethod",
      valueKind: "enum",
      allowedValues: ["comb", "fingers"],
      description:
        "Control method -- a case-dependent professional choice (Stage 8.5S1B.R1 correction: NOT an automatic anatomical-threshold rule for this general skill). Fixed to comb only where a real, independently-citable reason exists: establishing the guide itself (mirrors Establish Central Nape Guide's own approved rationale) and final verification (an inspection action). Posterior construction and lateral connection resolve this from the source Skill Instance's own professional choice.",
    },
    {
      name: "subsectionThickness",
      valueKind: "string",
      description: "Working section thickness -- Ionuț commonly uses approximately 1 cm horizontal sections as a professional working reference, adjusted per case by hair density -- never an immutable universal constant.",
    },
    {
      name: "guideReferenceMode",
      valueKind: "enum",
      allowedValues: ["established_perimeter_guide", "previous_subsection", "lateral_connection_guide"],
      description:
        "Which guide this cut references -- 'established_perimeter_guide' for the cut that establishes the authoritative contour/perimeter line itself; 'previous_subsection' for progressive posterior construction (the immediately preceding cut becomes the reference); 'lateral_connection_guide' for lateral sections, which use the already-cut posterior guide behind the ear to connect posterior perimeter into lateral perimeter.",
    },
    {
      name: "guideIdentifiabilityCriterion",
      valueKind: "enum",
      allowedValues: ["must_remain_visually_identifiable"],
      description: "The relevant prior guide must remain visually identifiable before the next cut proceeds.",
    },
  ],
  procedure: [
    {
      order: 1,
      instruction: "Start in the posterior area. Establish the desired final length and create the authoritative contour/perimeter guide, in natural fall with no elevation, using the comb.",
      referencedParameters: ["clientHeadPosition", "controlMethod", "elevation", "distribution", "guideReferenceMode"],
    },
    {
      order: 2,
      instruction:
        "Divide the posterior section using horizontal partings, approximately 1 cm as a professional working reference. For each subsection, drop it into natural fall, expose and confirm the previous guide remains visually identifiable, and cut to the established line. Control method (comb or fingers) is a professional choice for the context, not a fixed anatomical rule.",
      referencedParameters: ["subsectionThickness", "guideIdentifiabilityCriterion", "distribution", "guideReferenceMode", "controlMethod"],
    },
    {
      order: 3,
      instruction: "Progress upward through the full posterior area. A first guide cut alone is not completion -- continue until the full posterior area is complete.",
      referencedParameters: ["structuralTechnique", "elevation"],
    },
    {
      order: 4,
      instruction:
        "Continue into the left and right lateral areas. Use the already-cut posterior guide behind the ear to connect the posterior perimeter into the lateral perimeter. Progress with horizontal partings from ear toward temple, each new section in natural fall with no elevation.",
      referencedParameters: ["guideReferenceMode", "distribution", "elevation"],
    },
    {
      order: 5,
      instruction: "Completion requires the full posterior, lateral-left, and lateral-right progression, with the full contour connected.",
      referencedParameters: ["structuralTechnique", "cuttingTechnique"],
    },
    {
      order: 6,
      instruction:
        "Final verification: identify and correct any unintended longer strands outside the line, check left/right symmetry, verify posterior/lateral line continuity, dry the hair, and verify again on dry hair in natural fall.",
      referencedParameters: ["hairState", "clientHeadPosition", "distribution"],
    },
  ],
  applicableZones: ["posterior_perimeter_start", "posterior_construction", "lateral_left_perimeter", "lateral_right_perimeter", "full_perimeter_verification"],
  // Stage 4 addition -- structured capability declaration. ESTABLISH_GUIDE:
  // this Skill's own first Execution Unit establishes the authoritative
  // perimeter guide. PRESERVE_LENGTH: zero-degree/one-length elevation is,
  // by definition, a preserved (non-reducing, non-increasing) length
  // relationship throughout. PRESERVE_PERIMETER: the defining structural
  // outcome -- the perimeter relationship stays at the perimeter
  // throughout. CONNECT_ZONES: this Skill's own posterior-to-lateral
  // Execution Unit chain structurally connects the two, never a
  // disconnected cut. CROSS_CHECK_VALIDATE: the final verification
  // Execution Unit is an explicit symmetry/continuity confirmation step.
  // Zones use the canonical HeadZone vocabulary, deliberately distinct
  // from this Skill's own vertical-specific applicableZones above.
  capabilities: [
    { kind: "ESTABLISH_GUIDE", zones: ["nape"] },
    { kind: "PRESERVE_LENGTH", zones: ["nape", "occipital", "sides"] },
    { kind: "PRESERVE_PERIMETER" },
    { kind: "CONNECT_ZONES", zones: ["nape", "occipital", "sides"] },
    { kind: "CROSS_CHECK_VALIDATE" },
  ],
  // Ionuț's own explicit rule: no Slice-and-Slide when preserving this
  // pure one-length structure -- declarative only, consulted by a future
  // composition engine, never enforced by any runtime code today.
  incompatibleSkillIds: ["skill-cutting-slice-and-slide-refinement"],
  createdAt: "2026-09-11T00:00:00.000Z",
};

function fixedBinding(parameterName: string, value: string | boolean | number): SkillInstanceParameterBinding<OneLengthPerimeterFact> {
  return { parameterName, bindingState: "FIXED_FROM_AUTHORITY", value, sourceReference: ONE_LENGTH_PERIMETER_AUTHORITY_SOURCE };
}

function professionalChoiceBinding(
  parameterName: string,
  value: string | boolean | number,
  allowedOptions: readonly (string | boolean | number)[],
): SkillInstanceParameterBinding<OneLengthPerimeterFact> {
  return {
    parameterName,
    bindingState: "PROFESSIONAL_CHOICE",
    value,
    allowedOptions,
    confirmedByUserId: "professional-ionut-2026-09-11",
    confirmedAt: "2026-09-11T00:00:00.000Z",
  };
}

export const ONE_LENGTH_PERIMETER_SKILL_INSTANCE: SkillInstance<OneLengthPerimeterFact> = {
  skillInstanceId: "skillinstance-cutting-one-length-perimeter-pilot",
  vertical: ONE_LENGTH_PERIMETER_VERTICAL,
  sourceSkillId: ONE_LENGTH_PERIMETER_SKILL.skillId,
  sourceSkillVersion: ONE_LENGTH_PERIMETER_SKILL.version,
  compositionId: "composition-cutting-one-length-perimeter-pilot-placeholder",
  order: 1,
  parameterBindings: [
    // Constant across every Execution Unit -- bound once at instance level.
    fixedBinding("elevation", PERIMETER_ELEVATION),
    fixedBinding("distribution", PERIMETER_DISTRIBUTION),
    fixedBinding("cuttingTechnique", PERIMETER_CUTTING_TECHNIQUE),
    fixedBinding("structuralTechnique", PERIMETER_STRUCTURAL_TECHNIQUE),
    fixedBinding("cuttingLineShape", "straight"),
    fixedBinding("shearOrientation", "horizontal"),
    fixedBinding("tool", "straight_shear"),
    fixedBinding("guideIdentifiabilityCriterion", "must_remain_visually_identifiable"),
    // Stage 8.5S1B.R1 -- controlMethod is now a real, open, case-dependent
    // PROFESSIONAL_CHOICE (comb/fingers), the fallthrough for whichever
    // Execution Unit does not fix it at EU level (posterior construction,
    // both laterals). A different real case's own Skill Instance may bind
    // "fingers" instead -- see file header for why this is no longer an
    // automatic anatomical-threshold rule.
    professionalChoiceBinding("controlMethod", "comb", ["comb", "fingers"]),
    // DEMONSTRATION_SPECIFIC -- see file header. The real professional
    // rule adapts subsection thickness per case; this value is fixed here
    // only for a deterministic demonstration.
    {
      parameterName: "subsectionThickness",
      bindingState: "DEMONSTRATION_SPECIFIC",
      value: "approximately 1 cm horizontal sections (professional working reference; adjusted per case, never a fixed universal constant)",
      rationale: "Ionuț's own real working reference for this profile -- the underlying professional rule adapts by hair density/case; fixed here only for a deterministic demonstration.",
    },
    // guideReferenceMode genuinely varies by Execution Unit (see each
    // unit's own parameterRules below) and is deliberately NOT bound here.
  ],
  createdAt: "2026-09-11T00:00:00.000Z",
};

function euFixedRule(parameterName: string, value: string | boolean | number, rationale: string): ExecutionUnitParameterRule<OneLengthPerimeterFact> {
  return { parameterName, semantic: "REQUIRED_FIXED", fixedValue: value, rationale };
}

// EXECUTION UNIT COUNT DECISION (Stage 8.5S1B.R1, corrected): 5 -- one per
// real, stable-context professional segment: establishing the posterior
// perimeter guide, full posterior construction (below-occipital and
// at/above-occipital MERGED -- the prior split's own comb/fingers rule
// was Occipital Transition's own narrow, historically-authorized pilot
// authority, never approved as universal for this general skill; no
// anatomical-threshold boundary remains here), lateral connection left,
// lateral connection right (the first real use of ExecutionUnit.laterality
// LEFT/RIGHT in this codebase), and final wet-to-dry verification. Each
// remaining boundary is a real laterality/hair-state transition, never a
// per-sentence split and never a parameter choice disguised as a
// structural boundary.
export const ONE_LENGTH_PERIMETER_EXECUTION_UNITS: readonly ExecutionUnit<OneLengthPerimeterFact>[] = [
  {
    executionUnitId: "executionunit-cutting-one-length-perimeter-establish-guide",
    vertical: ONE_LENGTH_PERIMETER_VERTICAL,
    order: 1,
    label: "Establish Posterior Perimeter Guide",
    description: "Start posterior. Establish the desired final length and the authoritative contour/perimeter guide, in natural fall with no elevation, comb-controlled.",
    zoneId: "posterior_perimeter_start",
    laterality: "NOT_APPLICABLE",
    parameterRules: [
      euFixedRule("clientHeadPosition", "tilted_forward_down", "Posterior guide establishment."),
      euFixedRule("hairState", "wet", "Construction phase, wet hair."),
      euFixedRule("controlMethod", "comb", "Guide establishment specifically: finger thickness may create unwanted elevation, mirroring Establish Central Nape Guide's own approved rationale -- the guide is never held between fingers here."),
      euFixedRule("guideReferenceMode", "established_perimeter_guide", "This cut establishes the authoritative contour/perimeter reference itself."),
    ],
    sourceSkillInstanceId: ONE_LENGTH_PERIMETER_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-11T00:00:00.000Z",
  },
  {
    executionUnitId: "executionunit-cutting-one-length-perimeter-posterior-construction",
    vertical: ONE_LENGTH_PERIMETER_VERTICAL,
    order: 2,
    label: "Posterior Construction (Full Area)",
    description:
      "Divide the posterior section using horizontal partings (approximately 1 cm working reference). Progression through the full posterior area, each subsection cut to the previous guide. Control method (comb or fingers) is a case-dependent professional choice, resolved from this Execution Unit's own source Skill Instance -- no automatic anatomical threshold is encoded here.",
    zoneId: "posterior_construction",
    laterality: "NOT_APPLICABLE",
    prerequisiteExecutionUnitIds: ["executionunit-cutting-one-length-perimeter-establish-guide"],
    parameterRules: [
      euFixedRule("clientHeadPosition", "tilted_forward_down", "Posterior construction."),
      euFixedRule("hairState", "wet", "Construction phase, wet hair."),
      euFixedRule("guideReferenceMode", "previous_subsection", "Each subsection references the immediately preceding cut."),
      // controlMethod deliberately absent -- resolves from the source
      // Skill Instance's own professional choice (see file header).
    ],
    verticalPayload: {
      iterationPolicy: {
        actionKinds: ["CONTROL", "EXECUTE"],
        iteration: { mode: "UNTIL_EXECUTION_UNIT_COMPLETE", note: "Repeat subsection-by-subsection upward through the full posterior area." },
      },
    },
    sourceSkillInstanceId: ONE_LENGTH_PERIMETER_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-11T00:00:00.000Z",
  },
  {
    executionUnitId: "executionunit-cutting-one-length-perimeter-lateral-left",
    vertical: ONE_LENGTH_PERIMETER_VERTICAL,
    order: 3,
    label: "Lateral Connection -- Left",
    description: "Use the already-cut posterior guide behind the left ear to connect the posterior perimeter into the left lateral perimeter. Horizontal partings progress from ear toward temple, each section in natural fall, no elevation.",
    zoneId: "lateral_left_perimeter",
    laterality: "LEFT",
    prerequisiteExecutionUnitIds: ["executionunit-cutting-one-length-perimeter-posterior-construction"],
    parameterRules: [
      euFixedRule("clientHeadPosition", "tilted_forward_down", "Lateral connection execution."),
      euFixedRule("hairState", "wet", "Construction phase, wet hair."),
      euFixedRule("guideReferenceMode", "lateral_connection_guide", "Uses the already-cut posterior guide behind the ear to connect posterior perimeter into lateral perimeter."),
      // controlMethod deliberately absent -- resolves from the source
      // Skill Instance's own professional choice.
    ],
    verticalPayload: {
      iterationPolicy: {
        actionKinds: ["CONTROL", "EXECUTE"],
        iteration: { mode: "UNTIL_EXECUTION_UNIT_COMPLETE", note: "Repeat section-by-section from ear toward temple through the full left lateral perimeter." },
      },
    },
    sourceSkillInstanceId: ONE_LENGTH_PERIMETER_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-11T00:00:00.000Z",
  },
  {
    executionUnitId: "executionunit-cutting-one-length-perimeter-lateral-right",
    vertical: ONE_LENGTH_PERIMETER_VERTICAL,
    order: 4,
    label: "Lateral Connection -- Right",
    description: "Use the already-cut posterior guide behind the right ear to connect the posterior perimeter into the right lateral perimeter. Horizontal partings progress from ear toward temple, each section in natural fall, no elevation.",
    zoneId: "lateral_right_perimeter",
    laterality: "RIGHT",
    prerequisiteExecutionUnitIds: ["executionunit-cutting-one-length-perimeter-posterior-construction"],
    parameterRules: [
      euFixedRule("clientHeadPosition", "tilted_forward_down", "Lateral connection execution."),
      euFixedRule("hairState", "wet", "Construction phase, wet hair."),
      euFixedRule("guideReferenceMode", "lateral_connection_guide", "Uses the already-cut posterior guide behind the ear to connect posterior perimeter into lateral perimeter."),
      // controlMethod deliberately absent -- resolves from the source
      // Skill Instance's own professional choice.
    ],
    verticalPayload: {
      iterationPolicy: {
        actionKinds: ["CONTROL", "EXECUTE"],
        iteration: { mode: "UNTIL_EXECUTION_UNIT_COMPLETE", note: "Repeat section-by-section from ear toward temple through the full right lateral perimeter." },
      },
    },
    sourceSkillInstanceId: ONE_LENGTH_PERIMETER_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-11T00:00:00.000Z",
  },
  {
    executionUnitId: "executionunit-cutting-one-length-perimeter-final-verification",
    vertical: ONE_LENGTH_PERIMETER_VERTICAL,
    order: 5,
    label: "Final Verification -- Wet Check + Dry Re-Check",
    description:
      "Identify and correct any unintended longer strands outside the line. Check left/right symmetry and posterior/lateral line continuity. Dry the hair and verify again on dry hair in natural fall. A first guide cut alone is not completion -- this final verification requires the full posterior + lateral-left + lateral-right progression to already be complete.",
    zoneId: "full_perimeter_verification",
    laterality: "BILATERAL",
    prerequisiteExecutionUnitIds: ["executionunit-cutting-one-length-perimeter-lateral-left", "executionunit-cutting-one-length-perimeter-lateral-right"],
    parameterRules: [
      euFixedRule("clientHeadPosition", "upright", "Final verification, natural resting position."),
      euFixedRule("hairState", "dry", "Verified on dry hair in natural fall, after the initial wet-progression check."),
      euFixedRule("controlMethod", "comb", "Final verification is an inspection action (re-combing to check continuity/symmetry), not a construction technique choice."),
      euFixedRule("guideReferenceMode", "previous_subsection", "Verification re-references the already-established, already-connected perimeter line."),
    ],
    sourceSkillInstanceId: ONE_LENGTH_PERIMETER_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-11T00:00:00.000Z",
  },
];
