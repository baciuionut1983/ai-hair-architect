import { describe, expect, it } from "vitest";

import { isValidAtomicAction, isValidAtomicActionSequence } from "@/lib/professional-skill-atomic-action-contracts";
import {
  ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
  isEstablishCentralNapeGuideFact,
} from "@/lib/cutting-skill-establish-central-nape-guide";
import {
  isOccipitalTransitionFact,
  OCCIPITAL_TRANSITION_EXECUTION_UNITS,
  OCCIPITAL_TRANSITION_SKILL,
  OCCIPITAL_TRANSITION_SKILL_INSTANCE,
} from "@/lib/cutting-skill-occipital-transition";
import { compileExecutionUnitToAtomicActions, type AtomicActionCompilationSuccess } from "@/lib/cutting-skill-atomic-action-compiler";

const COMPILED_AT = "2026-09-08T00:00:00.000Z";

function compileNapeGuide() {
  return compileExecutionUnitToAtomicActions(
    ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
    ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
    ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
    isEstablishCentralNapeGuideFact,
    COMPILED_AT,
  );
}

function compileOccipitalLower() {
  return compileExecutionUnitToAtomicActions(
    OCCIPITAL_TRANSITION_SKILL,
    OCCIPITAL_TRANSITION_SKILL_INSTANCE,
    OCCIPITAL_TRANSITION_EXECUTION_UNITS[0],
    isOccipitalTransitionFact,
    COMPILED_AT,
  );
}

function compileOccipitalUpper() {
  return compileExecutionUnitToAtomicActions(
    OCCIPITAL_TRANSITION_SKILL,
    OCCIPITAL_TRANSITION_SKILL_INSTANCE,
    OCCIPITAL_TRANSITION_EXECUTION_UNITS[1],
    isOccipitalTransitionFact,
    COMPILED_AT,
  );
}

function findBoundParam(action: { boundParameterNames?: readonly string[] }, name: string): boolean {
  return (action.boundParameterNames ?? []).includes(name);
}

// ===========================================================================
// SECTION A -- REAL PROFESSIONAL AUTHORITY. Every assertion compiles the
// ACTUAL Stage 2.5.i.6 / Stage 2.5.i.7 content -- no synthetic Skill is
// authored here.
// ===========================================================================

describe("A. REAL: Central Nape Guide compilation", () => {
  it("1. compiles successfully", () => {
    const result = compileNapeGuide();
    expect(result.status).toBe("COMPILED");
  });

  it("2. compiled actions point to the correct sourceExecutionUnitId, and each is independently a valid Atomic Action + sequence", () => {
    const result = compileNapeGuide() as AtomicActionCompilationSuccess;
    for (const action of result.actions) {
      expect(action.sourceExecutionUnitId).toBe(ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0].executionUnitId);
      expect(isValidAtomicAction(action, isEstablishCentralNapeGuideFact)).toBe(true);
    }
    expect(isValidAtomicActionSequence(result.actions)).toBe(true);
  });

  it("3-4. no professional fact outside authorized structured content appears, and no free-text field is ever read for a technical value", () => {
    const real = compileNapeGuide() as AtomicActionCompilationSuccess;

    const mangledUnit = {
      ...ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
      label: "SYNTHETIC garbage label, e.g. claiming controlMethod=fingers here",
      description: "SYNTHETIC garbage description claiming elevation=45_deg_graduation and tool=razor",
    };
    const mangledInstance = {
      ...ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      parameterBindings: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.map((b) => ({
        ...b,
        sourceReference: "SYNTHETIC garbage prose, not a technical value",
      })),
    };
    const withGarbageProse = compileExecutionUnitToAtomicActions(
      ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
      mangledInstance,
      mangledUnit,
      isEstablishCentralNapeGuideFact,
      COMPILED_AT,
    ) as AtomicActionCompilationSuccess;

    expect(withGarbageProse.status).toBe("COMPILED");
    // Technical fields are byte-identical regardless of prose mutation --
    // only presentationSummary (itself presentation-only, reusing eu.label)
    // is excluded from this comparison.
    const technicalShape = (a: (typeof real.actions)[number]) => ({
      actionKind: a.actionKind,
      boundParameterNames: [...(a.boundParameterNames ?? [])].sort(),
      sourceExecutionUnitId: a.sourceExecutionUnitId,
      sourceSkillId: a.sourceSkillId,
      sourceSkillVersion: a.sourceSkillVersion,
      precondition: a.precondition,
    });
    expect(withGarbageProse.actions.map(technicalShape)).toEqual(real.actions.map(technicalShape));
  });

  it("5. wet-hair state is preserved structurally (bound as context on the CONTROL action)", () => {
    const result = compileNapeGuide() as AtomicActionCompilationSuccess;
    const control = result.actions.find((a) => a.actionKind === "CONTROL");
    expect(control && findBoundParam(control, "hairState")).toBe(true);
    expect(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === "hairState")?.value).toBe("wet");
  });

  it("6. head-forward state is preserved structurally (bound on the POSITION action)", () => {
    const result = compileNapeGuide() as AtomicActionCompilationSuccess;
    const position = result.actions.find((a) => a.actionKind === "POSITION");
    expect(position && findBoundParam(position, "clientHeadPosition")).toBe(true);
    expect(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === "clientHeadPosition")?.value).toBe(
      "tilted_forward_down",
    );
  });

  it("7. zero-degree elevation is preserved structurally (bound on the EXECUTE action)", () => {
    const result = compileNapeGuide() as AtomicActionCompilationSuccess;
    const execute = result.actions.find((a) => a.actionKind === "EXECUTE");
    expect(execute && findBoundParam(execute, "elevation")).toBe(true);
    expect(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === "elevation")?.value).toBe("0_deg_blunt");
  });

  it("8. comb control is preserved structurally (bound on the CONTROL action)", () => {
    const result = compileNapeGuide() as AtomicActionCompilationSuccess;
    const control = result.actions.find((a) => a.actionKind === "CONTROL");
    expect(control && findBoundParam(control, "controlMethod")).toBe(true);
    // controlMethod is only ever a NAME reference on the compiled action --
    // the real value lives on the source Skill Instance binding (stable
    // for this Skill, unlike Occipital Transition's per-Execution-Unit
    // binding).
    expect(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === "controlMethod")?.value).toBe("comb");
  });

  it("9. straight-shear tool is preserved structurally where the EXECUTE action requires it", () => {
    const result = compileNapeGuide() as AtomicActionCompilationSuccess;
    const execute = result.actions.find((a) => a.actionKind === "EXECUTE");
    expect(execute && findBoundParam(execute, "tool")).toBe(true);
    expect(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === "tool")?.value).toBe("straight_shear");
  });

  it("10. cutting-line, elevation, strand-direction, and shear-orientation remain four structurally distinct bound references", () => {
    const result = compileNapeGuide() as AtomicActionCompilationSuccess;
    const execute = result.actions.find((a) => a.actionKind === "EXECUTE");
    for (const name of ["elevation", "cuttingLineShape", "distribution", "shearOrientation"]) {
      expect(execute && findBoundParam(execute, name)).toBe(true);
    }
    expect(new Set(["elevation", "cuttingLineShape", "distribution", "shearOrientation"]).size).toBe(4);
  });
});

describe("A. REAL: Occipital Transition compilation -- two distinguishable contexts", () => {
  it("11-12. the lower posterior unit compiles, with COMB control", () => {
    const result = compileOccipitalLower() as AtomicActionCompilationSuccess;
    expect(result.status).toBe("COMPILED");
    const control = result.actions.find((a) => a.actionKind === "CONTROL");
    expect(control && findBoundParam(control, "controlMethod")).toBe(true);
    const rule = OCCIPITAL_TRANSITION_EXECUTION_UNITS[0].parameterRules?.find((r) => r.parameterName === "controlMethod");
    expect(rule?.fixedValue).toBe("comb");
  });

  it("13-14. the occipital/upper unit compiles, with FINGERS control", () => {
    const result = compileOccipitalUpper() as AtomicActionCompilationSuccess;
    expect(result.status).toBe("COMPILED");
    const control = result.actions.find((a) => a.actionKind === "CONTROL");
    expect(control && findBoundParam(control, "controlMethod")).toBe(true);
    const rule = OCCIPITAL_TRANSITION_EXECUTION_UNITS[1].parameterRules?.find((r) => r.parameterName === "controlMethod");
    expect(rule?.fixedValue).toBe("fingers");
  });

  it("15. lower and upper compiled action sets remain structurally different -- never flattened", () => {
    const lower = compileOccipitalLower() as AtomicActionCompilationSuccess;
    const upper = compileOccipitalUpper() as AtomicActionCompilationSuccess;
    expect(lower.actions.map((a) => a.sourceExecutionUnitId)).not.toEqual(upper.actions.map((a) => a.sourceExecutionUnitId));
    expect(lower.actions.every((a) => a.sourceExecutionUnitId === OCCIPITAL_TRANSITION_EXECUTION_UNITS[0].executionUnitId)).toBe(true);
    expect(upper.actions.every((a) => a.sourceExecutionUnitId === OCCIPITAL_TRANSITION_EXECUTION_UNITS[1].executionUnitId)).toBe(true);
    // Each forms its own valid, independent sequence -- never merged into one.
    expect(isValidAtomicActionSequence(lower.actions)).toBe(true);
    expect(isValidAtomicActionSequence(upper.actions)).toBe(true);
  });

  it("16. anatomy condition provenance is preserved on every compiled action for both contexts", () => {
    const lower = compileOccipitalLower() as AtomicActionCompilationSuccess;
    const upper = compileOccipitalUpper() as AtomicActionCompilationSuccess;
    for (const action of lower.actions) {
      expect(action.precondition).toEqual({ op: "equals", fact: "aboveOccipitalThreshold", value: false });
    }
    for (const action of upper.actions) {
      expect(action.precondition).toEqual({ op: "equals", fact: "aboveOccipitalThreshold", value: true });
    }
  });

  it("17. no numeric anatomy position is invented -- the condition value is strictly boolean", () => {
    const lower = compileOccipitalLower() as AtomicActionCompilationSuccess;
    for (const action of lower.actions) {
      const condition = action.precondition as { op: "equals"; fact: string; value: unknown } | undefined;
      expect(typeof condition?.value).toBe("boolean");
    }
  });

  it("18. the false universal rule ('0-degree One Length never held between fingers') is not introduced -- fingers and 0-degree elevation coexist successfully", () => {
    const upper = compileOccipitalUpper() as AtomicActionCompilationSuccess;
    expect(upper.status).toBe("COMPILED");
    const control = upper.actions.find((a) => a.actionKind === "CONTROL");
    const execute = upper.actions.find((a) => a.actionKind === "EXECUTE");
    expect(control && findBoundParam(control, "controlMethod")).toBe(true);
    expect(execute && findBoundParam(execute, "elevation")).toBe(true);
    expect(OCCIPITAL_TRANSITION_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === "elevation")?.value).toBe("0_deg_blunt");
  });

  it("19-20. no 45-degree graduation, laterals, fringe, Slice And Slide, or finishing content is introduced -- compiled parameter references are a subset of the real Skills' own declared parameters", () => {
    const allCompiled = [
      ...(compileNapeGuide() as AtomicActionCompilationSuccess).actions,
      ...(compileOccipitalLower() as AtomicActionCompilationSuccess).actions,
      ...(compileOccipitalUpper() as AtomicActionCompilationSuccess).actions,
    ];
    const declaredNames = new Set([
      ...ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.parameters.map((p) => p.name),
      ...OCCIPITAL_TRANSITION_SKILL.parameters.map((p) => p.name),
    ]);
    for (const action of allCompiled) {
      for (const name of action.boundParameterNames ?? []) {
        expect(declaredNames.has(name)).toBe(true);
      }
    }
    const forbidden = ["graduation45", "lateralconnection", "fringeintent", "sliceandslide"];
    const allBoundNames = allCompiled.flatMap((a) => a.boundParameterNames ?? []).map((n) => n.toLowerCase());
    for (const term of forbidden) {
      expect(allBoundNames.some((n) => n.includes(term))).toBe(false);
    }
  });

  it("21. compiled actions carry enough structure for a future VideoInstruction compiler to consume without parsing prose", () => {
    const result = compileNapeGuide() as AtomicActionCompilationSuccess;
    for (const action of result.actions) {
      expect(action.actionKind.length).toBeGreaterThan(0);
      expect((action.boundParameterNames ?? []).length).toBeGreaterThan(0);
      expect(action.sourceExecutionUnitId.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// SECTION B -- FAIL-CLOSED / SYNTHETIC REJECTIONS. These deliberately
// mangle copies of the real content to prove the compiler refuses rather
// than silently guessing -- none of the values introduced here are
// professional authority.
// ===========================================================================

describe("B. FAIL-CLOSED / SYNTHETIC rejection tests", () => {
  it("22. rejects when a required control method has no resolved value", () => {
    const strippedLower = { ...OCCIPITAL_TRANSITION_EXECUTION_UNITS[0], parameterRules: [] };
    const result = compileExecutionUnitToAtomicActions(
      OCCIPITAL_TRANSITION_SKILL,
      OCCIPITAL_TRANSITION_SKILL_INSTANCE,
      strippedLower,
      isOccipitalTransitionFact,
      COMPILED_AT,
    );
    expect(result.status).toBe("UNRESOLVED");
    expect(result.status === "UNRESOLVED" && result.missingParameterNames).toContain("controlMethod");
  });

  it("23. rejects a malformed source Execution Unit (missing sourceSkillInstanceId)", () => {
    const malformed = { ...ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0], sourceSkillInstanceId: "" };
    const result = compileExecutionUnitToAtomicActions(
      ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
      ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      malformed,
      isEstablishCentralNapeGuideFact,
      COMPILED_AT,
    );
    expect(result.status).toBe("UNRESOLVED");
  });

  it("24. rejects an Execution Unit with an unsupported/malformed condition", () => {
    const malformedCondition = {
      ...OCCIPITAL_TRANSITION_EXECUTION_UNITS[0],
      applicabilityCondition: { op: "eval", expression: "1===1" } as never,
    };
    const result = compileExecutionUnitToAtomicActions(
      OCCIPITAL_TRANSITION_SKILL,
      OCCIPITAL_TRANSITION_SKILL_INSTANCE,
      malformedCondition,
      isOccipitalTransitionFact,
      COMPILED_AT,
    );
    expect(result.status).toBe("UNRESOLVED");
  });

  it("25. rejects when a required professional binding is missing from the Skill Instance", () => {
    const strippedInstance = {
      ...ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      parameterBindings: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.filter((b) => b.parameterName !== "tool"),
    };
    const result = compileExecutionUnitToAtomicActions(
      ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
      strippedInstance,
      ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
      isEstablishCentralNapeGuideFact,
      COMPILED_AT,
    );
    expect(result.status).toBe("UNRESOLVED");
    expect(result.status === "UNRESOLVED" && result.missingParameterNames).toContain("tool");
  });

  it("26. rejects a scalar/bogus object passed where a real Execution Unit is expected", () => {
    const bogus = { parameterName: "syntheticFake", semantic: "REQUIRED_FIXED", fixedValue: "x" };
    const result = compileExecutionUnitToAtomicActions(
      ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
      ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      bogus as never,
      isEstablishCentralNapeGuideFact,
      COMPILED_AT,
    );
    expect(result.status).toBe("UNRESOLVED");
  });

  it("27. rejects unreviewed AI-draft authority even when otherwise structurally complete", () => {
    const aiDraftSkill = { ...ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL, status: "DRAFT" as const, authorityType: "MACHINE_DRAFTED" as const };
    const result = compileExecutionUnitToAtomicActions(
      aiDraftSkill,
      ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
      isEstablishCentralNapeGuideFact,
      COMPILED_AT,
    );
    expect(result.status).toBe("UNRESOLVED");
    expect(result.status === "UNRESOLVED" && result.reason).toMatch(/eligible/i);
  });

  it("28. a free-text-only technical claim never substitutes for a missing structured value", () => {
    const strippedButWithProseClaim = {
      ...ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      parameterBindings: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.map((b) =>
        b.parameterName === "elevation"
          ? { parameterName: "elevation", bindingState: "UNRESOLVED" as const, sourceReference: "SYNTHETIC prose claiming elevation is 0_deg_blunt" }
          : b,
      ),
    };
    const result = compileExecutionUnitToAtomicActions(
      ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
      strippedButWithProseClaim,
      ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
      isEstablishCentralNapeGuideFact,
      COMPILED_AT,
    );
    expect(result.status).toBe("UNRESOLVED");
    expect(result.status === "UNRESOLVED" && result.missingParameterNames).toContain("elevation");
  });

  it("29. lower and upper contexts cannot be flattened into one Execution Unit -- structurally rejected", () => {
    const flattened = {
      ...OCCIPITAL_TRANSITION_EXECUTION_UNITS[0],
      applicabilityCondition: undefined,
      parameterRules: [
        { parameterName: "controlMethod", semantic: "REQUIRED_FIXED" as const, fixedValue: "comb", rationale: "SYNTHETIC." },
        { parameterName: "controlMethod", semantic: "REQUIRED_FIXED" as const, fixedValue: "fingers", rationale: "SYNTHETIC." },
      ],
    };
    const result = compileExecutionUnitToAtomicActions(
      OCCIPITAL_TRANSITION_SKILL,
      OCCIPITAL_TRANSITION_SKILL_INSTANCE,
      flattened,
      isOccipitalTransitionFact,
      COMPILED_AT,
    );
    expect(result.status).toBe("UNRESOLVED");
  });

  it("30. no compiled Atomic Action from real content ever claims a runtime observation that never occurred", () => {
    const allCompiled = [
      ...(compileNapeGuide() as AtomicActionCompilationSuccess).actions,
      ...(compileOccipitalLower() as AtomicActionCompilationSuccess).actions,
      ...(compileOccipitalUpper() as AtomicActionCompilationSuccess).actions,
    ];
    for (const action of allCompiled) {
      expect(action.observationCriterion).toBeUndefined();
    }
  });
});
