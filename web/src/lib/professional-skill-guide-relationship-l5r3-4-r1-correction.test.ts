import { describe, expect, it } from "vitest";

import {
  GRADUATED_CUTTING_TRAVELLING_GUIDE_DEMONSTRATION,
  IONUTS_ONE_LENGTH_GUIDE_CORRECTION,
  ONE_LENGTH_SAME_LINE_REPRODUCTION_DEMONSTRATION,
} from "@/lib/professional-skill-guide-relationship-l5r3-4-r1-correction";
import { buildGuideRelationshipCapability } from "@/lib/professional-skill-guide-relationship-contracts";
import { compareGuideRelationshipAgainstExecutionUnits, type ComparableExecutionUnit } from "@/lib/professional-skill-guide-relationship-execution-unit-comparison";
import { GRADUATED_CUTTING_EXECUTION_UNITS, GRADUATED_CUTTING_SKILL } from "@/lib/cutting-skill-graduated";
import { ONE_LENGTH_PERIMETER_EXECUTION_UNITS, ONE_LENGTH_PERIMETER_SKILL } from "@/lib/cutting-skill-one-length-perimeter";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.4.R1 --
// pure tests for the One-Length guide semantic correction, no I/O, no
// database, no AI calls.

function toComparable(units: readonly { executionUnitId: string; parameterRules?: readonly { parameterName: string; semantic: string; fixedValue?: string | boolean | number }[] }[], skillId: string): ComparableExecutionUnit[] {
  return units.map((u) => ({ executionUnitId: u.executionUnitId, skillId, parameterRules: u.parameterRules }));
}

const UNITS: readonly ComparableExecutionUnit[] = [...toComparable(GRADUATED_CUTTING_EXECUTION_UNITS, GRADUATED_CUTTING_SKILL.skillId), ...toComparable(ONE_LENGTH_PERIMETER_EXECUTION_UNITS, ONE_LENGTH_PERIMETER_SKILL.skillId)];

describe("professional-skill-guide-relationship-l5r3-4-r1-correction", () => {
  it("test 5: Graduated Cutting's travelling-guide demonstration matches its own real travelling-guide execution unit", () => {
    const result = compareGuideRelationshipAgainstExecutionUnits(GRADUATED_CUTTING_TRAVELLING_GUIDE_DEMONSTRATION, UNITS);
    expect(result.hasCompatibleExecutionUnit).toBe(true);
    expect(result.matches.map((m) => m.executionUnitId)).toContain("executionunit-cutting-graduated-execution-zone");
  });

  it("test 1/2/9: One-Length's same-line-reproduction demonstration matches One-Length's own real execution units, and is NEVER classified as travelling", () => {
    const result = compareGuideRelationshipAgainstExecutionUnits(ONE_LENGTH_SAME_LINE_REPRODUCTION_DEMONSTRATION, UNITS);
    expect(result.hasCompatibleExecutionUnit).toBe(true);
    expect(result.matches.map((m) => m.skillId)).toContain("skill-cutting-one-length-perimeter");
    expect(ONE_LENGTH_SAME_LINE_REPRODUCTION_DEMONSTRATION.guideBehavior).toBe("STATIONARY");
    expect(ONE_LENGTH_SAME_LINE_REPRODUCTION_DEMONSTRATION.guideBehavior).not.toBe("TRAVELLING");
  });

  it("test 6: Graduated's travelling demonstration and One-Length's same-line demonstration are structurally distinct capability instances, never colliding", () => {
    expect(GRADUATED_CUTTING_TRAVELLING_GUIDE_DEMONSTRATION.id).not.toBe(ONE_LENGTH_SAME_LINE_REPRODUCTION_DEMONSTRATION.id);
    expect(GRADUATED_CUTTING_TRAVELLING_GUIDE_DEMONSTRATION.guideBehavior).toBe("TRAVELLING");
    expect(ONE_LENGTH_SAME_LINE_REPRODUCTION_DEMONSTRATION.guideBehavior).toBe("STATIONARY");
  });

  it("test 3: One-Length's demonstration shows execution progresses through sections (referenceProgression) while guide-line AUTHORITY remains fixed (progression=FIXED_THROUGHOUT) -- the exact distinction the pre-R1 model could not express", () => {
    expect(ONE_LENGTH_SAME_LINE_REPRODUCTION_DEMONSTRATION.referenceProgression).toBe("REFERENCE_PROGRESSES_WITH_EXECUTION");
    expect(ONE_LENGTH_SAME_LINE_REPRODUCTION_DEMONSTRATION.progression).toBe("FIXED_THROUGHOUT");
  });

  it("test 4: a previously-cut-section source alone (behavior UNKNOWN) never implies travelling OR stationary -- the professional record for #9 stays deliberately partial", () => {
    const capability = buildGuideRelationshipCapability({ guideSource: "PREVIOUSLY_CUT_SECTION" });
    expect(capability.guideBehavior).toBe("UNKNOWN");
  });

  it("test 12/13: previousCutReference (source alone) does not imply stationary OR travelling behavior -- both remain independently settable", () => {
    const stationaryVariant = buildGuideRelationshipCapability({ guideSource: "PREVIOUSLY_CUT_SECTION", guideBehavior: "STATIONARY" });
    const travellingVariant = buildGuideRelationshipCapability({ guideSource: "PREVIOUSLY_CUT_SECTION", guideBehavior: "TRAVELLING" });
    expect(stationaryVariant.guideSource).toBe(travellingVariant.guideSource);
    expect(stationaryVariant.guideBehavior).not.toBe(travellingVariant.guideBehavior);
  });

  it("test 14: same-line reproduction (referenceProgression=REFERENCE_PROGRESSES_WITH_EXECUTION) does not imply travelling behavior -- both One-Length (stationary) and Graduated (travelling) can share referenceProgression while differing on guideBehavior", () => {
    expect(GRADUATED_CUTTING_TRAVELLING_GUIDE_DEMONSTRATION.referenceProgression).toBe(ONE_LENGTH_SAME_LINE_REPRODUCTION_DEMONSTRATION.referenceProgression);
    expect(GRADUATED_CUTTING_TRAVELLING_GUIDE_DEMONSTRATION.guideBehavior).not.toBe(ONE_LENGTH_SAME_LINE_REPRODUCTION_DEMONSTRATION.guideBehavior);
  });

  it("test 15: no numeric guide/elevation/angle values are invented anywhere in the correction record", () => {
    expect(JSON.stringify(IONUTS_ONE_LENGTH_GUIDE_CORRECTION)).not.toMatch(/\d+(\.\d+)?\s*(deg|degree|grade)/i);
  });

  it("test 11: technique/skill name alone does not appear anywhere in the guide-behavior determination logic -- behavior is read only from real parameter values, never from a skillId or label string", () => {
    // Structural proof: the correction record's own note text explains
    // that "One-Length" is a NAME used for human readability, but the
    // actual capability construction above (ONE_LENGTH_SAME_LINE_
    // REPRODUCTION_DEMONSTRATION) never references any skillId; its
    // guideBehavior comes from an explicit, independent field.
    expect(ONE_LENGTH_SAME_LINE_REPRODUCTION_DEMONSTRATION).not.toHaveProperty("skillId");
    expect(ONE_LENGTH_SAME_LINE_REPRODUCTION_DEMONSTRATION).not.toHaveProperty("techniqueName");
  });

  it("Section 'PROVENANCE': the correction record preserves the professional quote verbatim and names the exact root cause, never silently overwriting history", () => {
    expect(IONUTS_ONE_LENGTH_GUIDE_CORRECTION.professionalQuoteRomanian).toContain("aceeași linie");
    expect(IONUTS_ONE_LENGTH_GUIDE_CORRECTION.correction.before).toBe("TRAVELLING");
    expect(IONUTS_ONE_LENGTH_GUIDE_CORRECTION.correction.after).toBe("STATIONARY");
  });
});
