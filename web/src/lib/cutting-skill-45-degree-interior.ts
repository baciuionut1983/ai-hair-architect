import type { SkillDefinition } from "@/lib/professional-skill-contracts";
import { EXECUTION_RULE_CONDITION_FACTS, type ExecutionRuleConditionFact } from "@/lib/technical-demonstration-execution-profile-contracts";
import type { SkillInstance, SkillInstanceParameterBinding } from "@/lib/professional-skill-instance-contracts";
import type { ExecutionUnit, ExecutionUnitParameterRule } from "@/lib/professional-skill-execution-unit-contracts";
import type { AtomicAction } from "@/lib/professional-skill-atomic-action-contracts";
import { buildGuideRelationshipCapability, type GuideRelationshipCapability } from "@/lib/professional-skill-guide-relationship-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.4.R2 --
// "45deg INTERIOR" / ONE-LENGTH INWARD-CURVE TECHNIQUE. PROPOSAL ONLY.
// Pure, no I/O, no database, ZERO AI calls, ZERO registry writes, ZERO
// wiring into professional-brain-skill-templates.ts's own
// buildCanonicalCandidateSkillRegistry() -- this Skill is DRAFT, never
// ACTIVE, and therefore structurally INELIGIBLE for authority via the
// SAME existing gate every other skill in this codebase already uses
// (isSkillEligibleForAuthority requires status === "ACTIVE"; a DRAFT
// skill fails that check unconditionally, regardless of authorityType).
// That is the entire "must remain PENDING_PROFESSIONAL_APPROVAL"
// requirement for this stage, satisfied by an EXISTING mechanism -- no
// new gating concept was invented for this file.
//
// PROVENANCE: this is Ionuț's own direct professional input, supplied at
// Stage 8.5L5.R3.4.R2 -- NOT extracted from the L5.R2 video, NOT an AI
// observation or inference, and NOT the same evidence chain as L5.R3's
// ApprovedKnowledgeSource/ProfessionalLearningReview (SOURCE_EVIDENCE_ID
// / REVIEW_ID / APPROVED_RESULT_HASH, reused throughout the L5.R3.x
// chain). Reusing those L5.R2 identifiers here would misattribute this
// new definition to a specific video-review event it never came from --
// so this file's own sibling, professional-knowledge-assimilation-
// l5r3-4-r2-proposal.ts, defines its OWN, separate, honestly-labeled
// professional-authority record instead of wrapping this in a
// ProfessionalReviewDecision (the L5.R3.2 vehicle for "AI claim +
// professional decision about THAT claim", or "professional addition
// surfaced during a specific video review" -- Channel Cut's own #13
// precedent -- neither of which describes this case: there is no
// review-event anchor for this content at all).
//
// THE STRUCTURAL DISTINCTNESS THIS FILE EXISTS TO PROVE: Graduated
// Cutting's "45deg" (cutting-skill-graduated.ts) is an ELEVATION value --
// how far a strand is lifted out of its natural fall before cutting.
// This Skill's "45deg" is a CUTTING-LINE/GEOMETRY value -- the angle of
// the cutting line itself, produced by a hand-rotation maneuver on
// ALREADY-NATURAL-FALL, zero-elevation hair. These are never the same
// fact, and this Skill declares NO parameter named "elevation" anywhere
// -- not NOT_APPLICABLE, not UNKNOWN, not a fabricated 0deg. There is no
// codebase-wide mandatory "every skill must declare elevation" schema
// (verified directly: SkillDefinition.parameters,
// ExecutionUnitParameterRule.parameterName, and
// SkillInstanceParameterBinding.parameterName are all open, per-skill-
// authored string fields -- confirmed by reading professional-skill-
// contracts.ts / professional-skill-execution-unit-contracts.ts /
// professional-skill-instance-contracts.ts directly), so the honest
// answer is structural non-existence, not a value in a field that
// doesn't need to exist. The distinct fact this Skill DOES declare is
// `terminalCuttingLineAngle`, an entirely separate parameter name.
//
// DEPENDENCY, NOT MERGER (Ionuț's own explicit rule: this technique is
// used ONLY after a COMPLETE One-Length haircut, never during its
// construction, and "used only on One-Length" does not mean "every
// One-Length requires it"): `prerequisiteSkillIds` names One-Length
// Perimeter's real skillId -- a one-directional, declarative-only edge
// (never enforced by any runtime code today, mirroring every other
// prerequisiteSkillIds/incompatibleSkillIds use in this codebase). Zero
// edits were made to cutting-skill-one-length-perimeter.ts -- that file
// carries no reference back to this Skill, so nothing about One-Length's
// own meaning changed, and no reader of One-Length alone could ever
// infer this technique is mandatory. `applicabilityCondition` further
// states the precondition as a fact (`oneLengthStructureComplete` =
// true), reusing SkillCondition exactly like Graduated Cutting's own
// `perimeterGuideRequired` precedent -- informational for a future
// composition engine, never a filter that forces inclusion.
//
// MECHANICS vs EFFECT, kept structurally separate (Ionuț's own explicit
// rule: never encode the inward-curvature EFFECT as if it were itself a
// cutting instruction): every parameter and Execution Unit below
// describes MECHANICS ONLY (sectioning, finger control, hand rotation,
// corner repositioning, cut direction, resulting cutting-line angle,
// resulting exterior/interior length relationship). The inward-curvature
// EFFECT itself is never a parameter, never an Execution Unit, and never
// an AtomicAction on this Skill's own compiled sequence -- it exists
// ONLY as descriptive prose (this Skill's own `rationale`/`description`)
// and in the separate, explicitly-labeled INTERIOR_45_EFFECT_SUMMARY
// object below, which is NOT part of the SkillDefinition/ExecutionUnit/
// AtomicAction shape at all.
//
// CAPABILITY: REFINE_ENDS only -- the one existing PROCEDURAL
// SkillCapabilityKind that honestly describes "reshapes an
// already-established termination", per professional-skill-contracts.ts's
// own documented PROCEDURAL-kind family (ESTABLISH_GUIDE/CONNECT_ZONES/
// CROSS_CHECK_VALIDATE/REFINE_ENDS -- "real, honest things a skill does,
// but NOT a state transformation a delta ever expresses on its own").
// No OUTCOME capability kind (REDUCE_LENGTH/PRESERVE_LENGTH/etc.) is
// declared: this technique's real effect (inward terminal curvature) has
// no corresponding HairStateDeltaTransformation field anywhere in
// hair-state-snapshot-validators.ts (verified directly -- see this
// stage's own report, "state delta" section) -- declaring an OUTCOME
// kind with no real delta field to ever match against would be exactly
// the "invent false precision" professional-skill-contracts.ts's own
// SkillCapability header already refuses to do.
//
// GUIDE/REFERENCE SEMANTICS: audited against L5.R3.3's
// GuideRelationshipCapability model (see INTERIOR_45_GUIDE_CAPABILITY
// below) -- deliberately NOT classified as a travelling guide, and NOT
// classified as PERIMETER_CONTOUR_GUIDE/PREVIOUSLY_CUT_SECTION source
// either: Ionuț's own words ("progresses downward toward the lower
// reference/guide line") establish only that the cut is made RELATIVE TO
// a lower reference -- not WHAT that reference structurally is (the
// original One-Length termination point on this same strand? a visual
// mark? something else?) or WHETHER it moves. Per this stage's own
// explicit instruction ("if not explicit enough, keep UNKNOWN rather
// than inventing"), guideSource/guideRole/guideBehavior/progression/
// referenceProgression all stay UNKNOWN; only currentSectionRelationship
// is set (CUT_RELATIVE_TO_GUIDE), directly grounded in Ionuț's own
// "toward the lower reference/guide line" phrase.
//
// ELEVATION SEMANTICS TEST: see this file's own test suite for the
// dedicated, explicit assertion that no parameter named "elevation"
// exists anywhere on INTERIOR_45_SKILL.
//
// WHAT THIS FILE IS NOT: it does not modify cutting-skill-graduated.ts,
// cutting-skill-one-length-perimeter.ts, cutting-skill-slice-and-slide-
// refinement.ts, or any other existing skill file -- zero edits, zero
// imports of their own internal constants. It is not registered in
// professional-brain-skill-templates.ts's buildCanonicalCandidateSkillRegistry().
// It performs zero database writes, zero AI/provider calls, zero video
// generation.

const INTERIOR_45_VERTICAL = "cutting";
export const INTERIOR_45_AUTHORITY_SOURCE = "Professional authority -- Ionuț's direct professional input, Stage 8.5L5.R3.4.R2 (2026-09-15). NOT extracted from the L5.R2 video review, NOT an AI observation or inference.";

// One new, locally-scoped precondition fact -- mirrors GraduatedCuttingFact's
// own exact "ExecutionRuleConditionFact | one new local fact" precedent
// (cutting-skill-graduated.ts).
export type InteriorFortyFiveFact = ExecutionRuleConditionFact | "oneLengthStructureComplete";

export function isInteriorFortyFiveFact(value: unknown): value is InteriorFortyFiveFact {
  return value === "oneLengthStructureComplete" || (typeof value === "string" && (EXECUTION_RULE_CONDITION_FACTS as readonly string[]).includes(value));
}

export const INTERIOR_45_SKILL: SkillDefinition<InteriorFortyFiveFact> = {
  skillId: "skill-cutting-45-degree-interior",
  version: 1,
  vertical: INTERIOR_45_VERTICAL,
  name: "45deg Interior (Inward-Curve Terminal Technique)",
  status: "DRAFT",
  authorityType: "PROFESSIONALLY_AUTHORED",
  description:
    "Applied only after a complete One-Length perimeter, works the perimetral termination region (front of one ear -> posterior -> front of the other ear) in vertical ~2cm sections. Hair is controlled between fingers, fingertips beginning down; the hand rotates without lifting away from the base until fingertips point up, repositioning the strand's interior corner lower and exterior corner upper. The cut begins at the upper/exterior corner and progresses downward toward the lower reference line, producing an approximately 45deg cutting line. The result is exterior terminal hair shorter than interior terminal hair on each section -- a length relationship that causes the terminations to turn inward.",
  rationale:
    "Professionally authorized by Ionuț (Stage 8.5L5.R3.4.R2): a distinct, reusable terminal-geometry transformation, dependent on (never merged into) a completed One-Length structure, and structurally distinct from Graduated Cutting's own elevation-driven 45deg despite the shared numeral -- this Skill's 45deg is a cutting-line/geometry fact produced by hand rotation on zero-elevation, natural-fall hair, never a strand-elevation value. Mechanics (sectioning, finger control, hand rotation, corner repositioning, cut direction, resulting cutting-line angle, resulting length relationship) are represented here; the resulting inward-curvature EFFECT is deliberately kept out of this Skill's own procedure/parameters (see INTERIOR_45_EFFECT_SUMMARY in the sibling proposal file).",
  applicabilityCondition: { op: "equals", fact: "oneLengthStructureComplete", value: true },
  prerequisiteSkillIds: ["skill-cutting-one-length-perimeter"],
  parameters: [
    {
      name: "workRegion",
      valueKind: "enum",
      allowedValues: ["front_perimeter_first_side", "posterior_perimeter", "front_perimeter_second_side"],
      description: "Which real perimetral termination region this execution addresses, worked in this professional order: front of one ear, then posterior, then front of the other ear.",
    },
    {
      name: "sectionOrientation",
      valueKind: "enum",
      allowedValues: ["vertical"],
      description: "Partings used throughout this technique are vertical, never horizontal.",
    },
    {
      name: "sectionWidth",
      valueKind: "string",
      description: "Working strand/section width -- Ionuț's own approximate professional working reference is approximately 2cm, adjusted per case -- never an immutable universal constant (same DEMONSTRATION_SPECIFIC discipline as One-Length Perimeter's own subsectionThickness).",
    },
    {
      name: "strandControlMethod",
      valueKind: "enum",
      allowedValues: ["controlled_between_fingers"],
      description: "The strand is held and controlled between the fingers throughout -- the only control method Ionuț described for this technique.",
    },
    {
      name: "fingertipTransition",
      valueKind: "enum",
      allowedValues: ["down_to_up_via_rotation"],
      description: "Fingertips begin pointing down and become pointing up, achieved by rotating the hand -- never by any other mechanism.",
    },
    {
      name: "cornerRepositioning",
      valueKind: "enum",
      allowedValues: ["interior_corner_lower_exterior_corner_upper"],
      description: "The single, closed, non-reversible outcome of the hand rotation: the strand's interior corner repositions to the lower position, the exterior corner repositions to the upper position. Represented as one indivisible fact specifically so it can never be accidentally inverted by two independently-set fields.",
    },
    {
      name: "cutStartCorner",
      valueKind: "enum",
      allowedValues: ["upper_exterior_corner"],
      description: "The cut begins at the upper/exterior corner of the repositioned strand.",
    },
    {
      name: "cutDirection",
      valueKind: "enum",
      allowedValues: ["downward_toward_lower_reference"],
      description: "The cut progresses downward, toward the lower reference/guide line -- see this Skill's own INTERIOR_45_GUIDE_CAPABILITY for why WHAT that lower reference structurally is stays UNKNOWN.",
    },
    {
      name: "terminalCuttingLineAngle",
      valueKind: "enum",
      allowedValues: ["approximately_45_deg_interior_cutting_line"],
      description: "THE structurally distinct '45deg' fact this Skill declares -- the geometry of the cutting line itself, produced by the hand-rotation maneuver above, on already-natural-fall (zero elevation) hair. This is never the same fact as Graduated Cutting's own `elevation` parameter (how far a strand is lifted out of natural fall before cutting) -- this Skill declares no `elevation` parameter at all.",
    },
    {
      name: "terminalLengthRelationship",
      valueKind: "enum",
      allowedValues: ["exterior_shorter_than_interior"],
      description: "The resulting terminal length relationship on each cut section: exterior hair shorter, interior hair longer. Deliberately the OPPOSITE polarity from Graduated Cutting's own documented 'interior-shorter-than-perimeter' statement -- these describe two structurally different comparisons (a within-strand corner-to-corner relationship here, vs. an elevated-zone-to-perimeter-guide relationship there), never the same fact, never reconciled by editing either skill (see this stage's own report for the full independent audit).",
    },
  ],
  procedure: [
    {
      order: 1,
      instruction: "Precondition: the One-Length haircut must already be complete. Begin at the front of one ear and work the perimetral termination region using vertical partings, isolating strands of approximately 2cm width as a professional working reference.",
      referencedParameters: ["workRegion", "sectionOrientation", "sectionWidth"],
    },
    {
      order: 2,
      instruction: "Control the strand between the fingers, fingertips initially pointing down.",
      referencedParameters: ["strandControlMethod", "fingertipTransition"],
    },
    {
      order: 3,
      instruction: "Rotate the hand -- without lifting it away from the base, remaining at the same low level throughout -- until the fingertips point up. This rotation repositions the strand's interior corner to the lower position and its exterior corner to the upper position.",
      referencedParameters: ["fingertipTransition", "cornerRepositioning"],
    },
    {
      order: 4,
      instruction: "Begin the cut at the upper/exterior corner and progress downward toward the lower reference line, producing an approximately 45deg cutting line. Release the strand.",
      referencedParameters: ["cutStartCorner", "cutDirection", "terminalCuttingLineAngle"],
    },
    {
      order: 5,
      instruction: "Confirm the resulting terminal length relationship on this section: exterior hair shorter than interior hair.",
      referencedParameters: ["terminalLengthRelationship"],
    },
    {
      order: 6,
      instruction: "Progress section-by-section through the front-first-side, posterior, and front-second-side regions in that order. Completion requires the full intended perimetral region to be worked -- a single section alone is not completion.",
      referencedParameters: ["workRegion"],
    },
  ],
  applicableZones: ["front_perimeter_first_side", "posterior_perimeter", "front_perimeter_second_side"],
  capabilities: [{ kind: "REFINE_ENDS" }],
  createdAt: "2026-09-15T00:00:00.000Z",
};

function fixedBinding(parameterName: string, value: string | boolean | number): SkillInstanceParameterBinding<InteriorFortyFiveFact> {
  return { parameterName, bindingState: "FIXED_FROM_AUTHORITY", value, sourceReference: INTERIOR_45_AUTHORITY_SOURCE };
}

export const INTERIOR_45_SKILL_INSTANCE: SkillInstance<InteriorFortyFiveFact> = {
  skillInstanceId: "skillinstance-cutting-45-degree-interior-proposal",
  vertical: INTERIOR_45_VERTICAL,
  sourceSkillId: INTERIOR_45_SKILL.skillId,
  sourceSkillVersion: INTERIOR_45_SKILL.version,
  compositionId: "composition-cutting-45-degree-interior-proposal-placeholder",
  order: 1,
  applicabilityResolution: {
    applies: true,
    factsUsed: [{ fact: "oneLengthStructureComplete", value: true, source: "PROFESSIONAL_INPUT" }],
  },
  parameterBindings: [
    fixedBinding("sectionOrientation", "vertical"),
    fixedBinding("strandControlMethod", "controlled_between_fingers"),
    fixedBinding("fingertipTransition", "down_to_up_via_rotation"),
    fixedBinding("cornerRepositioning", "interior_corner_lower_exterior_corner_upper"),
    fixedBinding("cutStartCorner", "upper_exterior_corner"),
    fixedBinding("cutDirection", "downward_toward_lower_reference"),
    fixedBinding("terminalCuttingLineAngle", "approximately_45_deg_interior_cutting_line"),
    fixedBinding("terminalLengthRelationship", "exterior_shorter_than_interior"),
    // DEMONSTRATION_SPECIFIC -- see file header and SkillDefinition's own
    // `sectionWidth` description. Never bound at Execution-Unit level,
    // mirroring One-Length Perimeter's own subsectionThickness precedent
    // exactly.
    {
      parameterName: "sectionWidth",
      bindingState: "DEMONSTRATION_SPECIFIC",
      value: "approximately 2cm vertical strands/sections (professional working reference; adjusted per case, never a fixed universal requirement)",
      rationale: "Ionuț's own explicit approximate value -- adjusted per case; fixed here only for a deterministic demonstration.",
    },
    // workRegion genuinely varies by Execution Unit (see each unit's own
    // parameterRules below) and is deliberately NOT bound here.
  ],
  createdAt: "2026-09-15T00:00:00.000Z",
};

function euFixedRule(parameterName: string, value: string | boolean | number, rationale: string): ExecutionUnitParameterRule<InteriorFortyFiveFact> {
  return { parameterName, semantic: "REQUIRED_FIXED", fixedValue: value, rationale };
}

// EXECUTION UNIT COUNT: 3 -- one per real region in Ionuț's own stated
// traversal order (front of one ear -> posterior -> front of the other
// ear). Laterality is deliberately NOT_APPLICABLE on both front units:
// Ionuț did not specify which physical side is worked first, and the
// mechanics are identical on either side -- inventing a LEFT/RIGHT
// assignment neither stated nor functionally required would misrepresent
// unstated content as professional authority.
export const INTERIOR_45_EXECUTION_UNITS: readonly ExecutionUnit<InteriorFortyFiveFact>[] = [
  {
    executionUnitId: "executionunit-cutting-45-degree-interior-front-first-side",
    vertical: INTERIOR_45_VERTICAL,
    order: 1,
    label: "Front Perimeter -- First Side",
    description: "Begin the 45deg Interior technique at the front perimeter, first side, in vertical ~2cm sections.",
    zoneId: "front_perimeter_first_side",
    laterality: "NOT_APPLICABLE",
    parameterRules: [
      euFixedRule("workRegion", "front_perimeter_first_side", "This Execution Unit's own scope -- the first region in Ionuț's stated traversal order."),
      euFixedRule("sectionOrientation", "vertical", "Vertical partings throughout this technique."),
      euFixedRule("strandControlMethod", "controlled_between_fingers", "The only control method Ionuț described for this technique."),
      euFixedRule("cornerRepositioning", "interior_corner_lower_exterior_corner_upper", "The single, non-reversible outcome of the hand-rotation mechanics."),
      euFixedRule("cutStartCorner", "upper_exterior_corner", "The cut always begins at the upper/exterior corner."),
      euFixedRule("cutDirection", "downward_toward_lower_reference", "The cut always progresses downward toward the lower reference/guide line."),
      euFixedRule("terminalCuttingLineAngle", "approximately_45_deg_interior_cutting_line", "The resulting cutting-line geometry -- never the elevation dimension."),
      euFixedRule("terminalLengthRelationship", "exterior_shorter_than_interior", "The resulting terminal length relationship on every section of this technique."),
    ],
    verticalPayload: {
      iterationPolicy: {
        actionKinds: ["CONTROL", "EXECUTE"],
        iteration: { mode: "UNTIL_EXECUTION_UNIT_COMPLETE", note: "Repeat section-by-section (approximately 2cm vertical strands) through the full front-first-side region." },
      },
    },
    sourceSkillInstanceId: INTERIOR_45_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-15T00:00:00.000Z",
  },
  {
    executionUnitId: "executionunit-cutting-45-degree-interior-posterior",
    vertical: INTERIOR_45_VERTICAL,
    order: 2,
    label: "Posterior Perimeter",
    description: "Continue the 45deg Interior technique through the posterior perimeter, in vertical ~2cm sections.",
    zoneId: "posterior_perimeter",
    laterality: "NOT_APPLICABLE",
    prerequisiteExecutionUnitIds: ["executionunit-cutting-45-degree-interior-front-first-side"],
    parameterRules: [
      euFixedRule("workRegion", "posterior_perimeter", "This Execution Unit's own scope -- the second region in Ionuț's stated traversal order."),
      euFixedRule("sectionOrientation", "vertical", "Vertical partings throughout this technique."),
      euFixedRule("strandControlMethod", "controlled_between_fingers", "The only control method Ionuț described for this technique."),
      euFixedRule("cornerRepositioning", "interior_corner_lower_exterior_corner_upper", "The single, non-reversible outcome of the hand-rotation mechanics."),
      euFixedRule("cutStartCorner", "upper_exterior_corner", "The cut always begins at the upper/exterior corner."),
      euFixedRule("cutDirection", "downward_toward_lower_reference", "The cut always progresses downward toward the lower reference/guide line."),
      euFixedRule("terminalCuttingLineAngle", "approximately_45_deg_interior_cutting_line", "The resulting cutting-line geometry -- never the elevation dimension."),
      euFixedRule("terminalLengthRelationship", "exterior_shorter_than_interior", "The resulting terminal length relationship on every section of this technique."),
    ],
    verticalPayload: {
      iterationPolicy: {
        actionKinds: ["CONTROL", "EXECUTE"],
        iteration: { mode: "UNTIL_EXECUTION_UNIT_COMPLETE", note: "Repeat section-by-section (approximately 2cm vertical strands) through the full posterior region." },
      },
    },
    sourceSkillInstanceId: INTERIOR_45_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-15T00:00:00.000Z",
  },
  {
    executionUnitId: "executionunit-cutting-45-degree-interior-front-second-side",
    vertical: INTERIOR_45_VERTICAL,
    order: 3,
    label: "Front Perimeter -- Second Side",
    description: "Complete the 45deg Interior technique at the front perimeter, second side, in vertical ~2cm sections.",
    zoneId: "front_perimeter_second_side",
    laterality: "NOT_APPLICABLE",
    prerequisiteExecutionUnitIds: ["executionunit-cutting-45-degree-interior-posterior"],
    parameterRules: [
      euFixedRule("workRegion", "front_perimeter_second_side", "This Execution Unit's own scope -- the third and final region in Ionuț's stated traversal order."),
      euFixedRule("sectionOrientation", "vertical", "Vertical partings throughout this technique."),
      euFixedRule("strandControlMethod", "controlled_between_fingers", "The only control method Ionuț described for this technique."),
      euFixedRule("cornerRepositioning", "interior_corner_lower_exterior_corner_upper", "The single, non-reversible outcome of the hand-rotation mechanics."),
      euFixedRule("cutStartCorner", "upper_exterior_corner", "The cut always begins at the upper/exterior corner."),
      euFixedRule("cutDirection", "downward_toward_lower_reference", "The cut always progresses downward toward the lower reference/guide line."),
      euFixedRule("terminalCuttingLineAngle", "approximately_45_deg_interior_cutting_line", "The resulting cutting-line geometry -- never the elevation dimension."),
      euFixedRule("terminalLengthRelationship", "exterior_shorter_than_interior", "The resulting terminal length relationship on every section of this technique."),
    ],
    verticalPayload: {
      iterationPolicy: {
        actionKinds: ["CONTROL", "EXECUTE"],
        iteration: { mode: "UNTIL_EXECUTION_UNIT_COMPLETE", note: "Repeat section-by-section (approximately 2cm vertical strands) through the full front-second-side region." },
      },
    },
    sourceSkillInstanceId: INTERIOR_45_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-15T00:00:00.000Z",
  },
];

// ---------------------------------------------------------------------
// AtomicAction representative sequence (report Section "future video
// representability") -- compiled ONLY from EU1 (Front Perimeter, First
// Side), proving REPRESENTATIONAL compatibility with the existing
// AtomicAction contract (isValidAtomicAction/isValidAtomicActionSequence)
// without claiming a full 3-EU compile, which is future work. MECHANICS
// only -- the inward-curvature EFFECT is never one of these actions (see
// file header).
// ---------------------------------------------------------------------

const FRONT_FIRST_SIDE_EU_ID = "executionunit-cutting-45-degree-interior-front-first-side";

export const INTERIOR_45_REPRESENTATIVE_ATOMIC_ACTIONS: readonly AtomicAction<InteriorFortyFiveFact>[] = [
  {
    atomicActionId: "atomicaction-45-degree-interior-isolate-section",
    vertical: INTERIOR_45_VERTICAL,
    order: 1,
    actionKind: "PREPARE",
    sourceExecutionUnitId: FRONT_FIRST_SIDE_EU_ID,
    sourceSkillId: INTERIOR_45_SKILL.skillId,
    sourceSkillVersion: INTERIOR_45_SKILL.version,
    boundParameterNames: ["sectionOrientation", "sectionWidth"],
    presentationSummary: "Isolate a vertical, approximately 2cm strand within the front-first-side perimeter region.",
    compiledAt: "2026-09-15T00:00:00.000Z",
  },
  {
    atomicActionId: "atomicaction-45-degree-interior-fingertips-down",
    vertical: INTERIOR_45_VERTICAL,
    order: 2,
    actionKind: "POSITION",
    sourceExecutionUnitId: FRONT_FIRST_SIDE_EU_ID,
    sourceSkillId: INTERIOR_45_SKILL.skillId,
    sourceSkillVersion: INTERIOR_45_SKILL.version,
    boundParameterNames: ["strandControlMethod"],
    stateTransition: { fact: "fingertipOrientation", toValue: "down" },
    presentationSummary: "Control the strand between the fingers, fingertips initially pointing down.",
    compiledAt: "2026-09-15T00:00:00.000Z",
  },
  {
    atomicActionId: "atomicaction-45-degree-interior-hand-rotation",
    vertical: INTERIOR_45_VERTICAL,
    order: 3,
    actionKind: "CONTROL",
    sourceExecutionUnitId: FRONT_FIRST_SIDE_EU_ID,
    sourceSkillId: INTERIOR_45_SKILL.skillId,
    sourceSkillVersion: INTERIOR_45_SKILL.version,
    boundParameterNames: ["fingertipTransition"],
    // The rotation itself: fingertips move down -> up. Hand HEIGHT is
    // deliberately NOT represented as changing anywhere in this
    // sequence -- see the next action's own observationCriterion, which
    // structurally proves the "same low level, never lifted" invariant
    // as a checkable fact, never a false elevation value.
    stateTransition: { fact: "fingertipOrientation", fromValue: "down", toValue: "up" },
    presentationSummary: "Rotate the hand until the fingertips point up, repositioning the interior corner lower and the exterior corner upper.",
    compiledAt: "2026-09-15T00:00:00.000Z",
  },
  {
    atomicActionId: "atomicaction-45-degree-interior-hand-height-invariant-check",
    vertical: INTERIOR_45_VERTICAL,
    order: 4,
    actionKind: "VERIFY",
    sourceExecutionUnitId: FRONT_FIRST_SIDE_EU_ID,
    sourceSkillId: INTERIOR_45_SKILL.skillId,
    sourceSkillVersion: INTERIOR_45_SKILL.version,
    observationCriterion: { fact: "handLiftedFromBase", expectedValue: false, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" },
    presentationSummary: "Confirm the hand remained at the same low level throughout the rotation -- this technique is explicitly NOT created by lifting the hand away from the base.",
    compiledAt: "2026-09-15T00:00:00.000Z",
  },
  {
    atomicActionId: "atomicaction-45-degree-interior-cut",
    vertical: INTERIOR_45_VERTICAL,
    order: 5,
    actionKind: "EXECUTE",
    sourceExecutionUnitId: FRONT_FIRST_SIDE_EU_ID,
    sourceSkillId: INTERIOR_45_SKILL.skillId,
    sourceSkillVersion: INTERIOR_45_SKILL.version,
    requiresActionIds: ["atomicaction-45-degree-interior-hand-height-invariant-check"],
    boundParameterNames: ["cutStartCorner", "cutDirection", "terminalCuttingLineAngle"],
    stateTransition: { fact: "strandCutState", fromValue: "uncut", toValue: "cut_upper_exterior_to_lower_reference" },
    presentationSummary: "Cut from the upper/exterior corner downward toward the lower reference line, producing an approximately 45deg cutting line.",
    compiledAt: "2026-09-15T00:00:00.000Z",
  },
  {
    atomicActionId: "atomicaction-45-degree-interior-verify-length-relationship",
    vertical: INTERIOR_45_VERTICAL,
    order: 6,
    actionKind: "VERIFY",
    sourceExecutionUnitId: FRONT_FIRST_SIDE_EU_ID,
    sourceSkillId: INTERIOR_45_SKILL.skillId,
    sourceSkillVersion: INTERIOR_45_SKILL.version,
    requiresActionIds: ["atomicaction-45-degree-interior-cut"],
    observationCriterion: { fact: "terminalLengthRelationship", expectedValue: "exterior_shorter_than_interior", evidenceStatus: "DETERMINISTIC_STATE_CHECK" },
    presentationSummary: "Confirm the resulting section shows exterior terminal hair shorter than interior terminal hair.",
    compiledAt: "2026-09-15T00:00:00.000Z",
  },
];

// ---------------------------------------------------------------------
// Guide/reference semantics -- see file header for the full reasoning.
// Deliberately UNKNOWN-heavy; only currentSectionRelationship is set,
// directly grounded in Ionuț's own "toward the lower reference/guide
// line" wording.
// ---------------------------------------------------------------------

export const INTERIOR_45_GUIDE_CAPABILITY: GuideRelationshipCapability = buildGuideRelationshipCapability({
  currentSectionRelationship: "CUT_RELATIVE_TO_GUIDE",
  unknownNumericFields: ["exactSectionWidthCm", "exactCuttingLineAngleDegrees", "exactCompletionThresholdPerRegion"],
  note: "Ionuț's own description establishes only that the cut is made relative to a lower reference/guide line -- not what that reference structurally is (guideSource), not whether it is a fixed or moving authority (guideBehavior/progression), and not whether the concrete reference checked changes per section (referenceProgression). All four stay UNKNOWN rather than inventing a travelling/stationary/previous-strand/perimeter-guide classification not explicit in the supplied definition.",
});

// ---------------------------------------------------------------------
// Effect summary -- deliberately NOT a HairStateDelta (no real, persisted
// HairStateSnapshot rows exist for this proposal; computeHairStateDelta
// requires two real snapshot ids/versions, and this stage performs zero
// database writes). This is a plain, explicitly-labeled, report-facing
// structure only -- never imported by hair-state-delta.ts, never treated
// as if it were a real HairStateDeltaEntry. See this stage's own report,
// "state delta" section, for the audited finding that HairState*
// vocabulary (hair-state-snapshot-validators.ts) has NO field
// representing terminal curvature direction -- HairTexture
// (straight/wavy/curly/coily) is a natural hair-type property, and
// perimeterRelationship is a single zone-vs-guide-length category, never
// a within-strand corner-to-corner comparison. This is a genuine,
// reported architecture gap, not patched in this stage.
// ---------------------------------------------------------------------

export interface InteriorFortyFiveEffectSummary {
  readonly preservedFacts: readonly string[];
  readonly changedFacts: readonly string[];
  readonly targetRelationship: string;
  readonly addedEffect: string;
  readonly missingArchitectureVocabulary: readonly string[];
}

export const INTERIOR_45_EFFECT_SUMMARY: InteriorFortyFiveEffectSummary = {
  preservedFacts: [
    "Overall One-Length structure and main perimeter identity (the completed base haircut is not reconstructed by this technique).",
    "Completed-base-haircut status (this technique never resumes One-Length's own construction procedure).",
  ],
  changedFacts: ["Terminal internal/external (interior/exterior corner) length relationship on each worked section, from a single blunt terminal length to exterior-shorter-than-interior."],
  targetRelationship: "exterior_shorter_than_interior",
  addedEffect: "Inward-turning terminal geometry (terminations curve inward) -- an EFFECT, never itself represented as a cutting instruction on INTERIOR_45_SKILL's own procedure/parameters/Execution Units.",
  missingArchitectureVocabulary: [
    "No HairState* field (hair-state-snapshot-validators.ts) represents terminal curvature direction -- HairTexture is a natural hair-type property (straight/wavy/curly/coily), not a cut-induced effect field.",
    "perimeterRelationship (HAIR_STATE_PERIMETER_RELATIONSHIPS) is a single categorical zone-vs-guide-length value -- it cannot represent a within-strand, corner-to-corner length relationship.",
  ],
};
