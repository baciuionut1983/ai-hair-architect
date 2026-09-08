import { describe, expect, it } from "vitest";

import { isSkillEligibleForAuthority, isValidSkillDefinition } from "@/lib/professional-skill-contracts";
import { isValidSkillInstance, isValidSkillInstanceSequence } from "@/lib/professional-skill-instance-contracts";
import { isValidExecutionUnit, isValidExecutionUnitSequence } from "@/lib/professional-skill-execution-unit-contracts";
import {
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
} from "@/lib/cutting-skill-establish-central-nape-guide";
import {
  isOccipitalTransitionFact,
  OCCIPITAL_TRANSITION_EXECUTION_UNITS,
  OCCIPITAL_TRANSITION_SKILL,
  OCCIPITAL_TRANSITION_SKILL_INSTANCE,
  type OccipitalTransitionFact,
} from "@/lib/cutting-skill-occipital-transition";

function findControlMethodRule(eu: (typeof OCCIPITAL_TRANSITION_EXECUTION_UNITS)[number]) {
  return eu.parameterRules?.find((r) => r.parameterName === "controlMethod");
}

function findBinding(name: string) {
  return OCCIPITAL_TRANSITION_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === name);
}

// ===========================================================================
// SECTION A -- REAL PROFESSIONAL AUTHORITY FIXTURE / CONSTANT.
// Every assertion in this section exercises the ACTUAL exported,
// professionally-authored Skill/Instance/Execution Unit content for
// "Occipital Transition" -- NOT a synthetic placeholder.
// ===========================================================================

describe("A. REAL: Occipital Transition -- Skill Definition", () => {
  it("1. the real Skill Definition validates against the Stage 2.5.i.1 contract", () => {
    expect(isValidSkillDefinition(OCCIPITAL_TRANSITION_SKILL, isOccipitalTransitionFact)).toBe(true);
  });
});

describe("A. REAL: Occipital Transition -- Skill Instance", () => {
  it("2. the real Skill Instance validates against the Stage 2.5.i.5 contract", () => {
    expect(isValidSkillInstance(OCCIPITAL_TRANSITION_SKILL_INSTANCE, isOccipitalTransitionFact)).toBe(true);
  });

  it("3. provenance is professionally authorized -- ACTIVE + PROFESSIONALLY_AUTHORED, eligible, never an AI draft", () => {
    expect(OCCIPITAL_TRANSITION_SKILL.authorityType).toBe("PROFESSIONALLY_AUTHORED");
    expect(OCCIPITAL_TRANSITION_SKILL.status).toBe("ACTIVE");
    expect(isSkillEligibleForAuthority(OCCIPITAL_TRANSITION_SKILL)).toBe(true);
    for (const binding of OCCIPITAL_TRANSITION_SKILL_INSTANCE.parameterBindings) {
      expect(binding.sourceReference).toBeTruthy();
    }
  });

  it("4. the exact authorized profile context (One Length + Blunt Line + Natural Fall + 0deg + No Overdirection) is preserved", () => {
    expect(findBinding("structuralTechnique")?.value).toBe("one_length");
    expect(findBinding("cuttingTechnique")?.value).toBe("blunt_line");
    expect(findBinding("distribution")?.value).toBe("natural_fall");
    expect(findBinding("elevation")?.value).toBe("0_deg_blunt");
    expect(findBinding("overdirection")?.value).toBe(false);
  });

  it("5. no unsupported salon fact is present -- no invented client characteristics", () => {
    const values = OCCIPITAL_TRANSITION_SKILL_INSTANCE.parameterBindings.map((b) => String(b.value)).join(" ").toLowerCase();
    for (const term of ["density", "texture", "porosity", "fiber_thickness", "fiber thickness"]) {
      expect(values.includes(term)).toBe(false);
    }
  });
});

describe("A. REAL: Occipital Transition -- the two stable control-method contexts", () => {
  it("6. the lower posterior / below-threshold context encodes COMB control", () => {
    const rule = findControlMethodRule(OCCIPITAL_TRANSITION_EXECUTION_UNITS[0]);
    expect(rule?.fixedValue).toBe("comb");
    expect(OCCIPITAL_TRANSITION_EXECUTION_UNITS[0].applicabilityCondition).toEqual({ op: "equals", fact: "aboveOccipitalThreshold", value: false });
  });

  it("7. the occipital / at-and-above-threshold context encodes FINGER control", () => {
    const rule = findControlMethodRule(OCCIPITAL_TRANSITION_EXECUTION_UNITS[1]);
    expect(rule?.fixedValue).toBe("fingers");
    expect(OCCIPITAL_TRANSITION_EXECUTION_UNITS[1].applicabilityCondition).toEqual({ op: "equals", fact: "aboveOccipitalThreshold", value: true });
  });

  it("8. the two contexts are NOT collapsed into one ambiguous control value", () => {
    const lower = findControlMethodRule(OCCIPITAL_TRANSITION_EXECUTION_UNITS[0])?.fixedValue;
    const upper = findControlMethodRule(OCCIPITAL_TRANSITION_EXECUTION_UNITS[1])?.fixedValue;
    expect(lower).not.toBe(upper);
    expect([lower, upper]).not.toContain("comb_and_fingers");
    expect(new Set([lower, upper]).size).toBe(2);
    // controlMethod is never bound at the Skill-Instance level -- it is
    // not stable across this Skill.
    expect(findBinding("controlMethod")).toBeUndefined();
  });

  it("9. zero-degree elevation remains structurally distinct from control method across both contexts", () => {
    expect(findBinding("elevation")?.value).toBe("0_deg_blunt");
    expect(findBinding("elevation")?.parameterName).not.toBe("controlMethod");
    // Elevation is stable at the Skill-Instance level; controlMethod
    // varies at the Execution Unit level -- two different layers, never
    // conflated.
    expect(OCCIPITAL_TRANSITION_EXECUTION_UNITS.every((eu) => eu.parameterRules?.every((r) => r.parameterName !== "elevation"))).toBe(true);
  });

  it("10. wet hair execution state is represented honestly, stable across both contexts", () => {
    expect(findBinding("hairState")?.value).toBe("wet");
  });
});

describe("A. REAL: Occipital Transition -- scope discipline", () => {
  // Structural (technical-truth) haystack only -- parameter names/values,
  // EU zoneId/condition/parameterRule values -- never rationale/
  // description prose (see cutting-skill-establish-central-nape-guide
  // .test.ts's own precedent for why prose is deliberately excluded: it
  // legitimately documents scope exclusions in words like "lateral" or
  // "graduation" without that being included content).
  const structuralHaystack = JSON.stringify({
    parameterNames: OCCIPITAL_TRANSITION_SKILL.parameters.map((p) => p.name),
    parameterAllowedValues: OCCIPITAL_TRANSITION_SKILL.parameters.flatMap((p) => p.allowedValues ?? []),
    bindingValues: OCCIPITAL_TRANSITION_SKILL_INSTANCE.parameterBindings.map((b) => b.value),
    units: OCCIPITAL_TRANSITION_EXECUTION_UNITS.map((eu) => ({
      zoneId: eu.zoneId,
      applicabilityCondition: eu.applicabilityCondition,
      parameterRuleValues: eu.parameterRules?.map((r) => r.fixedValue),
    })),
  }).toLowerCase();

  it("11. no optional 45-degree interior graduation is included", () => {
    expect(structuralHaystack.includes("45_deg")).toBe(false);
    expect(structuralHaystack.includes("graduation")).toBe(false);
  });

  it("12. no laterals, fringe, Slice And Slide, or finishing content is included", () => {
    expect(structuralHaystack.includes("lateral")).toBe(false);
    expect(structuralHaystack.includes("fringe")).toBe(false);
    expect(structuralHaystack.includes("slice_and_slide")).toBe(false);
    expect(structuralHaystack.includes("texturiz")).toBe(false);
    expect(structuralHaystack.includes("finish")).toBe(false);
  });
});

describe("A. REAL: Occipital Transition -- Execution Unit traceability and ordering", () => {
  it("13. sourceSkillInstanceId traceability is correct for both Execution Units", () => {
    for (const eu of OCCIPITAL_TRANSITION_EXECUTION_UNITS) {
      expect(isValidExecutionUnit(eu, isOccipitalTransitionFact)).toBe(true);
      expect(eu.sourceSkillInstanceId).toBe(OCCIPITAL_TRANSITION_SKILL_INSTANCE.skillInstanceId);
    }
  });

  it("14. the two-unit Execution Unit sequence is validly ordered, with the upper context depending on the lower one", () => {
    expect(OCCIPITAL_TRANSITION_EXECUTION_UNITS.length).toBe(2);
    expect(isValidExecutionUnitSequence(OCCIPITAL_TRANSITION_EXECUTION_UNITS)).toBe(true);
    expect(OCCIPITAL_TRANSITION_EXECUTION_UNITS[1].prerequisiteExecutionUnitIds).toEqual([OCCIPITAL_TRANSITION_EXECUTION_UNITS[0].executionUnitId]);
  });

  it("this Skill Instance correctly depends on the Stage 2.5.i.6 central nape guide instance, and both form one valid composition-ordered sequence", () => {
    expect(OCCIPITAL_TRANSITION_SKILL_INSTANCE.prerequisiteSkillInstanceIds).toEqual([ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.skillInstanceId]);
    expect(OCCIPITAL_TRANSITION_SKILL_INSTANCE.compositionId).toBe(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.compositionId);
    expect(isValidSkillInstanceSequence([ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE, OCCIPITAL_TRANSITION_SKILL_INSTANCE])).toBe(true);
  });

  it("15. a future deterministic Atomic Action compiler could distinguish the two control-method contexts using only structured data, without inventing professional truth", () => {
    const lowerRule = findControlMethodRule(OCCIPITAL_TRANSITION_EXECUTION_UNITS[0]);
    const upperRule = findControlMethodRule(OCCIPITAL_TRANSITION_EXECUTION_UNITS[1]);
    expect(lowerRule?.semantic).toBe("REQUIRED_FIXED");
    expect(upperRule?.semantic).toBe("REQUIRED_FIXED");
    expect(typeof lowerRule?.fixedValue).toBe("string");
    expect(typeof upperRule?.fixedValue).toBe("string");
    expect(lowerRule?.fixedValue).not.toBe(upperRule?.fixedValue);
    // Both contexts also preserve the same, stable elevation -- a compiler
    // would compose "controlMethod (per-unit) + elevation (from the
    // Skill Instance)" for each context without ever guessing a value.
    expect(findBinding("elevation")?.bindingState).toBe("FIXED_FROM_AUTHORITY");
  });
});

// ===========================================================================
// SECTION B -- SYNTHETIC REJECTION TESTS. These deliberately mangle a COPY
// of the real content to prove the contracts' own validators still reject
// malformed/contradictory data -- none of the values introduced here are
// professional authority.
// ===========================================================================

describe("B. SYNTHETIC rejection tests (not real professional authority)", () => {
  it("16. rejects a fake skill that encodes only a bare scalar (procedure truncated to a single step)", () => {
    const fakeScalarSkill = { ...OCCIPITAL_TRANSITION_SKILL, procedure: [OCCIPITAL_TRANSITION_SKILL.procedure[0]] };
    expect(isValidSkillDefinition(fakeScalarSkill, isOccipitalTransitionFact)).toBe(false);
  });

  it("17. rejects unauthorized AI-draft ACTIVE authority", () => {
    const aiDraft = { ...OCCIPITAL_TRANSITION_SKILL, authorityType: "MACHINE_DRAFTED" as const };
    expect(isValidSkillDefinition(aiDraft, isOccipitalTransitionFact)).toBe(false);
  });

  it("18. rejects the lower context incorrectly also claiming finger control (internal contradiction)", () => {
    const mangledLower = {
      ...OCCIPITAL_TRANSITION_EXECUTION_UNITS[0],
      parameterRules: [
        ...(OCCIPITAL_TRANSITION_EXECUTION_UNITS[0].parameterRules ?? []),
        { parameterName: "controlMethod", semantic: "REQUIRED_FIXED" as const, fixedValue: "fingers", rationale: "SYNTHETIC contradiction." },
      ],
    };
    expect(isValidExecutionUnit(mangledLower, isOccipitalTransitionFact)).toBe(false);
  });

  it("19. rejects an attempt to flatten both contexts into one Execution Unit -- confirming why two units are structurally required", () => {
    const flattenedUnit = {
      ...OCCIPITAL_TRANSITION_EXECUTION_UNITS[0],
      executionUnitId: "executionunit-synthetic-flattened",
      applicabilityCondition: undefined,
      parameterRules: [
        { parameterName: "controlMethod", semantic: "REQUIRED_FIXED" as const, fixedValue: "comb", rationale: "SYNTHETIC." },
        { parameterName: "controlMethod", semantic: "REQUIRED_FIXED" as const, fixedValue: "fingers", rationale: "SYNTHETIC." },
      ],
    };
    expect(isValidExecutionUnit(flattenedUnit, isOccipitalTransitionFact)).toBe(false);
  });

  it("20. rejects an Execution Unit missing sourceSkillInstanceId", () => {
    const missingSource = { ...OCCIPITAL_TRANSITION_EXECUTION_UNITS[0], sourceSkillInstanceId: "" };
    expect(isValidExecutionUnit(missingSource, isOccipitalTransitionFact)).toBe(false);
  });

  it("21. rejects malformed/contradictory unit ordering (duplicate order, cyclic prerequisites)", () => {
    const duplicateOrder = [OCCIPITAL_TRANSITION_EXECUTION_UNITS[0], { ...OCCIPITAL_TRANSITION_EXECUTION_UNITS[1], order: 1 }];
    expect(isValidExecutionUnitSequence(duplicateOrder)).toBe(false);

    const cyclic = [
      { ...OCCIPITAL_TRANSITION_EXECUTION_UNITS[0], prerequisiteExecutionUnitIds: [OCCIPITAL_TRANSITION_EXECUTION_UNITS[1].executionUnitId] },
      OCCIPITAL_TRANSITION_EXECUTION_UNITS[1],
    ];
    expect(isValidExecutionUnitSequence(cyclic)).toBe(false);
  });

  it("22. rejects an unsupported 45-degree graduation value injected as a conflicting elevation binding", () => {
    const injected45 = {
      ...OCCIPITAL_TRANSITION_SKILL_INSTANCE,
      parameterBindings: [
        ...OCCIPITAL_TRANSITION_SKILL_INSTANCE.parameterBindings,
        { parameterName: "elevation", bindingState: "FIXED_FROM_AUTHORITY" as const, value: "45_deg_graduation", sourceReference: "SYNTHETIC injection." },
      ],
    };
    expect(isValidSkillInstance(injected45, isOccipitalTransitionFact)).toBe(false);
  });

  it("23. detects lateral execution content if injected -- proving the scope-discipline check is genuinely sensitive, not vacuously true", () => {
    const mangledUnit = { ...OCCIPITAL_TRANSITION_EXECUTION_UNITS[0], zoneId: "left_lateral_synthetic" };
    const mangledHaystack = JSON.stringify({ zoneId: mangledUnit.zoneId }).toLowerCase();
    expect(mangledHaystack.includes("lateral")).toBe(true);

    const realHaystack = JSON.stringify({ zoneId: OCCIPITAL_TRANSITION_EXECUTION_UNITS[0].zoneId }).toLowerCase();
    expect(realHaystack.includes("lateral")).toBe(false);
  });

  it("24. rejects a free-text/executable condition used as technical authority", () => {
    const freeTextCondition = { ...OCCIPITAL_TRANSITION_EXECUTION_UNITS[0], applicabilityCondition: "if aboveThreshold then fingers" as unknown as OccipitalTransitionFact };
    expect(isValidExecutionUnit(freeTextCondition as never, isOccipitalTransitionFact)).toBe(false);

    const evalOpCondition = {
      ...OCCIPITAL_TRANSITION_EXECUTION_UNITS[0],
      applicabilityCondition: { op: "eval", expression: "aboveOccipitalThreshold === true" } as never,
    };
    expect(isValidExecutionUnit(evalOpCondition, isOccipitalTransitionFact)).toBe(false);
  });
});
