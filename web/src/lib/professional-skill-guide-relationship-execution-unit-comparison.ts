import type { GuideBehavior, GuideRelationshipCapability, GuideRole, GuideSource } from "@/lib/professional-skill-guide-relationship-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.3 --
// GUIDE RELATIONSHIP <-> EXISTING EXECUTION UNIT COMPARISON. Pure, no
// I/O, no database, ZERO AI calls, ZERO registry/skill writes.
//
// Answers a DIFFERENT question than professional-knowledge-registry-
// comparison.ts's own skill-level capability matching: not "which
// SKILL shares this capability tag" (too coarse -- 3 skills share
// ESTABLISH_GUIDE/CONNECT_ZONES) but "which EXECUTION UNIT already
// declares fixed guide parameters matching this capability's own
// source/role/behavior." This is the finer-grained comparison the
// pre-implementation audit found was structurally impossible before this
// stage (guideType/guideReferenceMode values were never cross-skill
// comparable -- three skills spell overlapping concepts with different
// literal strings).
//
// ONE small, explicit, declarative bridge table -- never a lexical/NLP
// classifier -- maps the EXISTING skills' own real string values
// (audited verbatim from cutting-skill-graduated.ts/-continue-central-
// nape-construction.ts/-one-length-perimeter.ts) to this stage's new
// GuideSource/GuideRole/GuideBehavior vocabulary. This is comparison-
// only: it never writes a fixedValue back, never mutates a skill/
// execution unit, and a missing/absent mapping is never guessed.

interface LegacyGuideSemantics {
  readonly source?: GuideSource;
  readonly role?: GuideRole;
  readonly behavior?: GuideBehavior;
}

// From cutting-skill-graduated.ts / -continue-central-nape-construction.ts
// / -one-length-perimeter.ts's own real `guideReferenceMode` values.
const LEGACY_REFERENCE_MODE_TO_GUIDE_SEMANTICS: Readonly<Record<string, LegacyGuideSemantics>> = {
  contour_guide_reference: { source: "PERIMETER_CONTOUR_GUIDE", role: "STRUCTURAL_AUTHORITY", behavior: "STATIONARY" },
  established_perimeter_guide: { source: "PERIMETER_CONTOUR_GUIDE", role: "STRUCTURAL_AUTHORITY", behavior: "STATIONARY" },
  previous_subsection: { source: "PREVIOUSLY_CUT_SECTION", role: "CONTINUATION_GUIDE", behavior: "TRAVELLING" },
  // Lateral connection references the already-cut (and by then fixed)
  // posterior guide behind the ear -- structurally a continuation use of
  // a guide that is itself no longer moving at the point of reference.
  lateral_connection_guide: { source: "PERIMETER_CONTOUR_GUIDE", role: "CONTINUATION_GUIDE", behavior: "STATIONARY" },
};

// From cutting-skill-graduated.ts's own real `guideType` values only --
// no other skill declares this parameter name.
const LEGACY_GUIDE_TYPE_TO_BEHAVIOR: Readonly<Record<string, GuideBehavior>> = {
  visual_perimeter: "STATIONARY",
  traveling: "TRAVELLING",
};

export interface ComparableExecutionUnit {
  readonly executionUnitId: string;
  readonly skillId: string;
  readonly parameterRules?: readonly { readonly parameterName: string; readonly semantic: string; readonly fixedValue?: string | boolean | number }[];
}

function fixedValueFor(unit: ComparableExecutionUnit, parameterName: string): string | boolean | number | null {
  const rule = (unit.parameterRules ?? []).find((r) => r.parameterName === parameterName && r.semantic === "REQUIRED_FIXED");
  return rule?.fixedValue ?? null;
}

function legacySemanticsForUnit(unit: ComparableExecutionUnit): LegacyGuideSemantics {
  const referenceMode = fixedValueFor(unit, "guideReferenceMode");
  const guideType = fixedValueFor(unit, "guideType");
  const fromReferenceMode = typeof referenceMode === "string" ? LEGACY_REFERENCE_MODE_TO_GUIDE_SEMANTICS[referenceMode] : undefined;
  const behaviorFromGuideType = typeof guideType === "string" ? LEGACY_GUIDE_TYPE_TO_BEHAVIOR[guideType] : undefined;
  return { source: fromReferenceMode?.source, role: fromReferenceMode?.role, behavior: behaviorFromGuideType ?? fromReferenceMode?.behavior };
}

// A capability field of UNKNOWN is treated as "no claim" -- it can never
// cause a mismatch, but it also can never itself count as a positive
// match (Section "UNKNOWN must remain first-class" -- never silently
// resolved by omission).
function fieldCompatible<T extends string>(capabilityValue: T, unitValue: T | undefined, unknownValue: T): boolean {
  if (capabilityValue === unknownValue) return true;
  if (unitValue === undefined) return false;
  return capabilityValue === unitValue;
}

export interface GuideRelationshipExecutionUnitMatch {
  readonly executionUnitId: string;
  readonly skillId: string;
  readonly matchedDimensions: readonly ("source" | "role" | "behavior")[];
}

export interface CompareGuideRelationshipResult {
  // Registry/execution-unit ATTACHMENT-SAFETY question only -- entirely
  // separate from whether the capability itself is semantically
  // well-formed (see professional-skill-guide-relationship-contracts.ts:
  // a capability is unambiguous by construction, independent of whether
  // any existing execution unit happens to already represent it).
  readonly hasCompatibleExecutionUnit: boolean;
  readonly matches: readonly GuideRelationshipExecutionUnitMatch[];
  readonly reason: string;
}

export function compareGuideRelationshipAgainstExecutionUnits(capability: GuideRelationshipCapability, units: readonly ComparableExecutionUnit[]): CompareGuideRelationshipResult {
  const matches: GuideRelationshipExecutionUnitMatch[] = [];

  for (const unit of units) {
    const legacy = legacySemanticsForUnit(unit);
    const sourceOk = fieldCompatible(capability.guideSource, legacy.source, "UNKNOWN");
    const roleOk = fieldCompatible(capability.guideRole, legacy.role, "UNKNOWN");
    const behaviorOk = fieldCompatible(capability.guideBehavior, legacy.behavior, "UNKNOWN");

    if (sourceOk && roleOk && behaviorOk) {
      const matchedDimensions: ("source" | "role" | "behavior")[] = [];
      if (capability.guideSource !== "UNKNOWN" && legacy.source === capability.guideSource) matchedDimensions.push("source");
      if (capability.guideRole !== "UNKNOWN" && legacy.role === capability.guideRole) matchedDimensions.push("role");
      if (capability.guideBehavior !== "UNKNOWN" && legacy.behavior === capability.guideBehavior) matchedDimensions.push("behavior");
      // Only count as a real match when at least one dimension was
      // positively confirmed -- a capability that is UNKNOWN on every
      // dimension trivially "matches" everything, which is never useful
      // evidence.
      if (matchedDimensions.length > 0) matches.push({ executionUnitId: unit.executionUnitId, skillId: unit.skillId, matchedDimensions });
    }
  }

  if (matches.length === 0) {
    return { hasCompatibleExecutionUnit: false, matches: [], reason: "No existing execution unit's own fixed guide parameters are compatible with this capability -- no current Skill Engine representation exists for it yet." };
  }

  return { hasCompatibleExecutionUnit: true, matches, reason: `Compatible with ${matches.length} existing execution unit(s)' own fixed guide parameters.` };
}
