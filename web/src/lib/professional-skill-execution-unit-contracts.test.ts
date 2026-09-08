import { describe, expect, it } from "vitest";

import { isRecord } from "@/lib/technical-visual-map-validators";
import * as executionUnitModule from "@/lib/professional-skill-execution-unit-contracts";
import {
  EXECUTION_UNIT_LATERALITY_VALUES,
  findConflictingExecutionUnitParameterRules,
  isExecutionUnitEligibleForAuthority,
  isExecutionUnitLaterality,
  isExecutionUnitParameterSemantic,
  isValidExecutionUnit,
  isValidExecutionUnitParameterRule,
  isValidExecutionUnitSequence,
  type ExecutionUnit,
  type ExecutionUnitParameterRule,
} from "@/lib/professional-skill-execution-unit-contracts";

// SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL AUTHORITY. Every fact
// name, zone label, parameter name, and rationale string below is an
// invented placeholder for structural contract testing only.

type SyntheticFact = "handedness" | "anatomicalThresholdCrossed" | "branchIntent";
function isSyntheticFact(value: unknown): value is SyntheticFact {
  return value === "handedness" || value === "anatomicalThresholdCrossed" || value === "branchIntent";
}

interface SyntheticCuttingPayload {
  zoneLabel: string;
}
function isSyntheticCuttingPayload(value: unknown): value is SyntheticCuttingPayload {
  return isRecord(value) && typeof value.zoneLabel === "string";
}

interface SyntheticColorPayload {
  shadeFamily: string;
}
function isSyntheticColorPayload(value: unknown): value is SyntheticColorPayload {
  return isRecord(value) && typeof value.shadeFamily === "string";
}

function baseUnit(overrides: Partial<ExecutionUnit<SyntheticFact>> = {}): ExecutionUnit<SyntheticFact> {
  return {
    executionUnitId: "eu-synthetic-posterior",
    vertical: "synthetic_cutting",
    order: 1,
    label: "SYNTHETIC Posterior/Lower",
    zoneId: "synthetic_zone_posterior_lower",
    laterality: "NOT_APPLICABLE",
    sourceSkillId: "skill-synthetic-structural",
    sourceSkillVersion: 1,
    createdAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("Execution Unit contract (Stage 2.5.i.3, SYNTHETIC FIXTURES ONLY)", () => {
  it("1. validates a well-formed synthetic Execution Unit", () => {
    expect(isValidExecutionUnit(baseUnit(), isSyntheticFact)).toBe(true);
  });

  it("2. validates an ordered sequence of multiple synthetic Execution Units", () => {
    const units: ExecutionUnit<SyntheticFact>[] = [
      baseUnit({ executionUnitId: "eu-1", order: 1, label: "SYNTHETIC Posterior/Lower" }),
      baseUnit({ executionUnitId: "eu-2", order: 2, label: "SYNTHETIC Occipital Transition", zoneId: "synthetic_zone_occipital" }),
      baseUnit({ executionUnitId: "eu-3", order: 3, label: "SYNTHETIC Left Lateral", laterality: "LEFT", zoneId: "synthetic_zone_lateral" }),
    ];
    expect(units.every((u) => isValidExecutionUnit(u, isSyntheticFact))).toBe(true);
    expect(isValidExecutionUnitSequence(units)).toBe(true);
  });

  it("3. one synthetic Skill Instance (same sourceSkillId+version) conceptually produces several Execution Units; a mixed-source array is rejected", () => {
    const sameSource = [
      baseUnit({ executionUnitId: "eu-a", order: 1, sourceSkillId: "skill-synthetic-structural", sourceSkillVersion: 3 }),
      baseUnit({ executionUnitId: "eu-b", order: 2, sourceSkillId: "skill-synthetic-structural", sourceSkillVersion: 3 }),
    ];
    expect(isValidExecutionUnitSequence(sameSource)).toBe(true);

    const mixedSource = [
      baseUnit({ executionUnitId: "eu-a", order: 1, sourceSkillVersion: 3 }),
      baseUnit({ executionUnitId: "eu-b", order: 2, sourceSkillVersion: 4 }),
    ];
    expect(isValidExecutionUnitSequence(mixedSource)).toBe(false);
  });

  it("4. isolates vertical-specific payload shape per caller-supplied validator", () => {
    const cuttingUnit = baseUnit({ verticalPayload: { zoneLabel: "synthetic-nape" } });
    const colorUnit = baseUnit({ verticalPayload: { shadeFamily: "synthetic-cool-ash" } });
    expect(isValidExecutionUnit(cuttingUnit, isSyntheticFact, isSyntheticCuttingPayload)).toBe(true);
    expect(isValidExecutionUnit(colorUnit, isSyntheticFact, isSyntheticColorPayload)).toBe(true);
  });

  it("5. represents zone scope as a typed, non-empty identifier", () => {
    expect(isValidExecutionUnit(baseUnit({ zoneId: "synthetic_zone_x" }), isSyntheticFact)).toBe(true);
    expect(isValidExecutionUnit(baseUnit({ zoneId: "" }), isSyntheticFact)).toBe(false);
  });

  it("6. represents laterality as a closed, typed vocabulary", () => {
    for (const value of EXECUTION_UNIT_LATERALITY_VALUES) {
      expect(isExecutionUnitLaterality(value)).toBe(true);
      expect(isValidExecutionUnit(baseUnit({ laterality: value }), isSyntheticFact)).toBe(true);
    }
    expect(isExecutionUnitLaterality("SYNTHETIC_INVALID_SIDE")).toBe(false);
  });

  it("7. supports a typed applicability condition using the reused SkillCondition language", () => {
    const simple = baseUnit({ applicabilityCondition: { op: "equals", fact: "handedness", value: "left" } });
    expect(isValidExecutionUnit(simple, isSyntheticFact)).toBe(true);

    const compound = baseUnit({
      applicabilityCondition: {
        op: "and",
        conditions: [
          { op: "equals", fact: "branchIntent", value: "none" },
          { op: "not", condition: { op: "equals", fact: "anatomicalThresholdCrossed", value: true } },
        ],
      },
    });
    expect(isValidExecutionUnit(compound, isSyntheticFact)).toBe(true);
  });

  it("8. rejects any condition op outside the closed five-operator set -- no eval, no executable string", () => {
    const invalidOp = baseUnit({
      applicabilityCondition: { op: "eval", expression: "1 === 1" } as unknown as ExecutionUnit<SyntheticFact>["applicabilityCondition"],
    });
    expect(isValidExecutionUnit(invalidOp, isSyntheticFact)).toBe(false);

    const executableString = baseUnit({
      applicabilityCondition: "return true;" as unknown as ExecutionUnit<SyntheticFact>["applicabilityCondition"],
    });
    expect(isValidExecutionUnit(executableString, isSyntheticFact)).toBe(false);
  });

  it("9. keeps parameter rules as stable declarative context, structurally separate from any Atomic Action concept", () => {
    const rule: ExecutionUnitParameterRule<SyntheticFact> = {
      parameterName: "syntheticControlMethod",
      semantic: "PROFESSIONAL_CHOICE",
      allowedOptions: ["synthetic_comb", "synthetic_finger"],
      rationale: "SYNTHETIC -- placeholder rationale for structural testing only.",
    };
    expect(isValidExecutionUnit(baseUnit({ parameterRules: [rule] }), isSyntheticFact)).toBe(true);

    // The module's own exported surface names no Atomic Action concept --
    // this file never recognizes or requires one.
    expect(Object.keys(executionUnitModule)).not.toContain("isValidAtomicAction");
    expect(Object.keys(executionUnitModule)).not.toContain("AtomicAction");
  });

  it("10. never requires or recognizes an 'atomicActions' field on a valid Execution Unit", () => {
    const withExtraneousActions = { ...baseUnit(), atomicActions: [{ fake: "synthetic action, ignored" }] };
    const without = baseUnit();
    expect(isValidExecutionUnit(withExtraneousActions, isSyntheticFact)).toBe(isValidExecutionUnit(without, isSyntheticFact));
  });

  it("11. requires sourceSkillId + sourceSkillVersion provenance traceability", () => {
    expect(isValidExecutionUnit(baseUnit({ sourceSkillId: "" }), isSyntheticFact)).toBe(false);
    expect(isValidExecutionUnit(baseUnit({ sourceSkillVersion: 0 }), isSyntheticFact)).toBe(false);
    expect(isValidExecutionUnit(baseUnit({ sourceSkillVersion: 1.5 }), isSyntheticFact)).toBe(false);
  });

  it("12. rejects non-contiguous ordering, duplicate ids, and cyclic prerequisites in a sequence", () => {
    const nonContiguous = [baseUnit({ executionUnitId: "eu-1", order: 1 }), baseUnit({ executionUnitId: "eu-2", order: 3 })];
    expect(isValidExecutionUnitSequence(nonContiguous)).toBe(false);

    const duplicateIds = [baseUnit({ executionUnitId: "eu-1", order: 1 }), baseUnit({ executionUnitId: "eu-1", order: 2 })];
    expect(isValidExecutionUnitSequence(duplicateIds)).toBe(false);

    const cyclic = [
      baseUnit({ executionUnitId: "eu-1", order: 1, prerequisiteExecutionUnitIds: ["eu-2"] }),
      baseUnit({ executionUnitId: "eu-2", order: 2, prerequisiteExecutionUnitIds: ["eu-1"] }),
    ];
    expect(isValidExecutionUnitSequence(cyclic)).toBe(false);

    expect(isValidExecutionUnitSequence([])).toBe(false);

    const danglingPrereq = [baseUnit({ executionUnitId: "eu-1", order: 1, prerequisiteExecutionUnitIds: ["eu-does-not-exist"] })];
    expect(isValidExecutionUnitSequence(danglingPrereq)).toBe(false);
  });

  it("rejects an Execution Unit that lists itself as its own prerequisite", () => {
    const selfReferencing = baseUnit({ executionUnitId: "eu-self", prerequisiteExecutionUnitIds: ["eu-self"] });
    expect(isValidExecutionUnit(selfReferencing, isSyntheticFact)).toBe(false);
  });

  it("13. rejects an invalid scope (empty zoneId, unrecognized laterality, empty subPhase)", () => {
    expect(isValidExecutionUnit(baseUnit({ zoneId: "" }), isSyntheticFact)).toBe(false);
    expect(
      isValidExecutionUnit(baseUnit({ laterality: "SYNTHETIC_SIDEWAYS" as unknown as ExecutionUnit<SyntheticFact>["laterality"] }), isSyntheticFact),
    ).toBe(false);
    expect(isValidExecutionUnit(baseUnit({ subPhase: "" }), isSyntheticFact)).toBe(false);
  });

  it("14. rejects a cross-vertical payload shape when checked against the wrong vertical's own validator", () => {
    const colorShaped = baseUnit({ verticalPayload: { shadeFamily: "synthetic-cool-ash" } });
    expect(isValidExecutionUnit(colorShaped, isSyntheticFact, isSyntheticCuttingPayload)).toBe(false);

    const cuttingShaped = baseUnit({ verticalPayload: { zoneLabel: "synthetic-nape" } });
    expect(isValidExecutionUnit(cuttingShaped, isSyntheticFact, isSyntheticColorPayload)).toBe(false);
  });
});

describe("ExecutionUnitParameterRule validation", () => {
  it("validates REQUIRED_FIXED / PROFESSIONAL_CHOICE / REQUIRED_CONDITIONAL / bare semantics correctly, each rejecting a mismatched extra field", () => {
    expect(
      isValidExecutionUnitParameterRule(
        { parameterName: "syntheticElevation", semantic: "REQUIRED_FIXED", fixedValue: "synthetic_0_deg", rationale: "SYNTHETIC placeholder." },
        isSyntheticFact,
      ),
    ).toBe(true);
    expect(
      isValidExecutionUnitParameterRule(
        {
          parameterName: "syntheticElevation",
          semantic: "REQUIRED_FIXED",
          fixedValue: "synthetic_0_deg",
          allowedOptions: ["x"],
          rationale: "SYNTHETIC placeholder.",
        },
        isSyntheticFact,
      ),
    ).toBe(false);

    expect(
      isValidExecutionUnitParameterRule(
        { parameterName: "syntheticTool", semantic: "PROFESSIONAL_CHOICE", allowedOptions: ["synthetic_a", "synthetic_b"], rationale: "SYNTHETIC placeholder." },
        isSyntheticFact,
      ),
    ).toBe(true);
    expect(
      isValidExecutionUnitParameterRule(
        { parameterName: "syntheticTool", semantic: "PROFESSIONAL_CHOICE", allowedOptions: [], rationale: "SYNTHETIC placeholder." },
        isSyntheticFact,
      ),
    ).toBe(false);

    expect(
      isValidExecutionUnitParameterRule(
        {
          parameterName: "syntheticBranch",
          semantic: "REQUIRED_CONDITIONAL",
          condition: { op: "equals", fact: "branchIntent", value: "none" },
          rationale: "SYNTHETIC placeholder.",
        },
        isSyntheticFact,
      ),
    ).toBe(true);
    expect(
      isValidExecutionUnitParameterRule(
        { parameterName: "syntheticBranch", semantic: "REQUIRED_CONDITIONAL", rationale: "SYNTHETIC placeholder." },
        isSyntheticFact,
      ),
    ).toBe(false);

    expect(isValidExecutionUnitParameterRule({ parameterName: "syntheticUnknown", semantic: "UNDEFINED", rationale: "SYNTHETIC placeholder." }, isSyntheticFact)).toBe(
      true,
    );
    expect(
      isValidExecutionUnitParameterRule(
        { parameterName: "syntheticUnknown", semantic: "UNDEFINED", fixedValue: "should-not-be-here", rationale: "SYNTHETIC placeholder." },
        isSyntheticFact,
      ),
    ).toBe(false);
  });

  it("detects conflicting parameter rules targeting the same parameterName within one Execution Unit", () => {
    const rules: ExecutionUnitParameterRule<SyntheticFact>[] = [
      { parameterName: "syntheticTool", semantic: "UNDEFINED", rationale: "SYNTHETIC." },
      { parameterName: "syntheticTool", semantic: "NOT_APPLICABLE", rationale: "SYNTHETIC." },
    ];
    expect(findConflictingExecutionUnitParameterRules(rules)).toEqual(["syntheticTool"]);
    expect(isValidExecutionUnit(baseUnit({ parameterRules: rules }), isSyntheticFact)).toBe(false);
  });

  it("rejects an unrecognized parameter-rule semantic", () => {
    expect(isExecutionUnitParameterSemantic("SYNTHETIC_NOT_A_REAL_SEMANTIC")).toBe(false);
  });
});

describe("isExecutionUnitEligibleForAuthority", () => {
  it("delegates to the exact same governance principle as isSkillEligibleForAuthority", () => {
    expect(isExecutionUnitEligibleForAuthority({ status: "ACTIVE", authorityType: "PROFESSIONALLY_AUTHORED" })).toBe(true);
    expect(isExecutionUnitEligibleForAuthority({ status: "DRAFT", authorityType: "PROFESSIONALLY_AUTHORED" })).toBe(false);
    expect(isExecutionUnitEligibleForAuthority({ status: "ACTIVE", authorityType: "MACHINE_DRAFTED" })).toBe(false);
  });
});
