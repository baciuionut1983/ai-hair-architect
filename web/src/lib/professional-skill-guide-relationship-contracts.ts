import { createHash } from "crypto";

import type { AtomicActionStateTransition } from "@/lib/professional-skill-atomic-action-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.3 -- GUIDE
// RELATIONSHIP CAPABILITY MODEL. Pure, no I/O, no database, ZERO AI
// calls, ZERO registry writes.
//
// WHY THIS FILE EXISTS: the pre-implementation audit (this stage's own
// report) found that guide semantics today live ONLY as ad-hoc,
// per-skill `SkillParameterDefinition` entries (`guideType`,
// `guideReferenceMode`, `guideIdentifiabilityCriterion`) -- three
// separately-typed, non-shared string enums declared independently in
// cutting-skill-continue-central-nape-construction.ts,
// cutting-skill-graduated.ts, and cutting-skill-one-length-perimeter.ts.
// No cross-skill, reusable guide-relationship TYPE exists anywhere in
// the Skill Engine. This is exactly why Stage 8.5L5.R3.2 could not
// deterministically attach review items #2/#4/#9/#10 to one skill: its
// classifier could only compare via the coarse `ESTABLISH_GUIDE`/
// `CONNECT_ZONES` SkillCapabilityKind tags, which 3 registry skills
// equally declare.
//
// STRUCTURAL PRECEDENT REUSED (never duplicated): this file's own
// sourceEntity/targetEntity/relationshipType/role shape deliberately
// mirrors professional-learning-reference-dependency.ts's own proven
// ReferenceEntityRef/ReferenceDependencyRelationship pattern -- but that
// file is explicitly scoped to VIDEO-EXTRACTION-TIME evidence entities
// (OBSERVATION/ACTION/FIELD_CLAIM/PROFESSIONAL_STATEMENT ids) and has
// zero coupling to the Skill Engine. This file is the SKILL-AUTHORING-
// TIME sibling -- same proven shape, its own entity-kind vocabulary
// (SECTION/GUIDE ids), never importing or mutating the video-extraction
// file.
//
// SEPARATE DIMENSIONS, NEVER COLLAPSED (the task's own absolute rule):
// GuideSource (WHAT the guide physically is), GuideRole (STRUCTURAL_
// AUTHORITY vs CONTINUATION_GUIDE), GuideBehavior (stationary/
// travelling), the current-section relationship, the overdirection
// relationship, and progression are SIX independent fields on
// GuideRelationshipCapability -- none is ever derived from another.
// GRADUATED_CUTTING's own existing `guideType` parameter conflates
// source and behavior into one enum (["visual_perimeter","traveling"]);
// this model deliberately does NOT repeat that conflation.

// ---------------------------------------------------------------------
// A. Guide source -- WHAT physical/structural reference is used.
//
// Deliberately ONE value for "the previously cut strand/section" rather
// than two: an early draft of this file kept PREVIOUSLY_CUT_STRAND and
// PREVIOUSLY_CUT_SECTION as separate values (the task's own Section 6
// lists both as candidate words) and discovered, via the real replay
// acceptance test, that this creates an ACCIDENTAL mismatch -- review
// item #2 uses Ionuț's own word "strand," while the existing Graduated
// Cutting skill's `guideReferenceMode: "previous_subsection"` uses
// "section/subsection," for what is the same real physical referent (the
// immediately preceding cut). Keeping them as two literal enum values
// would silently defeat this model's own goal (comparable, unambiguous
// representation) rather than serve it. "Strand" and "section" name the
// same source here; a genuinely different distinction (e.g. one strand
// within an already-established section vs. the whole prior section)
// would need its own, separately-justified value if real evidence ever
// required it -- never invented preemptively.
// ---------------------------------------------------------------------

export const GUIDE_SOURCES = ["INITIAL_GUIDE", "PREVIOUSLY_CUT_SECTION", "PERIMETER_CONTOUR_GUIDE", "EXTERNAL_REFERENCE_LINE", "UNKNOWN"] as const;
export type GuideSource = (typeof GUIDE_SOURCES)[number];

export function isGuideSource(value: unknown): value is GuideSource {
  return typeof value === "string" && (GUIDE_SOURCES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------
// Guide role -- STRUCTURAL AUTHORITY (the contour/final-length/perimeter
// that defines intended structure) vs CONTINUATION GUIDE (a previously
// produced entity used only to continue that structure). Mirrors
// professional-learning-reference-dependency.ts's own REFERENCE_ROLE_
// KINDS distinction conceptually -- not imported, since that file's own
// type is scoped to extraction-time entities, not skills.
// ---------------------------------------------------------------------

export const GUIDE_ROLES = ["STRUCTURAL_AUTHORITY", "CONTINUATION_GUIDE", "UNKNOWN"] as const;
export type GuideRole = (typeof GUIDE_ROLES)[number];

export function isGuideRole(value: unknown): value is GuideRole {
  return typeof value === "string" && (GUIDE_ROLES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------
// B. Guide behavior -- DOES the guide move/progress. Independent of
// source: "previously cut strand" alone never implies TRAVELLING (a
// previously cut strand could, in principle, be referenced once and then
// a separate stationary guide used from then on) -- behavior must be
// separately established, never inferred from source alone.
// ---------------------------------------------------------------------

export const GUIDE_BEHAVIORS = ["STATIONARY", "TRAVELLING", "UNKNOWN"] as const;
export type GuideBehavior = (typeof GUIDE_BEHAVIORS)[number];

export function isGuideBehavior(value: unknown): value is GuideBehavior {
  return typeof value === "string" && (GUIDE_BEHAVIORS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------
// C. Current-section-to-guide relationship.
// ---------------------------------------------------------------------

export const GUIDE_SECTION_RELATIONSHIPS = ["REFERENCES_GUIDE", "CUT_RELATIVE_TO_GUIDE", "BECOMES_NEXT_GUIDE", "ALIGNED_TO_GUIDE", "RELATIONSHIP_UNKNOWN"] as const;
export type GuideSectionRelationship = (typeof GUIDE_SECTION_RELATIONSHIPS)[number];

export function isGuideSectionRelationship(value: unknown): value is GuideSectionRelationship {
  return typeof value === "string" && (GUIDE_SECTION_RELATIONSHIPS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------
// D. Overdirection relationship -- a RELATIONSHIP, never a numeric
// angle. Section "5/38" of this lineage's own absolute rule: exact
// degrees stay UNKNOWN unless independently established.
// ---------------------------------------------------------------------

export const OVERDIRECTION_RELATIONSHIPS = ["TOWARD_GUIDE", "AWAY_FROM_GUIDE", "NONE_OBSERVED", "UNKNOWN"] as const;
export type OverdirectionRelationship = (typeof OVERDIRECTION_RELATIONSHIPS)[number];

export function isOverdirectionRelationship(value: unknown): value is OverdirectionRelationship {
  return typeof value === "string" && (OVERDIRECTION_RELATIONSHIPS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------
// E. Progression -- does the ACTIVE guide change from one execution
// unit to the next. Independent of elevation progression (Section
// "MOBILE GUIDE": "GUIDE PROGRESSION and ELEVATION PROGRESSION must
// remain separate dimensions").
// ---------------------------------------------------------------------

export const GUIDE_PROGRESSION_STATES = ["FIXED_THROUGHOUT", "PROGRESSES_EACH_UNIT", "UNKNOWN"] as const;
export type GuideProgressionState = (typeof GUIDE_PROGRESSION_STATES)[number];

export function isGuideProgressionState(value: unknown): value is GuideProgressionState {
  return typeof value === "string" && (GUIDE_PROGRESSION_STATES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------
// The capability itself. Sectioning/elevation/distribution/cutting-line/
// zone (dimensions F/G/H/I/J) are DELIBERATELY ABSENT from this type --
// they already have their own established representations elsewhere
// (SkillParameterDefinition entries, ProfessionalLearningExtraction
// fields) and this stage's own scope is the guide relationship only;
// duplicating them here would risk exactly the "collapse into one
// opaque model" the task explicitly forbids. A caller composes this
// capability ALONGSIDE those other dimensions, never instead of them.
// ---------------------------------------------------------------------

export interface GuideRelationshipCapability {
  readonly id: string;
  readonly guideSource: GuideSource;
  readonly guideRole: GuideRole;
  readonly guideBehavior: GuideBehavior;
  readonly currentSectionRelationship: GuideSectionRelationship;
  readonly overdirectionRelationship: OverdirectionRelationship;
  readonly progression: GuideProgressionState;
  // Explicit, never-defaulted list of numeric/geometric facts that
  // remain UNKNOWN (Section "UNKNOWN / PARTIAL KNOWLEDGE") -- e.g.
  // "exactOverdirectionAngle", "exactSectionAngle". Never populated with
  // an actual number.
  readonly unknownNumericFields: readonly string[];
  readonly note?: string;
}

export function computeGuideRelationshipCapabilityId(input: Omit<GuideRelationshipCapability, "id" | "note">): string {
  const canonical = [input.guideSource, input.guideRole, input.guideBehavior, input.currentSectionRelationship, input.overdirectionRelationship, input.progression, [...input.unknownNumericFields].sort().join(",")].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface BuildGuideRelationshipCapabilityInput {
  readonly guideSource?: GuideSource;
  readonly guideRole?: GuideRole;
  readonly guideBehavior?: GuideBehavior;
  readonly currentSectionRelationship?: GuideSectionRelationship;
  readonly overdirectionRelationship?: OverdirectionRelationship;
  readonly progression?: GuideProgressionState;
  readonly unknownNumericFields?: readonly string[];
  readonly note?: string;
}

// UNKNOWN is first-class (Section "UNKNOWN / PARTIAL KNOWLEDGE"): every
// dimension defaults to its own explicit UNKNOWN/RELATIONSHIP_UNKNOWN
// value when the caller does not supply it -- never a silently invented
// concrete value.
export function buildGuideRelationshipCapability(input: BuildGuideRelationshipCapabilityInput = {}): GuideRelationshipCapability {
  const withoutId: Omit<GuideRelationshipCapability, "id" | "note"> = {
    guideSource: input.guideSource ?? "UNKNOWN",
    guideRole: input.guideRole ?? "UNKNOWN",
    guideBehavior: input.guideBehavior ?? "UNKNOWN",
    currentSectionRelationship: input.currentSectionRelationship ?? "RELATIONSHIP_UNKNOWN",
    overdirectionRelationship: input.overdirectionRelationship ?? "UNKNOWN",
    progression: input.progression ?? "UNKNOWN",
    unknownNumericFields: input.unknownNumericFields ?? [],
  };
  return { ...withoutId, id: computeGuideRelationshipCapabilityId(withoutId), ...(input.note !== undefined ? { note: input.note } : {}) };
}

// ---------------------------------------------------------------------
// Guide state transition (Section "GUIDE STATE TRANSITION"). Explored
// and IMPLEMENTED, reusing the EXISTING AtomicActionStateTransition
// shape verbatim (professional-skill-atomic-action-contracts.ts) rather
// than inventing a new one -- see this stage's own report for why: that
// type already flows into ExecutionScene.stateTransitions
// (professional-execution-scene-contracts.ts), so anything produced
// here is already future-compatible with zero additional glue. Only a
// TRAVELLING guide produces a real transition (the active guide
// genuinely changes); a STATIONARY guide returns null -- nothing
// transitioned, never a same-value no-op transition record.
// ---------------------------------------------------------------------

export function deriveGuideStateTransition(behavior: GuideBehavior, fromSectionId: string, toSectionId: string): AtomicActionStateTransition | null {
  if (behavior !== "TRAVELLING") return null;
  return { fact: "activeGuide", fromValue: fromSectionId, toValue: toSectionId };
}
