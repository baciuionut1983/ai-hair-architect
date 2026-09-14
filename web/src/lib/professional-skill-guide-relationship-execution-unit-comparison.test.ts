import { describe, expect, it } from "vitest";

import { compareGuideRelationshipAgainstExecutionUnits, type ComparableExecutionUnit } from "@/lib/professional-skill-guide-relationship-execution-unit-comparison";
import { buildGuideRelationshipCapability } from "@/lib/professional-skill-guide-relationship-contracts";
import { GRADUATED_CUTTING_EXECUTION_UNITS, GRADUATED_CUTTING_SKILL } from "@/lib/cutting-skill-graduated";
import { ONE_LENGTH_PERIMETER_EXECUTION_UNITS, ONE_LENGTH_PERIMETER_SKILL } from "@/lib/cutting-skill-one-length-perimeter";
import { CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS, CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL } from "@/lib/cutting-skill-continue-central-nape-construction";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.3 -- tests
// comparing the new guide-relationship model against the REAL, already-
// authored execution units of Graduated Cutting / One-Length Perimeter /
// Continue Central Nape Construction. No I/O, no database, no AI calls,
// ZERO mutation of any skill/execution unit (all comparisons are
// read-only against the real, imported, unmodified constants).

function toComparable(units: readonly { executionUnitId: string; parameterRules?: readonly { parameterName: string; semantic: string; fixedValue?: string | boolean | number }[] }[], skillId: string): ComparableExecutionUnit[] {
  return units.map((u) => ({ executionUnitId: u.executionUnitId, skillId, parameterRules: u.parameterRules }));
}

const ALL_REAL_UNITS: readonly ComparableExecutionUnit[] = [
  ...toComparable(GRADUATED_CUTTING_EXECUTION_UNITS, GRADUATED_CUTTING_SKILL.skillId),
  ...toComparable(ONE_LENGTH_PERIMETER_EXECUTION_UNITS, ONE_LENGTH_PERIMETER_SKILL.skillId),
  ...toComparable(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS, CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.skillId),
];

describe("professional-skill-guide-relationship-execution-unit-comparison (real Graduated Cutting / One-Length / Continue-Central-Nape execution units)", () => {
  it("Section 6 (report): CONTOUR guide and PROGRESSIVE GRADUATION guide are distinguishable against Graduated Cutting's OWN real execution units -- never merged", () => {
    const contourCapability = buildGuideRelationshipCapability({ guideSource: "PERIMETER_CONTOUR_GUIDE", guideRole: "STRUCTURAL_AUTHORITY", guideBehavior: "STATIONARY" });
    const graduationCapability = buildGuideRelationshipCapability({ guideSource: "PREVIOUSLY_CUT_SECTION", guideRole: "CONTINUATION_GUIDE", guideBehavior: "TRAVELLING" });

    const contourResult = compareGuideRelationshipAgainstExecutionUnits(contourCapability, ALL_REAL_UNITS);
    const graduationResult = compareGuideRelationshipAgainstExecutionUnits(graduationCapability, ALL_REAL_UNITS);

    expect(contourResult.hasCompatibleExecutionUnit).toBe(true);
    expect(contourResult.matches.map((m) => m.executionUnitId)).toContain("executionunit-cutting-graduated-perimeter-guide");
    expect(graduationResult.hasCompatibleExecutionUnit).toBe(true);
    expect(graduationResult.matches.map((m) => m.executionUnitId)).toContain("executionunit-cutting-graduated-execution-zone");

    // Never merged: the contour match never includes the graduation unit and vice versa.
    expect(contourResult.matches.map((m) => m.executionUnitId)).not.toContain("executionunit-cutting-graduated-execution-zone");
    expect(graduationResult.matches.map((m) => m.executionUnitId)).not.toContain("executionunit-cutting-graduated-perimeter-guide");
  });

  it("a fully UNKNOWN capability never reports a compatible execution unit -- UNKNOWN is never trivially 'compatible with everything'", () => {
    const emptyCapability = buildGuideRelationshipCapability();
    const result = compareGuideRelationshipAgainstExecutionUnits(emptyCapability, ALL_REAL_UNITS);
    expect(result.hasCompatibleExecutionUnit).toBe(false);
    expect(result.matches).toEqual([]);
  });

  it("comparison never mutates the real execution unit constants (zero side effects, proven against the actual imported objects)", () => {
    const snapshot = JSON.stringify(ALL_REAL_UNITS);
    compareGuideRelationshipAgainstExecutionUnits(buildGuideRelationshipCapability({ guideBehavior: "TRAVELLING" }), ALL_REAL_UNITS);
    expect(JSON.stringify(ALL_REAL_UNITS)).toBe(snapshot);
  });

  it("a STATIONARY, PREVIOUSLY_CUT_SECTION-sourced guide with no matching real execution unit honestly reports zero matches (no forced attachment)", () => {
    // No real execution unit anywhere declares a stationary guide whose
    // SOURCE is a previously-cut section (only contour/perimeter guides
    // are stationary in the real registry today) -- confirms the honest
    // "gap" finding from this stage's own report (review item #4 has no
    // current execution unit representation).
    const capability = buildGuideRelationshipCapability({ guideSource: "PREVIOUSLY_CUT_SECTION", guideBehavior: "STATIONARY" });
    const result = compareGuideRelationshipAgainstExecutionUnits(capability, ALL_REAL_UNITS);
    expect(result.hasCompatibleExecutionUnit).toBe(false);
  });
});
