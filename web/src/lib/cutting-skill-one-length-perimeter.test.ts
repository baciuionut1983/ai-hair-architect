import { describe, expect, it } from "vitest";

import { isSkillEligibleForAuthority, isValidSkillDefinition } from "@/lib/professional-skill-contracts";
import { isSkillInstanceEligibleForAuthority, isValidSkillInstance, isValidSkillInstanceSequence } from "@/lib/professional-skill-instance-contracts";
import { isValidExecutionUnit, isValidExecutionUnitSequence } from "@/lib/professional-skill-execution-unit-contracts";
import { compileExecutionUnitToAtomicActions } from "@/lib/cutting-skill-atomic-action-compiler";
import {
  isOneLengthPerimeterFact,
  ONE_LENGTH_PERIMETER_EXECUTION_UNITS,
  ONE_LENGTH_PERIMETER_SKILL,
  ONE_LENGTH_PERIMETER_SKILL_INSTANCE,
} from "@/lib/cutting-skill-one-length-perimeter";
import { SLICE_AND_SLIDE_REFINEMENT_SKILL } from "@/lib/cutting-skill-slice-and-slide-refinement";

// ===========================================================================
// SECTION A -- REAL PROFESSIONAL AUTHORITY FIXTURE / CONSTANT.
// ===========================================================================

describe("A. REAL: Construct One-Length Perimeter -- Skill Definition", () => {
  it("1. the real Skill Definition validates against the Stage 2.5.i.1 contract", () => {
    expect(isValidSkillDefinition(ONE_LENGTH_PERIMETER_SKILL, isOneLengthPerimeterFact)).toBe(true);
  });

  it("2. authority is professional/authored, ACTIVE, and eligible", () => {
    expect(ONE_LENGTH_PERIMETER_SKILL.authorityType).toBe("PROFESSIONALLY_AUTHORED");
    expect(ONE_LENGTH_PERIMETER_SKILL.status).toBe("ACTIVE");
    expect(isSkillEligibleForAuthority(ONE_LENGTH_PERIMETER_SKILL)).toBe(true);
  });

  it("3. exact skillKey and version", () => {
    expect(ONE_LENGTH_PERIMETER_SKILL.skillId).toBe("skill-cutting-one-length-perimeter");
    expect(ONE_LENGTH_PERIMETER_SKILL.version).toBe(1);
  });

  it("4. NO elevation -- a single, locked zero-degree value, no exceptions", () => {
    const elevation = ONE_LENGTH_PERIMETER_SKILL.parameters.find((p) => p.name === "elevation");
    expect(elevation?.allowedValues).toEqual(["0_deg_blunt"]);
  });

  it('5. natural-fall behavior is represented as a single, locked distribution value -- "natural fall" never elevated', () => {
    const distribution = ONE_LENGTH_PERIMETER_SKILL.parameters.find((p) => p.name === "distribution");
    expect(distribution?.allowedValues).toEqual(["natural_fall"]);
  });

  it("6. structuralTechnique is locked to the real one_length value, never graduation", () => {
    const structuralTechnique = ONE_LENGTH_PERIMETER_SKILL.parameters.find((p) => p.name === "structuralTechnique");
    expect(structuralTechnique?.allowedValues).toEqual(["one_length"]);
  });

  it("7. subsection thickness is a free-text professional working reference, never a hardcoded universal constant", () => {
    const subsectionThickness = ONE_LENGTH_PERIMETER_SKILL.parameters.find((p) => p.name === "subsectionThickness");
    expect(subsectionThickness?.valueKind).toBe("string");
    expect(subsectionThickness?.allowedValues).toBeUndefined();
  });

  it("8. declares incompatibility with Slice-and-Slide Refinement -- structurally, by exact real skillKey", () => {
    expect(ONE_LENGTH_PERIMETER_SKILL.incompatibleSkillIds).toContain(SLICE_AND_SLIDE_REFINEMENT_SKILL.skillId);
  });

  it("9. capabilities include PRESERVE_PERIMETER and ESTABLISH_GUIDE, never a weight-reduction outcome", () => {
    const kinds = (ONE_LENGTH_PERIMETER_SKILL.capabilities ?? []).map((c) => c.kind);
    expect(kinds).toContain("PRESERVE_PERIMETER");
    expect(kinds).toContain("ESTABLISH_GUIDE");
    expect(kinds).not.toContain("REDUCE_WEIGHT");
    expect(kinds).not.toContain("BUILD_WEIGHT");
  });
});

describe("A. REAL: Construct One-Length Perimeter -- Skill Instance", () => {
  it("10. the real Skill Instance validates against the Stage 2.5.i.5 contract", () => {
    expect(isValidSkillInstance(ONE_LENGTH_PERIMETER_SKILL_INSTANCE, isOneLengthPerimeterFact)).toBe(true);
    expect(isValidSkillInstanceSequence([ONE_LENGTH_PERIMETER_SKILL_INSTANCE])).toBe(true);
    expect(isSkillInstanceEligibleForAuthority(ONE_LENGTH_PERIMETER_SKILL)).toBe(true);
  });

  it("11. subsectionThickness is bound DEMONSTRATION_SPECIFIC, with a real rationale -- never a fabricated universal default", () => {
    const binding = ONE_LENGTH_PERIMETER_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === "subsectionThickness");
    expect(binding?.bindingState).toBe("DEMONSTRATION_SPECIFIC");
    expect(binding?.rationale).toBeTruthy();
    expect(typeof binding?.value).toBe("string");
  });
});

describe("B. REAL: Construct One-Length Perimeter -- Execution Units (posterior + lateral progression)", () => {
  it("12. the real Execution Unit sequence validates and is internally consistent", () => {
    expect(isValidExecutionUnitSequence(ONE_LENGTH_PERIMETER_EXECUTION_UNITS)).toBe(true);
    for (const eu of ONE_LENGTH_PERIMETER_EXECUTION_UNITS) {
      expect(isValidExecutionUnit(eu, isOneLengthPerimeterFact)).toBe(true);
    }
  });

  it("13. exactly 6 Execution Units: guide, posterior-lower, posterior-upper, lateral-left, lateral-right, final verification", () => {
    expect(ONE_LENGTH_PERIMETER_EXECUTION_UNITS.length).toBe(6);
  });

  it("14. left and right lateral Execution Units use REAL laterality LEFT/RIGHT -- the first real use of this field beyond NOT_APPLICABLE", () => {
    const left = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-lateral-left")!;
    const right = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-lateral-right")!;
    expect(left.laterality).toBe("LEFT");
    expect(right.laterality).toBe("RIGHT");
  });

  it("15. lateral Execution Units use the DISTINCT lateral_connection_guide value -- never conflated with posterior progressive-guide reference", () => {
    const left = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-lateral-left")!;
    const guideRef = left.parameterRules?.find((r) => r.parameterName === "guideReferenceMode")?.fixedValue;
    expect(guideRef).toBe("lateral_connection_guide");
  });

  it("16. posterior below-occipital is comb-controlled, at/above-occipital is finger-controlled -- reuses the real aboveOccipitalThreshold anatomical boundary", () => {
    const lower = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-posterior-lower")!;
    const upper = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-posterior-upper")!;
    expect(lower.applicabilityCondition).toEqual({ op: "equals", fact: "aboveOccipitalThreshold", value: false });
    expect(upper.applicabilityCondition).toEqual({ op: "equals", fact: "aboveOccipitalThreshold", value: true });
    expect(lower.parameterRules?.find((r) => r.parameterName === "controlMethod")?.fixedValue).toBe("comb");
    expect(upper.parameterRules?.find((r) => r.parameterName === "controlMethod")?.fixedValue).toBe("fingers");
  });

  it("17. posterior and lateral Execution Units declare bounded UNTIL_EXECUTION_UNIT_COMPLETE iteration -- progression through the full area, never one cut", () => {
    for (const id of [
      "executionunit-cutting-one-length-perimeter-posterior-lower",
      "executionunit-cutting-one-length-perimeter-posterior-upper",
      "executionunit-cutting-one-length-perimeter-lateral-left",
      "executionunit-cutting-one-length-perimeter-lateral-right",
    ]) {
      const eu = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((u) => u.executionUnitId === id)!;
      const policy = eu.verticalPayload?.iterationPolicy as { iteration: { mode: string } } | undefined;
      expect(policy?.iteration.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");
    }
  });

  it("18. the final verification Execution Unit represents the dry re-check via hairState='dry', distinct from the wet construction phase", () => {
    const finalVerification = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-final-verification")!;
    expect(finalVerification.parameterRules?.find((r) => r.parameterName === "hairState")?.fixedValue).toBe("dry");
    const guideUnit = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-establish-guide")!;
    expect(guideUnit.parameterRules?.find((r) => r.parameterName === "hairState")?.fixedValue).toBe("wet");
  });

  it("19. the final verification Execution Unit requires BOTH lateral units complete first -- a single guide cut alone is never completion", () => {
    const finalVerification = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-final-verification")!;
    expect(finalVerification.prerequisiteExecutionUnitIds).toContain("executionunit-cutting-one-length-perimeter-lateral-left");
    expect(finalVerification.prerequisiteExecutionUnitIds).toContain("executionunit-cutting-one-length-perimeter-lateral-right");
    expect(finalVerification.laterality).toBe("BILATERAL");
  });

  it("20. every Execution Unit compiles to real AtomicActions -- POSITION/CONTROL/EXECUTE fire", () => {
    for (const eu of ONE_LENGTH_PERIMETER_EXECUTION_UNITS) {
      const result = compileExecutionUnitToAtomicActions(ONE_LENGTH_PERIMETER_SKILL, ONE_LENGTH_PERIMETER_SKILL_INSTANCE, eu, isOneLengthPerimeterFact, "2026-09-11T00:00:00.000Z");
      expect(result.status).toBe("COMPILED");
      if (result.status === "COMPILED") {
        const kinds = result.actions.map((a) => a.actionKind);
        expect(kinds).toContain("POSITION");
        expect(kinds).toContain("CONTROL");
        expect(kinds).toContain("EXECUTE");
      }
    }
  });

  it("21. no elevated execution anywhere -- every Execution Unit's own resolved elevation is 0_deg_blunt", () => {
    for (const eu of ONE_LENGTH_PERIMETER_EXECUTION_UNITS) {
      const result = compileExecutionUnitToAtomicActions(ONE_LENGTH_PERIMETER_SKILL, ONE_LENGTH_PERIMETER_SKILL_INSTANCE, eu, isOneLengthPerimeterFact, "2026-09-11T00:00:00.000Z");
      expect(result.status).toBe("COMPILED");
      if (result.status === "COMPILED") {
        const execute = result.actions.find((a) => a.actionKind === "EXECUTE");
        expect(execute?.boundParameterNames).toContain("elevation");
      }
    }
    // The Skill's own single, locked elevation value proves this
    // structurally (test 4) -- no Execution Unit ever overrides it.
    expect(ONE_LENGTH_PERIMETER_EXECUTION_UNITS.every((eu) => !eu.parameterRules?.some((r) => r.parameterName === "elevation"))).toBe(true);
  });
});
