import { describe, expect, it } from "vitest";

import type { ExecutionUnitParameterRule } from "@/lib/professional-skill-execution-unit-contracts";
import type { SkillConditionFacts } from "@/lib/skill-condition-evaluator";
import type { PlannedExecutionParameter } from "@/lib/professional-execution-plan-contracts";
import { computeProfessionalExecutionPlanReadiness, evaluateExecutionUnitParameterReadiness, summarizeExecutionUnitReadiness } from "@/lib/professional-execution-plan-readiness";

// Professional Skill Engine, Stage 6 -- PROFESSIONAL EXECUTION PLAN, Part
// D/E readiness evaluator tests. SYNTHETIC TEST FIXTURE -- not real
// professional authority (see professional-execution-plan-readiness.ts's
// own header on why this file's own branches are exercised synthetically:
// none of the 3 real skills' Execution Units use REQUIRED_CONDITIONAL/
// PROFESSIONAL_CHOICE/NOT_APPLICABLE today). Pure, zero I/O, zero AI.

type Fact = "clientConsentsToOverdirection";

function resolved(name: string, value: string | boolean | number): PlannedExecutionParameter {
  return { name, value, source: "SKILL_DEFAULT" };
}

describe("evaluateExecutionUnitParameterReadiness", () => {
  it("6. REQUIRED_FIXED with a matching resolved value is READY", () => {
    const rules: ExecutionUnitParameterRule<Fact>[] = [{ parameterName: "controlMethod", semantic: "REQUIRED_FIXED", fixedValue: "comb", rationale: "SYNTHETIC." }];
    const result = evaluateExecutionUnitParameterReadiness(rules, [resolved("controlMethod", "comb")], new Map());
    expect(result).toEqual([{ parameterName: "controlMethod", status: "READY" }]);
  });

  it("7. REQUIRED_FIXED missing is MISSING/MISSING_REQUIRED_PARAMETER", () => {
    const rules: ExecutionUnitParameterRule<Fact>[] = [{ parameterName: "controlMethod", semantic: "REQUIRED_FIXED", fixedValue: "comb", rationale: "SYNTHETIC." }];
    const result = evaluateExecutionUnitParameterReadiness(rules, [], new Map());
    expect(result).toEqual([{ parameterName: "controlMethod", status: "MISSING", failureReason: "MISSING_REQUIRED_PARAMETER" }]);
  });

  it("8. REQUIRED_FIXED present but mismatched value is INVALID/INVALID_PARAMETER_VALUE", () => {
    const rules: ExecutionUnitParameterRule<Fact>[] = [{ parameterName: "controlMethod", semantic: "REQUIRED_FIXED", fixedValue: "comb", rationale: "SYNTHETIC." }];
    const result = evaluateExecutionUnitParameterReadiness(rules, [resolved("controlMethod", "fingers")], new Map());
    expect(result).toEqual([{ parameterName: "controlMethod", status: "INVALID", failureReason: "INVALID_PARAMETER_VALUE" }]);
  });

  it("9. REQUIRED_CONDITIONAL, condition TRUE, value present -> READY", () => {
    const rules: ExecutionUnitParameterRule<Fact>[] = [
      { parameterName: "overdirection", semantic: "REQUIRED_CONDITIONAL", condition: { op: "equals", fact: "clientConsentsToOverdirection", value: true }, rationale: "SYNTHETIC." },
    ];
    const facts: SkillConditionFacts<Fact> = new Map([["clientConsentsToOverdirection", { value: true, known: true }]]);
    const result = evaluateExecutionUnitParameterReadiness(rules, [resolved("overdirection", true)], facts);
    expect(result).toEqual([{ parameterName: "overdirection", status: "READY" }]);
  });

  it("10. REQUIRED_CONDITIONAL, condition TRUE, missing -> MISSING/MISSING_REQUIRED_PARAMETER", () => {
    const rules: ExecutionUnitParameterRule<Fact>[] = [
      { parameterName: "overdirection", semantic: "REQUIRED_CONDITIONAL", condition: { op: "equals", fact: "clientConsentsToOverdirection", value: true }, rationale: "SYNTHETIC." },
    ];
    const facts: SkillConditionFacts<Fact> = new Map([["clientConsentsToOverdirection", { value: true, known: true }]]);
    const result = evaluateExecutionUnitParameterReadiness(rules, [], facts);
    expect(result).toEqual([{ parameterName: "overdirection", status: "MISSING", failureReason: "MISSING_REQUIRED_PARAMETER" }]);
  });

  it("11. REQUIRED_CONDITIONAL, condition UNKNOWN -> NEEDS_INPUT/UNKNOWN_CONDITIONAL_PARAMETER, even when a value happens to be present (fail closed, never guess)", () => {
    const rules: ExecutionUnitParameterRule<Fact>[] = [
      { parameterName: "overdirection", semantic: "REQUIRED_CONDITIONAL", condition: { op: "equals", fact: "clientConsentsToOverdirection", value: true }, rationale: "SYNTHETIC." },
    ];
    const result = evaluateExecutionUnitParameterReadiness(rules, [resolved("overdirection", true)], new Map());
    expect(result).toEqual([{ parameterName: "overdirection", status: "NEEDS_INPUT", failureReason: "UNKNOWN_CONDITIONAL_PARAMETER" }]);
  });

  it("REQUIRED_CONDITIONAL, condition FALSE -> READY regardless of presence (not required)", () => {
    const rules: ExecutionUnitParameterRule<Fact>[] = [
      { parameterName: "overdirection", semantic: "REQUIRED_CONDITIONAL", condition: { op: "equals", fact: "clientConsentsToOverdirection", value: true }, rationale: "SYNTHETIC." },
    ];
    const facts: SkillConditionFacts<Fact> = new Map([["clientConsentsToOverdirection", { value: false, known: true }]]);
    expect(evaluateExecutionUnitParameterReadiness(rules, [], facts)).toEqual([{ parameterName: "overdirection", status: "READY" }]);
  });

  it("12. PROFESSIONAL_CHOICE missing -> NEEDS_INPUT; provided-but-invalid -> INVALID/INVALID_PARAMETER_VALUE; provided-and-allowed -> READY", () => {
    const rules: ExecutionUnitParameterRule<Fact>[] = [{ parameterName: "tool", semantic: "PROFESSIONAL_CHOICE", allowedOptions: ["straight_shear", "texturizing_shear"], rationale: "SYNTHETIC." }];
    expect(evaluateExecutionUnitParameterReadiness(rules, [], new Map())).toEqual([{ parameterName: "tool", status: "NEEDS_INPUT", failureReason: "MISSING_REQUIRED_PARAMETER" }]);
    expect(evaluateExecutionUnitParameterReadiness(rules, [resolved("tool", "razor")], new Map())).toEqual([{ parameterName: "tool", status: "INVALID", failureReason: "INVALID_PARAMETER_VALUE" }]);
    expect(evaluateExecutionUnitParameterReadiness(rules, [resolved("tool", "straight_shear")], new Map())).toEqual([{ parameterName: "tool", status: "READY" }]);
  });

  it("13. NOT_APPLICABLE with a value supplied is REJECTED/NOT_APPLICABLE_PARAMETER_SUPPLIED; absent is READY. CLIENT_DERIVED/UNDEFINED never impact readiness", () => {
    const notApplicable: ExecutionUnitParameterRule<Fact>[] = [{ parameterName: "overdirection", semantic: "NOT_APPLICABLE", rationale: "SYNTHETIC." }];
    expect(evaluateExecutionUnitParameterReadiness(notApplicable, [resolved("overdirection", true)], new Map())).toEqual([
      { parameterName: "overdirection", status: "REJECTED", failureReason: "NOT_APPLICABLE_PARAMETER_SUPPLIED" },
    ]);
    expect(evaluateExecutionUnitParameterReadiness(notApplicable, [], new Map())).toEqual([{ parameterName: "overdirection", status: "READY" }]);

    const clientDerived: ExecutionUnitParameterRule<Fact>[] = [{ parameterName: "hairState", semantic: "CLIENT_DERIVED", rationale: "SYNTHETIC." }];
    expect(evaluateExecutionUnitParameterReadiness(clientDerived, [], new Map())).toEqual([{ parameterName: "hairState", status: "READY" }]);

    const undefinedSemantic: ExecutionUnitParameterRule<Fact>[] = [{ parameterName: "shearOrientation", semantic: "UNDEFINED", rationale: "SYNTHETIC." }];
    expect(evaluateExecutionUnitParameterReadiness(undefinedSemantic, [], new Map())).toEqual([{ parameterName: "shearOrientation", status: "READY" }]);
  });

  it("zero declared rules -> zero gaps (the real 3 skills' own common case today)", () => {
    expect(evaluateExecutionUnitParameterReadiness([], [], new Map())).toEqual([]);
  });
});

describe("summarizeExecutionUnitReadiness", () => {
  it("a MISSING gap rolls up to BLOCKED", () => {
    const rules: ExecutionUnitParameterRule<Fact>[] = [{ parameterName: "controlMethod", semantic: "REQUIRED_FIXED", fixedValue: "comb", rationale: "SYNTHETIC." }];
    expect(summarizeExecutionUnitReadiness(rules, [], new Map()).verdict).toBe("BLOCKED");
  });

  it("an INVALID/REJECTED gap rolls up to BLOCKED", () => {
    const rules: ExecutionUnitParameterRule<Fact>[] = [{ parameterName: "overdirection", semantic: "NOT_APPLICABLE", rationale: "SYNTHETIC." }];
    expect(summarizeExecutionUnitReadiness(rules, [resolved("overdirection", true)], new Map()).verdict).toBe("BLOCKED");
  });

  it("an UNKNOWN_CONDITIONAL gap with no other defect rolls up to NEEDS_INPUT", () => {
    const rules: ExecutionUnitParameterRule<Fact>[] = [
      { parameterName: "overdirection", semantic: "REQUIRED_CONDITIONAL", condition: { op: "equals", fact: "clientConsentsToOverdirection", value: true }, rationale: "SYNTHETIC." },
    ];
    expect(summarizeExecutionUnitReadiness(rules, [], new Map()).verdict).toBe("NEEDS_INPUT");
  });

  it("no gaps rolls up to READY", () => {
    expect(summarizeExecutionUnitReadiness([], [], new Map()).verdict).toBe("READY");
  });
});

describe("computeProfessionalExecutionPlanReadiness", () => {
  it("any BLOCKED unit -> plan BLOCKED, highest priority", () => {
    expect(computeProfessionalExecutionPlanReadiness({ unitVerdicts: ["READY", "BLOCKED", "NEEDS_INPUT"], unresolvedRequirementCount: 1, droppedProposedStepCount: 1 })).toBe("BLOCKED");
  });

  it("any NEEDS_INPUT unit, no BLOCKED -> plan NEEDS_INPUT", () => {
    expect(computeProfessionalExecutionPlanReadiness({ unitVerdicts: ["READY", "NEEDS_INPUT"], unresolvedRequirementCount: 0, droppedProposedStepCount: 0 })).toBe("NEEDS_INPUT");
  });

  it("no defective units, unresolvedRequirementCount > 0 -> plan NEEDS_SKILL (the crown-weight-reduction case)", () => {
    expect(computeProfessionalExecutionPlanReadiness({ unitVerdicts: ["READY", "READY"], unresolvedRequirementCount: 1, droppedProposedStepCount: 0 })).toBe("NEEDS_SKILL");
  });

  it("no defects, no unresolved requirements, a rejected unit with no replacement -> plan PARTIAL", () => {
    expect(computeProfessionalExecutionPlanReadiness({ unitVerdicts: ["READY"], unresolvedRequirementCount: 0, droppedProposedStepCount: 1 })).toBe("PARTIAL");
  });

  it("fully clean plan -> READY_FOR_PROFESSIONAL_REVIEW", () => {
    expect(computeProfessionalExecutionPlanReadiness({ unitVerdicts: ["READY", "READY"], unresolvedRequirementCount: 0, droppedProposedStepCount: 0 })).toBe("READY_FOR_PROFESSIONAL_REVIEW");
  });
});
