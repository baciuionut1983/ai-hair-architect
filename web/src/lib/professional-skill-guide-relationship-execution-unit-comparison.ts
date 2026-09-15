import type { GuideBehavior, GuideRelationshipCapability, GuideRole, GuideSource, ReferenceProgressionState } from "@/lib/professional-skill-guide-relationship-contracts";

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
  readonly referenceProgression?: ReferenceProgressionState;
}

// From cutting-skill-graduated.ts / -continue-central-nape-construction.ts
// / -one-length-perimeter.ts's own real `guideReferenceMode` values.
//
// Stage 8.5L5.R3.4.R1 CORRECTION (see professional-skill-guide-
// relationship-l5r3-4-r1-correction.ts for the full record): the
// `previous_subsection` entry below previously mapped to
// `behavior: "TRAVELLING"` UNCONDITIONALLY -- correct for Graduated
// Cutting (where it never actually took effect anyway, since Graduated
// Cutting's own `guideType: "traveling"` already overrides behavior in
// legacySemanticsForUnit below), but WRONG for One-Length Perimeter and
// Continue Central Nape Construction, whose own "previous_subsection"
// reference mode means the opposite: the geometric authority is the SAME
// established line/perimeter throughout -- only the CONCRETE PIECE OF
// ALREADY-CUT HAIR a stylist looks at as a practical, visible reference
// changes from section to section (see the new `referenceProgression`
// dimension, Section F of the contracts file). Ionuț's own words: "Șuviță
// tăiată anterior, logic, devine aceeași linie cu ultimele straturi
// tăiate și devine ghid interpretabil pentru următoarea care se taie la
// aceeași linie neschimbată." ("The previously cut strand, logically,
// becomes the same line as the last cut layers, and becomes an
// interpretable guide for the next one, which is cut to that same
// unchanged line.") `previous_subsection`'s own DEFAULT/general meaning
// is therefore corrected to STATIONARY authority + a progressing
// reference pointer -- Graduated Cutting's genuinely different,
// authority-travels case remains exactly as correct as before, because
// it is asserted independently via `guideType`, never via this entry.
const LEGACY_REFERENCE_MODE_TO_GUIDE_SEMANTICS: Readonly<Record<string, LegacyGuideSemantics>> = {
  contour_guide_reference: { source: "PERIMETER_CONTOUR_GUIDE", role: "STRUCTURAL_AUTHORITY", behavior: "STATIONARY", referenceProgression: "REFERENCE_FIXED" },
  established_perimeter_guide: { source: "PERIMETER_CONTOUR_GUIDE", role: "STRUCTURAL_AUTHORITY", behavior: "STATIONARY", referenceProgression: "REFERENCE_FIXED" },
  previous_subsection: { source: "PREVIOUSLY_CUT_SECTION", role: "CONTINUATION_GUIDE", behavior: "STATIONARY", referenceProgression: "REFERENCE_PROGRESSES_WITH_EXECUTION" },
  // Lateral connection references the already-cut (and by then fixed)
  // posterior guide behind the ear -- structurally a continuation use of
  // a guide that is itself no longer moving at the point of reference,
  // and always the SAME single reference (never progresses further).
  lateral_connection_guide: { source: "PERIMETER_CONTOUR_GUIDE", role: "CONTINUATION_GUIDE", behavior: "STATIONARY", referenceProgression: "REFERENCE_FIXED" },
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
  // `guideType` (Graduated Cutting only) is the more specific signal for
  // BEHAVIOR and wins when present, exactly as before R1. There is no
  // separate guideType->referenceProgression table: `referenceProgression`
  // always comes from `guideReferenceMode` alone -- every Graduated
  // Cutting execution unit already declares its own guideReferenceMode
  // alongside guideType (audited verbatim), so this is never a gap.
  return { source: fromReferenceMode?.source, role: fromReferenceMode?.role, behavior: behaviorFromGuideType ?? fromReferenceMode?.behavior, referenceProgression: fromReferenceMode?.referenceProgression };
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
  readonly matchedDimensions: readonly ("source" | "role" | "behavior" | "referenceProgression")[];
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
    const referenceProgressionOk = fieldCompatible(capability.referenceProgression, legacy.referenceProgression, "UNKNOWN");

    if (sourceOk && roleOk && behaviorOk && referenceProgressionOk) {
      const matchedDimensions: ("source" | "role" | "behavior" | "referenceProgression")[] = [];
      if (capability.guideSource !== "UNKNOWN" && legacy.source === capability.guideSource) matchedDimensions.push("source");
      if (capability.guideRole !== "UNKNOWN" && legacy.role === capability.guideRole) matchedDimensions.push("role");
      if (capability.guideBehavior !== "UNKNOWN" && legacy.behavior === capability.guideBehavior) matchedDimensions.push("behavior");
      if (capability.referenceProgression !== "UNKNOWN" && legacy.referenceProgression === capability.referenceProgression) matchedDimensions.push("referenceProgression");
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
