import { describe, expect, it } from "vitest";

import { compileExecutionUnitToAtomicActions, type AtomicActionCompilationSuccess } from "@/lib/cutting-skill-atomic-action-compiler";
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
import { deriveDemonstrationRequirementsFromAtomicAction, type DemonstrationRequirementDerivationResult } from "@/lib/cutting-skill-demonstration-requirement-deriver";
import { isValidDemonstrationRequirement, type DemonstrationRequirement } from "@/lib/professional-skill-demonstration-requirement-contracts";
import type { AtomicAction } from "@/lib/professional-skill-atomic-action-contracts";

const COMPILED_AT = "2026-09-08T00:00:00.000Z";
const DERIVED_AT = "2026-09-08T00:00:00.000Z";

function compileNapeGuideActions(): readonly AtomicAction[] {
  const result = compileExecutionUnitToAtomicActions(
    ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
    ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
    ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
    isEstablishCentralNapeGuideFact,
    COMPILED_AT,
  ) as AtomicActionCompilationSuccess;
  return result.actions;
}

function compileOccipitalActions(euIndex: 0 | 1): readonly AtomicAction[] {
  const result = compileExecutionUnitToAtomicActions(
    OCCIPITAL_TRANSITION_SKILL,
    OCCIPITAL_TRANSITION_SKILL_INSTANCE,
    OCCIPITAL_TRANSITION_EXECUTION_UNITS[euIndex],
    isOccipitalTransitionFact,
    COMPILED_AT,
  ) as AtomicActionCompilationSuccess;
  return result.actions;
}

function deriveNapeGuide(action: AtomicAction) {
  return deriveDemonstrationRequirementsFromAtomicAction(
    action,
    ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
    ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
    isEstablishCentralNapeGuideFact,
    DERIVED_AT,
  );
}

function deriveOccipital(action: AtomicAction, euIndex: 0 | 1) {
  return deriveDemonstrationRequirementsFromAtomicAction(
    action,
    OCCIPITAL_TRANSITION_SKILL_INSTANCE,
    OCCIPITAL_TRANSITION_EXECUTION_UNITS[euIndex],
    isOccipitalTransitionFact,
    DERIVED_AT,
  );
}

function requirementsOf(result: DemonstrationRequirementDerivationResult): readonly DemonstrationRequirement[] {
  return result.status === "DERIVED" ? result.requirements : [];
}

const napeGuideActions = compileNapeGuideActions();
const occipitalLowerActions = compileOccipitalActions(0);
const occipitalUpperActions = compileOccipitalActions(1);

const napeGuideDerivations = napeGuideActions.map((a) => deriveNapeGuide(a));
const occipitalLowerDerivations = occipitalLowerActions.map((a) => deriveOccipital(a, 0));
const occipitalUpperDerivations = occipitalUpperActions.map((a) => deriveOccipital(a, 1));

const allRealRequirements = [...napeGuideDerivations, ...occipitalLowerDerivations, ...occipitalUpperDerivations].flatMap(requirementsOf);

// ===========================================================================
// SECTION A -- REAL AUTHORITY DERIVATION. Every assertion derives from the
// ACTUAL Stage 2.5.i.6 / Stage 2.5.i.7 real Skills, compiled through the
// ACTUAL Stage 2.5.i.8 compiler.
// ===========================================================================

describe("A. REAL: Central Nape Guide requirement derivation", () => {
  it("1. real Atomic Actions derive successfully", () => {
    expect(napeGuideActions.length).toBeGreaterThan(0);
    for (const result of napeGuideDerivations) {
      expect(result.status).toBe("DERIVED");
    }
  });

  it("2. every requirement points to its exact source Atomic Action, and each is independently valid", () => {
    for (let i = 0; i < napeGuideActions.length; i += 1) {
      const requirements = requirementsOf(napeGuideDerivations[i]);
      for (const requirement of requirements) {
        expect(requirement.sourceAtomicActionId).toBe(napeGuideActions[i].atomicActionId);
        expect(isValidDemonstrationRequirement(requirement, isEstablishCentralNapeGuideFact)).toBe(true);
      }
    }
  });

  it("7. straight-shear tool visibility derives only on the EXECUTE action, where tool is actually bound", () => {
    const executeAction = napeGuideActions.find((a) => a.actionKind === "EXECUTE")!;
    const requirements = requirementsOf(deriveNapeGuide(executeAction));
    const toolRequirement = requirements.find((r) => r.subjectParameterNames.includes("tool"));
    expect(toolRequirement?.category).toBe("TOOL_TO_SUBJECT_RELATIONSHIP");
    expect(toolRequirement?.subjectValue).toBe("straight_shear");

    const controlAction = napeGuideActions.find((a) => a.actionKind === "CONTROL")!;
    const controlRequirements = requirementsOf(deriveNapeGuide(controlAction));
    expect(controlRequirements.some((r) => r.subjectParameterNames.includes("tool"))).toBe(false);
  });

  it("8. cutting-line visibility derives only where relevant and structured", () => {
    const executeAction = napeGuideActions.find((a) => a.actionKind === "EXECUTE")!;
    const requirements = requirementsOf(deriveNapeGuide(executeAction));
    const lineRequirement = requirements.find((r) => r.category === "RESULTING_LINE_OR_FORM");
    expect(lineRequirement?.subjectValue).toBe("straight");
  });

  it("11. head-position readability derives only on the POSITION action", () => {
    const positionAction = napeGuideActions.find((a) => a.actionKind === "POSITION")!;
    const requirements = requirementsOf(deriveNapeGuide(positionAction));
    const positionRequirement = requirements.find((r) => r.category === "SUBJECT_POSITION_STATE");
    expect(positionRequirement?.subjectValue).toBe("tilted_forward_down");

    const executeAction = napeGuideActions.find((a) => a.actionKind === "EXECUTE")!;
    const executeRequirements = requirementsOf(deriveNapeGuide(executeAction));
    expect(executeRequirements.some((r) => r.category === "SUBJECT_POSITION_STATE")).toBe(false);
  });
});

describe("A. REAL: Occipital Transition requirement derivation -- two distinguishable contexts", () => {
  it("1. both real Execution Units' Atomic Actions derive successfully", () => {
    for (const result of [...occipitalLowerDerivations, ...occipitalUpperDerivations]) {
      expect(result.status).toBe("DERIVED");
    }
  });

  it("3. COMB control derives a comb-to-strand visibility relationship", () => {
    const controlAction = occipitalLowerActions.find((a) => a.actionKind === "CONTROL")!;
    const requirements = requirementsOf(deriveOccipital(controlAction, 0));
    const controlRequirement = requirements.find((r) => r.category === "TOOL_TO_SUBJECT_RELATIONSHIP");
    expect(controlRequirement?.subjectValue).toBe("comb");
  });

  it("4. FINGERS control derives a fingers-to-strand visibility relationship", () => {
    const controlAction = occipitalUpperActions.find((a) => a.actionKind === "CONTROL")!;
    const requirements = requirementsOf(deriveOccipital(controlAction, 1));
    const controlRequirement = requirements.find((r) => r.category === "TOOL_TO_SUBJECT_RELATIONSHIP");
    expect(controlRequirement?.subjectValue).toBe("fingers");
  });

  it("5. COMB and FINGERS requirements remain structurally different -- never flattened", () => {
    const lowerControl = requirementsOf(deriveOccipital(occipitalLowerActions.find((a) => a.actionKind === "CONTROL")!, 0)).find(
      (r) => r.category === "TOOL_TO_SUBJECT_RELATIONSHIP",
    );
    const upperControl = requirementsOf(deriveOccipital(occipitalUpperActions.find((a) => a.actionKind === "CONTROL")!, 1)).find(
      (r) => r.category === "TOOL_TO_SUBJECT_RELATIONSHIP",
    );
    expect(lowerControl?.subjectValue).not.toBe(upperControl?.subjectValue);
    expect([lowerControl?.subjectValue, upperControl?.subjectValue]).not.toContain("comb_and_fingers");
  });

  it("6. zero-degree elevation derives only a visibility/readability requirement, never a camera angle", () => {
    const executeAction = occipitalLowerActions.find((a) => a.actionKind === "EXECUTE")!;
    const requirements = requirementsOf(deriveOccipital(executeAction, 0));
    const geometryRequirement = requirements.find((r) => r.category === "SUBJECT_TO_REFERENCE_GEOMETRY");
    expect(geometryRequirement?.subjectValue).toBe("0_deg_blunt");
    expect(JSON.stringify(geometryRequirement).toLowerCase()).not.toMatch(/front|back|profile|angle|camera/);
  });

  it("7. tool visibility does NOT derive for Occipital Transition -- tool is not one of this Skill's declared parameters", () => {
    const executeAction = occipitalLowerActions.find((a) => a.actionKind === "EXECUTE")!;
    const requirements = requirementsOf(deriveOccipital(executeAction, 0));
    expect(requirements.some((r) => r.subjectParameterNames.includes("tool"))).toBe(false);
  });

  it("8. cutting-line visibility does NOT derive for Occipital Transition -- cuttingLineShape is not declared here", () => {
    const executeAction = occipitalLowerActions.find((a) => a.actionKind === "EXECUTE")!;
    const requirements = requirementsOf(deriveOccipital(executeAction, 0));
    expect(requirements.some((r) => r.category === "RESULTING_LINE_OR_FORM")).toBe(false);
  });

  it("9. anatomical context visibility preserves the typed, boolean anatomical condition", () => {
    const anyLowerAction = occipitalLowerActions[0];
    const anyUpperAction = occipitalUpperActions[0];
    const lowerAnatomical = requirementsOf(deriveOccipital(anyLowerAction, 0)).find((r) => r.category === "ANATOMICAL_CONTEXT");
    const upperAnatomical = requirementsOf(deriveOccipital(anyUpperAction, 1)).find((r) => r.category === "ANATOMICAL_CONTEXT");
    expect(lowerAnatomical?.condition).toEqual({ op: "equals", fact: "aboveOccipitalThreshold", value: false });
    expect(upperAnatomical?.condition).toEqual({ op: "equals", fact: "aboveOccipitalThreshold", value: true });
    expect(lowerAnatomical?.subjectValue).toBe("posterior_below_occipital");
    expect(upperAnatomical?.subjectValue).toBe("occipital_and_above");
  });

  it("10. no numeric anatomy coordinate is ever invented", () => {
    for (const requirement of allRealRequirements) {
      if (requirement.condition && requirement.condition.op === "equals") {
        expect(typeof requirement.condition.value).toBe("boolean");
      }
    }
  });

  it("11. head-position readability derives only where the POSITION action actually binds it", () => {
    const positionAction = occipitalLowerActions.find((a) => a.actionKind === "POSITION")!;
    const requirements = requirementsOf(deriveOccipital(positionAction, 0));
    expect(requirements.find((r) => r.category === "SUBJECT_POSITION_STATE")?.subjectValue).toBe("tilted_forward_down");
  });
});

describe("A. REAL: no camera, timing, provider, or observation content anywhere in real output", () => {
  const haystack = JSON.stringify(allRealRequirements).toLowerCase();

  it("12-13. no camera angle or shot type is generated", () => {
    for (const term of ["front_view", "back_view", "close-up", "closeup", "medium_shot", "wide_shot", "camera", "shot_type"]) {
      expect(haystack.includes(term)).toBe(false);
    }
  });

  it("14. no duration/timing is generated", () => {
    for (const term of ["second", "duration", "millisecond", "pacing", "framecount"]) {
      expect(haystack.includes(term)).toBe(false);
    }
  });

  it("15. no provider detail is generated", () => {
    // Word-boundary match for "veo" -- a bare substring check false-
    // positives on "abo-VEO-ccipitalThreshold" (an honest anatomical
    // condition fact, not the Veo provider name).
    expect(/\bveo\b/.test(haystack)).toBe(false);
    for (const term of ["prompt", "aspectratio", "seed", "resolution"]) {
      expect(haystack.includes(term)).toBe(false);
    }
  });

  it("16. no requirement ever claims a runtime observation", () => {
    for (const requirement of allRealRequirements) {
      expect("observationCriterion" in requirement).toBe(false);
      expect("evidenceStatus" in requirement).toBe(false);
    }
  });

  it("17. no free-text field is ever read for a technical value", () => {
    const mangledInstance = {
      ...ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      parameterBindings: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.map((b) => ({
        ...b,
        sourceReference: "SYNTHETIC garbage prose claiming controlMethod=fingers and tool=razor",
      })),
    };
    const mangledUnit = { ...ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0], label: "SYNTHETIC garbage label", description: "SYNTHETIC garbage description" };
    const controlAction = napeGuideActions.find((a) => a.actionKind === "CONTROL")!;

    const real = requirementsOf(deriveNapeGuide(controlAction));
    const withGarbageProse = requirementsOf(
      deriveDemonstrationRequirementsFromAtomicAction(controlAction, mangledInstance, mangledUnit, isEstablishCentralNapeGuideFact, DERIVED_AT),
    );

    const technicalShape = (r: DemonstrationRequirement) => ({ category: r.category, subjectValue: r.subjectValue, subjectParameterNames: [...r.subjectParameterNames].sort() });
    expect(withGarbageProse.map(technicalShape)).toEqual(real.map(technicalShape));
  });

  it("18. duplicate requirements are normalized deterministically", () => {
    const controlAction = napeGuideActions.find((a) => a.actionKind === "CONTROL")!;
    const requirements = requirementsOf(deriveNapeGuide(controlAction));
    const keys = requirements.map((r) => `${r.category}::${String(r.subjectValue)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("19. the full provenance chain remains reconstructible from any real requirement", () => {
    const requirement = allRealRequirements[0];
    const sourceAction = [...napeGuideActions, ...occipitalLowerActions, ...occipitalUpperActions].find(
      (a) => a.atomicActionId === requirement.sourceAtomicActionId,
    )!;
    expect(sourceAction).toBeDefined();
    expect(sourceAction.sourceSkillId.length).toBeGreaterThan(0);
    expect(sourceAction.sourceSkillVersion).toBeGreaterThanOrEqual(1);
  });

  it("20. every real requirement carries enough structure for a future VideoInstruction to consume without prose", () => {
    for (const requirement of allRealRequirements) {
      expect(requirement.category.length).toBeGreaterThan(0);
      expect(requirement.subjectParameterNames.length).toBeGreaterThan(0);
      expect(requirement.sourceAtomicActionId.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// SECTION B -- SYNTHETIC / FAIL-CLOSED. Deliberately mangled inputs; none
// of the values here are professional authority.
// ===========================================================================

describe("B. SYNTHETIC / FAIL-CLOSED rejection tests", () => {
  it("21. rejects a malformed/invalid source Atomic Action", () => {
    const malformed = { ...napeGuideActions[0], atomicActionId: "" };
    const result = deriveDemonstrationRequirementsFromAtomicAction(
      malformed,
      ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
      isEstablishCentralNapeGuideFact,
      DERIVED_AT,
    );
    expect(result.status).toBe("NON_DERIVABLE");
  });

  it("22. a synthetic, fabricated Atomic Action never gains more visibility authority than it explicitly declares", () => {
    const syntheticAction: AtomicAction = {
      atomicActionId: "aa-synthetic-fabricated",
      vertical: "cutting",
      order: 1,
      actionKind: "CONTROL",
      sourceExecutionUnitId: ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0].executionUnitId,
      sourceSkillId: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.sourceSkillId,
      sourceSkillVersion: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.sourceSkillVersion,
      boundParameterNames: ["controlMethod"],
      presentationSummary: "SYNTHETIC fabricated action.",
      compiledAt: COMPILED_AT,
    };
    const result = deriveDemonstrationRequirementsFromAtomicAction(
      syntheticAction,
      ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
      isEstablishCentralNapeGuideFact,
      DERIVED_AT,
    );
    // Only ONE requirement (controlMethod) plus the always-present
    // anatomical-context requirement -- never more than what the action's
    // own declared boundParameterNames + the Execution Unit's own zoneId
    // structurally justify.
    expect(requirementsOf(result).length).toBe(2);
    expect(requirementsOf(result).every((r) => r.category === "TOOL_TO_SUBJECT_RELATIONSHIP" || r.category === "ANATOMICAL_CONTEXT")).toBe(true);
  });

  it("23. a free-text-only technical claim never substitutes for a missing structured value", () => {
    const strippedInstance = {
      ...ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      parameterBindings: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.map((b) =>
        b.parameterName === "tool"
          ? { parameterName: "tool", bindingState: "UNRESOLVED" as const, sourceReference: "SYNTHETIC prose claiming tool is straight_shear" }
          : b,
      ),
    };
    const executeAction = napeGuideActions.find((a) => a.actionKind === "EXECUTE")!;
    const result = deriveDemonstrationRequirementsFromAtomicAction(
      executeAction,
      strippedInstance,
      ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
      isEstablishCentralNapeGuideFact,
      DERIVED_AT,
    );
    expect(requirementsOf(result).some((r) => r.subjectParameterNames.includes("tool"))).toBe(false);
  });

  it("24. missing control method cannot produce a control-relationship visibility requirement", () => {
    const strippedUnit = { ...OCCIPITAL_TRANSITION_EXECUTION_UNITS[0], parameterRules: [] };
    const syntheticAction: AtomicAction = {
      atomicActionId: "aa-synthetic-missing-control",
      vertical: "cutting",
      order: 1,
      actionKind: "CONTROL",
      sourceExecutionUnitId: strippedUnit.executionUnitId,
      sourceSkillId: OCCIPITAL_TRANSITION_SKILL_INSTANCE.sourceSkillId,
      sourceSkillVersion: OCCIPITAL_TRANSITION_SKILL_INSTANCE.sourceSkillVersion,
      boundParameterNames: ["controlMethod"],
      presentationSummary: "SYNTHETIC.",
      compiledAt: COMPILED_AT,
    };
    const result = deriveDemonstrationRequirementsFromAtomicAction(
      syntheticAction,
      OCCIPITAL_TRANSITION_SKILL_INSTANCE,
      strippedUnit,
      isOccipitalTransitionFact,
      DERIVED_AT,
    );
    expect(requirementsOf(result).some((r) => r.category === "TOOL_TO_SUBJECT_RELATIONSHIP")).toBe(false);
  });

  it("25. an unrecognized bound parameter name never invents a guessed visual requirement", () => {
    const controlAction = napeGuideActions.find((a) => a.actionKind === "CONTROL")!;
    const withExtraName = { ...controlAction, boundParameterNames: [...(controlAction.boundParameterNames ?? []), "syntheticUnknownParam"] };
    const real = requirementsOf(deriveNapeGuide(controlAction));
    const withExtra = requirementsOf(deriveNapeGuide(withExtraName));
    expect(withExtra.length).toBe(real.length);
  });

  it("26. lower and upper contexts cannot collapse into the same control relationship when derived independently", () => {
    const lower = requirementsOf(deriveOccipital(occipitalLowerActions.find((a) => a.actionKind === "CONTROL")!, 0));
    const upper = requirementsOf(deriveOccipital(occipitalUpperActions.find((a) => a.actionKind === "CONTROL")!, 1));
    const lowerValues = lower.map((r) => r.subjectValue);
    const upperValues = upper.map((r) => r.subjectValue);
    expect(lowerValues).not.toEqual(upperValues);
  });

  it("27-28-29. the universal contract type has no camera, timing, or observation field at all", () => {
    const requirement = allRealRequirements[0];
    const keys = Object.keys(requirement);
    for (const forbidden of ["camera", "viewpoint", "shot", "duration", "seconds", "observation", "evidenceStatus"]) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });

  it("30. haircut-specific vocabulary never leaks into the universal category enum", () => {
    for (const requirement of allRealRequirements) {
      expect(["TOOL_TO_SUBJECT_RELATIONSHIP", "SUBJECT_TO_REFERENCE_GEOMETRY", "RESULTING_LINE_OR_FORM", "ANATOMICAL_CONTEXT", "SUBJECT_POSITION_STATE"]).toContain(
        requirement.category,
      );
    }
  });
});
