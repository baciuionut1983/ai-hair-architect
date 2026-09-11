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

  it("9. NO elevation -- a single, locked zero-degree value, no exceptions (defining truth, unchanged by the correction)", () => {
    const elevation = ONE_LENGTH_PERIMETER_SKILL.parameters.find((p) => p.name === "elevation");
    expect(elevation?.allowedValues).toEqual(["0_deg_blunt"]);
  });

  it('10. natural-fall behavior is represented as a single, locked distribution value -- "natural fall" never elevated (defining truth, unchanged)', () => {
    const distribution = ONE_LENGTH_PERIMETER_SKILL.parameters.find((p) => p.name === "distribution");
    expect(distribution?.allowedValues).toEqual(["natural_fall"]);
  });

  it("structuralTechnique is locked to the real one_length value, never graduation", () => {
    const structuralTechnique = ONE_LENGTH_PERIMETER_SKILL.parameters.find((p) => p.name === "structuralTechnique");
    expect(structuralTechnique?.allowedValues).toEqual(["one_length"]);
  });

  it("subsection thickness is a free-text professional working reference, never a hardcoded universal constant", () => {
    const subsectionThickness = ONE_LENGTH_PERIMETER_SKILL.parameters.find((p) => p.name === "subsectionThickness");
    expect(subsectionThickness?.valueKind).toBe("string");
    expect(subsectionThickness?.allowedValues).toBeUndefined();
  });

  it("declares incompatibility with Slice-and-Slide Refinement -- structurally, by exact real skillKey", () => {
    expect(ONE_LENGTH_PERIMETER_SKILL.incompatibleSkillIds).toContain(SLICE_AND_SLIDE_REFINEMENT_SKILL.skillId);
  });

  it("capabilities include PRESERVE_PERIMETER and ESTABLISH_GUIDE, never a weight-reduction outcome", () => {
    const kinds = (ONE_LENGTH_PERIMETER_SKILL.capabilities ?? []).map((c) => c.kind);
    expect(kinds).toContain("PRESERVE_PERIMETER");
    expect(kinds).toContain("ESTABLISH_GUIDE");
    expect(kinds).not.toContain("REDUCE_WEIGHT");
    expect(kinds).not.toContain("BUILD_WEIGHT");
  });

  it("12. [Stage 8.5S1B.R1] controlMethod is a real, open, case-dependent parameter -- comb and fingers both allowed, no anatomical-threshold-only framing in its own description", () => {
    const controlMethod = ONE_LENGTH_PERIMETER_SKILL.parameters.find((p) => p.name === "controlMethod");
    expect(controlMethod?.allowedValues).toEqual(["comb", "fingers"]);
    expect(controlMethod?.description).toMatch(/case-dependent/i);
  });
});

describe("A. REAL: Construct One-Length Perimeter -- Skill Instance", () => {
  it("the real Skill Instance validates against the Stage 2.5.i.5 contract", () => {
    expect(isValidSkillInstance(ONE_LENGTH_PERIMETER_SKILL_INSTANCE, isOneLengthPerimeterFact)).toBe(true);
    expect(isValidSkillInstanceSequence([ONE_LENGTH_PERIMETER_SKILL_INSTANCE])).toBe(true);
    expect(isSkillInstanceEligibleForAuthority(ONE_LENGTH_PERIMETER_SKILL)).toBe(true);
  });

  it("subsectionThickness is bound DEMONSTRATION_SPECIFIC, with a real rationale -- never a fabricated universal default", () => {
    const binding = ONE_LENGTH_PERIMETER_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === "subsectionThickness");
    expect(binding?.bindingState).toBe("DEMONSTRATION_SPECIFIC");
    expect(binding?.rationale).toBeTruthy();
    expect(typeof binding?.value).toBe("string");
  });

  it("12. controlMethod is bound PROFESSIONAL_CHOICE at instance level -- a real open choice, never FIXED_FROM_AUTHORITY", () => {
    const binding = ONE_LENGTH_PERIMETER_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === "controlMethod");
    expect(binding?.bindingState).toBe("PROFESSIONAL_CHOICE");
    expect(binding?.allowedOptions).toEqual(["comb", "fingers"]);
  });
});

describe("B. REAL: Construct One-Length Perimeter -- Execution Units (posterior + lateral progression, Stage 8.5S1B.R1 corrected)", () => {
  it("the real Execution Unit sequence validates and is internally consistent", () => {
    expect(isValidExecutionUnitSequence(ONE_LENGTH_PERIMETER_EXECUTION_UNITS)).toBe(true);
    for (const eu of ONE_LENGTH_PERIMETER_EXECUTION_UNITS) {
      expect(isValidExecutionUnit(eu, isOneLengthPerimeterFact)).toBe(true);
    }
  });

  it("11. [Stage 8.5S1B.R1] exactly 5 Execution Units: guide, ONE merged posterior-construction unit, lateral-left, lateral-right, final verification -- no separate below/above-occipital split remains", () => {
    expect(ONE_LENGTH_PERIMETER_EXECUTION_UNITS.length).toBe(5);
    const ids = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.map((eu) => eu.executionUnitId);
    expect(ids).toContain("executionunit-cutting-one-length-perimeter-posterior-construction");
    expect(ids.some((id) => id.includes("posterior-lower") || id.includes("posterior-upper"))).toBe(false);
  });

  it("left and right lateral Execution Units use REAL laterality LEFT/RIGHT -- the first real use of this field beyond NOT_APPLICABLE", () => {
    const left = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-lateral-left")!;
    const right = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-lateral-right")!;
    expect(left.laterality).toBe("LEFT");
    expect(right.laterality).toBe("RIGHT");
  });

  it("lateral Execution Units use the DISTINCT lateral_connection_guide value -- never conflated with posterior progressive-guide reference", () => {
    const left = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-lateral-left")!;
    const guideRef = left.parameterRules?.find((r) => r.parameterName === "guideReferenceMode")?.fixedValue;
    expect(guideRef).toBe("lateral_connection_guide");
  });

  it("11/12. [Stage 8.5S1B.R1] the merged posterior-construction unit does NOT fix controlMethod at Execution-Unit level -- it resolves from the source Skill Instance's own professional choice, no automatic anatomical threshold remains", () => {
    const posterior = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-posterior-construction")!;
    expect(posterior.parameterRules?.some((r) => r.parameterName === "controlMethod")).toBe(false);
    expect(posterior.applicabilityCondition).toBeUndefined();
  });

  it("12. [Stage 8.5S1B.R1] lateral Execution Units also do NOT fix controlMethod -- same case-dependent resolution as posterior construction", () => {
    for (const id of ["executionunit-cutting-one-length-perimeter-lateral-left", "executionunit-cutting-one-length-perimeter-lateral-right"]) {
      const eu = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((u) => u.executionUnitId === id)!;
      expect(eu.parameterRules?.some((r) => r.parameterName === "controlMethod")).toBe(false);
    }
  });

  it("10. controlMethod stays fixed ONLY where a real, independently-citable reason exists: guide establishment (mirrors Establish Central Nape Guide's own approved rationale) and final verification (an inspection action)", () => {
    const guideUnit = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-establish-guide")!;
    const finalVerification = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-final-verification")!;
    expect(guideUnit.parameterRules?.find((r) => r.parameterName === "controlMethod")?.fixedValue).toBe("comb");
    expect(finalVerification.parameterRules?.find((r) => r.parameterName === "controlMethod")?.fixedValue).toBe("comb");
  });

  it("[Stage 8.5S1B.R1] the merged posterior-construction unit declares bounded UNTIL_EXECUTION_UNIT_COMPLETE iteration -- progression through the full area, never one cut", () => {
    for (const id of [
      "executionunit-cutting-one-length-perimeter-posterior-construction",
      "executionunit-cutting-one-length-perimeter-lateral-left",
      "executionunit-cutting-one-length-perimeter-lateral-right",
    ]) {
      const eu = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((u) => u.executionUnitId === id)!;
      const policy = eu.verticalPayload?.iterationPolicy as { iteration: { mode: string } } | undefined;
      expect(policy?.iteration.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");
    }
  });

  it("the final verification Execution Unit represents the dry re-check via hairState='dry', distinct from the wet construction phase", () => {
    const finalVerification = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-final-verification")!;
    expect(finalVerification.parameterRules?.find((r) => r.parameterName === "hairState")?.fixedValue).toBe("dry");
    const guideUnit = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-establish-guide")!;
    expect(guideUnit.parameterRules?.find((r) => r.parameterName === "hairState")?.fixedValue).toBe("wet");
  });

  it("the final verification Execution Unit requires BOTH lateral units complete first -- a single guide cut alone is never completion", () => {
    const finalVerification = ONE_LENGTH_PERIMETER_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-one-length-perimeter-final-verification")!;
    expect(finalVerification.prerequisiteExecutionUnitIds).toContain("executionunit-cutting-one-length-perimeter-lateral-left");
    expect(finalVerification.prerequisiteExecutionUnitIds).toContain("executionunit-cutting-one-length-perimeter-lateral-right");
    expect(finalVerification.laterality).toBe("BILATERAL");
  });

  it("every Execution Unit compiles to real AtomicActions -- POSITION/CONTROL/EXECUTE fire", () => {
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

  it("9. no elevated execution anywhere -- every Execution Unit's own resolved elevation is 0_deg_blunt (defining truth, unchanged)", () => {
    for (const eu of ONE_LENGTH_PERIMETER_EXECUTION_UNITS) {
      const result = compileExecutionUnitToAtomicActions(ONE_LENGTH_PERIMETER_SKILL, ONE_LENGTH_PERIMETER_SKILL_INSTANCE, eu, isOneLengthPerimeterFact, "2026-09-11T00:00:00.000Z");
      expect(result.status).toBe("COMPILED");
      if (result.status === "COMPILED") {
        const execute = result.actions.find((a) => a.actionKind === "EXECUTE");
        expect(execute?.boundParameterNames).toContain("elevation");
      }
    }
    expect(ONE_LENGTH_PERIMETER_EXECUTION_UNITS.every((eu) => !eu.parameterRules?.some((r) => r.parameterName === "elevation"))).toBe(true);
  });
});
