import { describe, expect, it } from "vitest";

import * as skillInstanceModule from "@/lib/professional-skill-instance-contracts";
import {
  findConflictingSkillInstanceParameterBindings,
  isProfessionalCompositionStatus,
  isSkillInstanceEligibleForAuthority,
  isSkillInstanceParameterBindingState,
  isValidProfessionalComposition,
  isValidSkillInstance,
  isValidSkillInstanceParameterBinding,
  isValidSkillInstanceSequence,
  type ProfessionalComposition,
  type SkillInstance,
  type SkillInstanceParameterBinding,
} from "@/lib/professional-skill-instance-contracts";

// SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL AUTHORITY. Every fact
// name, parameter name, and identifier below is an invented placeholder
// for structural contract testing only.

type SyntheticFact = "handedness" | "anatomicalThresholdCrossed" | "branchIntent";
function isSyntheticFact(value: unknown): value is SyntheticFact {
  return value === "handedness" || value === "anatomicalThresholdCrossed" || value === "branchIntent";
}

function baseBinding(overrides: Partial<SkillInstanceParameterBinding<SyntheticFact>> = {}): SkillInstanceParameterBinding<SyntheticFact> {
  return {
    parameterName: "syntheticElevation",
    bindingState: "FIXED_FROM_AUTHORITY",
    value: "synthetic_0_deg",
    ...overrides,
  };
}

function baseInstance(overrides: Partial<SkillInstance<SyntheticFact>> = {}): SkillInstance<SyntheticFact> {
  return {
    skillInstanceId: "si-synthetic-structural",
    vertical: "synthetic_cutting",
    sourceSkillId: "skill-synthetic-structural",
    sourceSkillVersion: 1,
    compositionId: "comp-synthetic-1",
    order: 1,
    parameterBindings: [baseBinding()],
    createdAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

function baseComposition(overrides: Partial<ProfessionalComposition> = {}): ProfessionalComposition {
  return {
    compositionId: "comp-synthetic-1",
    vertical: "synthetic_cutting",
    version: 1,
    status: "DRAFT",
    createdAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("Skill Instance contract (Stage 2.5.i.5, SYNTHETIC FIXTURES ONLY)", () => {
  it("1. validates a well-formed synthetic Skill Instance", () => {
    expect(isValidSkillInstance(baseInstance(), isSyntheticFact)).toBe(true);
  });

  it("2. validates a minimal, valid Composition envelope", () => {
    expect(isValidProfessionalComposition(baseComposition())).toBe(true);
    expect(isProfessionalCompositionStatus("DRAFT")).toBe(true);
    expect(isProfessionalCompositionStatus("SYNTHETIC_NOT_A_REAL_STATUS")).toBe(false);

    const superseded = baseComposition({ status: "SUPERSEDED", supersededByCompositionId: "comp-synthetic-2" });
    expect(isValidProfessionalComposition(superseded)).toBe(true);

    // supersededByCompositionId is only legal once actually SUPERSEDED.
    const invalidSupersede = baseComposition({ status: "DRAFT", supersededByCompositionId: "comp-synthetic-2" });
    expect(isValidProfessionalComposition(invalidSupersede)).toBe(false);
  });

  it("3. traces every Skill Instance back to a source Skill Definition id", () => {
    expect(isValidSkillInstance(baseInstance({ sourceSkillId: "" }), isSyntheticFact)).toBe(false);
  });

  it("4. traces every Skill Instance back to a source Skill Definition version", () => {
    expect(isValidSkillInstance(baseInstance({ sourceSkillVersion: 0 }), isSyntheticFact)).toBe(false);
    expect(isValidSkillInstance(baseInstance({ sourceSkillVersion: 1.5 }), isSyntheticFact)).toBe(false);
    expect(isValidSkillInstance(baseInstance({ sourceSkillVersion: 2 }), isSyntheticFact)).toBe(true);
  });

  it("5. validates an ordered sequence of Skill Instances within one Composition", () => {
    const instances: SkillInstance<SyntheticFact>[] = [
      baseInstance({ skillInstanceId: "si-1", order: 1 }),
      baseInstance({ skillInstanceId: "si-2", order: 2 }),
      baseInstance({ skillInstanceId: "si-3", order: 3 }),
    ];
    expect(instances.every((i) => isValidSkillInstance(i, isSyntheticFact))).toBe(true);
    expect(isValidSkillInstanceSequence(instances)).toBe(true);

    const nonContiguous = [baseInstance({ skillInstanceId: "si-1", order: 1 }), baseInstance({ skillInstanceId: "si-2", order: 3 })];
    expect(isValidSkillInstanceSequence(nonContiguous)).toBe(false);

    const mixedComposition = [
      baseInstance({ skillInstanceId: "si-1", order: 1, compositionId: "comp-a" }),
      baseInstance({ skillInstanceId: "si-2", order: 2, compositionId: "comp-b" }),
    ];
    expect(isValidSkillInstanceSequence(mixedComposition)).toBe(false);

    expect(isValidSkillInstanceSequence([])).toBe(false);
  });

  it("6. validates typed parameter bindings and rejects conflicting bindings for the same parameter", () => {
    const bindings: SkillInstanceParameterBinding<SyntheticFact>[] = [
      baseBinding({ parameterName: "syntheticElevation" }),
      baseBinding({ parameterName: "syntheticTool" }),
    ];
    expect(isValidSkillInstance(baseInstance({ parameterBindings: bindings }), isSyntheticFact)).toBe(true);

    const conflicting = [baseBinding({ parameterName: "syntheticElevation" }), baseBinding({ parameterName: "syntheticElevation" })];
    expect(findConflictingSkillInstanceParameterBindings(conflicting)).toEqual(["syntheticElevation"]);
    expect(isValidSkillInstance(baseInstance({ parameterBindings: conflicting }), isSyntheticFact)).toBe(false);
  });

  it("7. allows a Skill Instance to exist with an unresolved material parameter -- no fake completeness forced", () => {
    const unresolved = baseInstance({ parameterBindings: [baseBinding({ bindingState: "UNRESOLVED", value: undefined })] });
    expect(isValidSkillInstance(unresolved, isSyntheticFact)).toBe(true);

    // A value can never coexist with "not yet resolved".
    const contradictory = baseInstance({
      parameterBindings: [{ parameterName: "syntheticElevation", bindingState: "UNRESOLVED", value: "synthetic_0_deg" }],
    });
    expect(isValidSkillInstance(contradictory, isSyntheticFact)).toBe(false);
  });

  it("8. represents an allowed professional choice WITH a selected value, distinct from generic UNKNOWN", () => {
    const selected = baseBinding({
      parameterName: "syntheticControlMethod",
      bindingState: "PROFESSIONAL_CHOICE",
      value: "synthetic_comb",
      allowedOptions: ["synthetic_comb", "synthetic_finger"],
      confirmedByUserId: "user-synthetic-1",
      confirmedAt: "2026-09-08T00:00:00.000Z",
    });
    expect(isValidSkillInstanceParameterBinding(selected, isSyntheticFact)).toBe(true);

    // The selected value must actually be a member of allowedOptions.
    const invalidSelection = { ...selected, value: "synthetic_not_an_option" };
    expect(isValidSkillInstanceParameterBinding(invalidSelection, isSyntheticFact)).toBe(false);
  });

  it("9. represents an allowed professional choice still UNRESOLVED, distinct from generic UNKNOWN", () => {
    const unresolvedChoice = {
      parameterName: "syntheticControlMethod",
      bindingState: "UNRESOLVED" as const,
      allowedOptions: ["synthetic_comb", "synthetic_finger"],
    };
    expect(isValidSkillInstanceParameterBinding(unresolvedChoice, isSyntheticFact)).toBe(true);

    const genericUnresolved = { parameterName: "syntheticControlMethod", bindingState: "UNRESOLVED" as const };
    expect(isValidSkillInstanceParameterBinding(genericUnresolved, isSyntheticFact)).toBe(true);
    // The two are structurally distinguishable -- one carries allowedOptions.
    expect("allowedOptions" in unresolvedChoice).toBe(true);
    expect("allowedOptions" in genericUnresolved).toBe(false);
  });

  it("10. represents a client-derived binding, requiring a source reference to the confirmed fact", () => {
    const clientDerived = baseBinding({
      parameterName: "syntheticDensity",
      bindingState: "CLIENT_DERIVED",
      value: "synthetic_medium",
      sourceReference: "confirmed-client-fact-synthetic-1",
    });
    expect(isValidSkillInstanceParameterBinding(clientDerived, isSyntheticFact)).toBe(true);

    const missingReference = { parameterName: "syntheticDensity", bindingState: "CLIENT_DERIVED" as const, value: "synthetic_medium" };
    expect(isValidSkillInstanceParameterBinding(missingReference, isSyntheticFact)).toBe(false);
  });

  it("11. represents a professional-confirmed binding, requiring confirmedByUserId + confirmedAt", () => {
    const confirmed = baseBinding({
      bindingState: "PROFESSIONAL_CONFIRMED",
      confirmedByUserId: "user-synthetic-1",
      confirmedAt: "2026-09-08T00:00:00.000Z",
    });
    expect(isValidSkillInstanceParameterBinding(confirmed, isSyntheticFact)).toBe(true);

    const missingConfirmation = baseBinding({ bindingState: "PROFESSIONAL_CONFIRMED" });
    expect(isValidSkillInstanceParameterBinding(missingConfirmation, isSyntheticFact)).toBe(false);
  });

  it("12. represents a professional-override binding, requiring confirmedByUserId + confirmedAt", () => {
    const overridden = baseBinding({
      bindingState: "PROFESSIONAL_OVERRIDE",
      confirmedByUserId: "user-synthetic-1",
      confirmedAt: "2026-09-08T00:00:00.000Z",
    });
    expect(isValidSkillInstanceParameterBinding(overridden, isSyntheticFact)).toBe(true);

    const missingConfirmation = baseBinding({ bindingState: "PROFESSIONAL_OVERRIDE" });
    expect(isValidSkillInstanceParameterBinding(missingConfirmation, isSyntheticFact)).toBe(false);
  });

  it("13. represents a demonstration-specific binding, requiring a rationale distinguishing it from adaptive authority", () => {
    const demonstrationSpecific = baseBinding({
      parameterName: "syntheticSubsectionThickness",
      bindingState: "DEMONSTRATION_SPECIFIC",
      value: "synthetic_1cm",
      rationale: "SYNTHETIC -- fixed for a deterministic demonstration; the real rule adapts to density and guide visibility.",
    });
    expect(isValidSkillInstanceParameterBinding(demonstrationSpecific, isSyntheticFact)).toBe(true);

    const missingRationale = baseBinding({ bindingState: "DEMONSTRATION_SPECIFIC", value: "synthetic_1cm" });
    expect(isValidSkillInstanceParameterBinding(missingRationale, isSyntheticFact)).toBe(false);
  });

  it("14. supports typed condition facts used to resolve applicability and CONDITION_RESOLVED bindings", () => {
    const withApplicability = baseInstance({
      applicabilityResolution: {
        applies: true,
        factsUsed: [{ fact: "branchIntent", value: "none", source: "CONFIRMED_CLIENT_FACT" }],
      },
    });
    expect(isValidSkillInstance(withApplicability, isSyntheticFact)).toBe(true);

    const conditionResolvedBinding = baseBinding({
      parameterName: "syntheticBranchParameter",
      bindingState: "CONDITION_RESOLVED",
      value: "synthetic_branch_a",
      conditionFactsUsed: [{ fact: "handedness", value: "left", source: "PROFESSIONAL_INPUT" }],
    });
    expect(isValidSkillInstanceParameterBinding(conditionResolvedBinding, isSyntheticFact)).toBe(true);

    const missingFacts = baseBinding({ bindingState: "CONDITION_RESOLVED", conditionFactsUsed: [] });
    expect(isValidSkillInstanceParameterBinding(missingFacts, isSyntheticFact)).toBe(false);
  });

  it("15. rejects an unrecognized fact name and a non-literal condition fact value -- no arbitrary executable condition", () => {
    const unrecognizedFact = {
      fact: "syntheticNotARealFact",
      value: "left",
      source: "PROFESSIONAL_INPUT",
    };
    expect(
      isValidSkillInstanceParameterBinding(
        baseBinding({ bindingState: "CONDITION_RESOLVED", conditionFactsUsed: [unrecognizedFact as never] }),
        isSyntheticFact,
      ),
    ).toBe(false);

    const nonLiteralValue = { fact: "handedness", value: { op: "eval", expression: "1===1" }, source: "PROFESSIONAL_INPUT" };
    expect(
      isValidSkillInstanceParameterBinding(
        baseBinding({ bindingState: "CONDITION_RESOLVED", conditionFactsUsed: [nonLiteralValue as never] }),
        isSyntheticFact,
      ),
    ).toBe(false);

    const invalidSource = { fact: "handedness", value: "left", source: "RAW_AI_OBSERVATION" };
    expect(
      isValidSkillInstanceParameterBinding(baseBinding({ bindingState: "CONDITION_RESOLVED", conditionFactsUsed: [invalidSource as never] }), isSyntheticFact),
    ).toBe(false);
  });

  it("16. requires structured provenance for every materially bound (non-UNRESOLVED) value", () => {
    // FIXED_FROM_AUTHORITY, CONDITION_RESOLVED, CLIENT_DERIVED,
    // PROFESSIONAL_CONFIRMED/OVERRIDE/CHOICE, and DEMONSTRATION_SPECIFIC
    // each require their own distinct structured evidence field -- none
    // accept a bare value with no accompanying provenance.
    expect(isValidSkillInstanceParameterBinding({ parameterName: "x", bindingState: "CLIENT_DERIVED", value: "y" }, isSyntheticFact)).toBe(false);
    expect(isValidSkillInstanceParameterBinding({ parameterName: "x", bindingState: "DEMONSTRATION_SPECIFIC", value: "y" }, isSyntheticFact)).toBe(false);
    expect(
      isValidSkillInstanceParameterBinding({ parameterName: "x", bindingState: "PROFESSIONAL_CHOICE", value: "y", allowedOptions: ["y"] }, isSyntheticFact),
    ).toBe(false);
  });

  it("17. cannot represent unreviewed machine-generated content as active professional authority", () => {
    // The closed 8-value bindingState enum has no slot for unreviewed AI
    // content -- an invented state is simply rejected.
    expect(isSkillInstanceParameterBindingState("AI_SUGGESTED")).toBe(false);
    expect(isSkillInstanceParameterBindingState("MACHINE_INFERRED")).toBe(false);

    // Eligibility is entirely inherited from the source Skill Definition's
    // own status/authorityType -- a MACHINE_DRAFTED source is never
    // eligible, regardless of how the instance's own bindings look.
    expect(isSkillInstanceEligibleForAuthority({ status: "ACTIVE", authorityType: "MACHINE_DRAFTED" })).toBe(false);
    expect(isSkillInstanceEligibleForAuthority({ status: "DRAFT", authorityType: "PROFESSIONALLY_AUTHORED" })).toBe(false);
    expect(isSkillInstanceEligibleForAuthority({ status: "ACTIVE", authorityType: "PROFESSIONALLY_AUTHORED" })).toBe(true);
  });

  it("18. validates equally across synthetic cutting-flavored and color-flavored parameter names -- no vertical hardcoded in the core", () => {
    const cuttingInstance = baseInstance({
      vertical: "synthetic_cutting",
      parameterBindings: [baseBinding({ parameterName: "syntheticElevation" })],
    });
    const colorInstance = baseInstance({
      skillInstanceId: "si-synthetic-color",
      vertical: "synthetic_color",
      compositionId: "comp-synthetic-color-1",
      parameterBindings: [baseBinding({ parameterName: "syntheticShadeFamily", value: "synthetic_cool_ash" })],
    });
    expect(isValidSkillInstance(cuttingInstance, isSyntheticFact)).toBe(true);
    expect(isValidSkillInstance(colorInstance, isSyntheticFact)).toBe(true);
  });

  it("19. rejects a Skill Instance sequence mixing verticals within one Composition -- cross-vertical misuse", () => {
    const mixedVertical = [
      baseInstance({ skillInstanceId: "si-1", order: 1, vertical: "synthetic_cutting" }),
      baseInstance({ skillInstanceId: "si-2", order: 2, vertical: "synthetic_color" }),
    ];
    expect(isValidSkillInstanceSequence(mixedVertical)).toBe(false);
  });

  it("20. never generates or persists Execution Units -- module exports name no such concept", () => {
    const exported = Object.keys(skillInstanceModule);
    expect(exported).not.toContain("ExecutionUnit");
    expect(exported).not.toContain("isValidExecutionUnit");
  });

  it("21. never includes or persists Atomic Actions -- module exports name no such concept", () => {
    const exported = Object.keys(skillInstanceModule);
    expect(exported).not.toContain("AtomicAction");
    expect(exported).not.toContain("isValidAtomicAction");
  });

  it("22. carries a bare compatibility reference/outcome record, never a coherence-checking function", () => {
    const withCompatibility = baseInstance({
      compatibilityEvaluation: { evaluatedAgainstSkillInstanceIds: ["si-other-synthetic"], outcome: "NOT_YET_EVALUATED" },
    });
    expect(isValidSkillInstance(withCompatibility, isSyntheticFact)).toBe(true);

    const exported = Object.keys(skillInstanceModule);
    expect(exported).not.toContain("evaluateCompatibility");
    expect(exported).not.toContain("checkCompatibility");
    expect(exported).not.toContain("evaluatePlanCoherence");
  });
});

describe("isSkillInstanceEligibleForAuthority", () => {
  it("delegates to the exact same governance principle as isSkillEligibleForAuthority", () => {
    expect(isSkillInstanceEligibleForAuthority({ status: "ACTIVE", authorityType: "PROFESSIONALLY_REVIEWED" })).toBe(true);
    expect(isSkillInstanceEligibleForAuthority({ status: "RETIRED", authorityType: "PROFESSIONALLY_AUTHORED" })).toBe(false);
  });
});
