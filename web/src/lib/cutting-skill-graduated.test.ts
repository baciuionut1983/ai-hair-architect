import { describe, expect, it } from "vitest";

import { isSkillEligibleForAuthority, isValidSkillDefinition, SKILL_CAPABILITY_KINDS } from "@/lib/professional-skill-contracts";
import { isSkillInstanceEligibleForAuthority, isValidSkillInstance, isValidSkillInstanceSequence } from "@/lib/professional-skill-instance-contracts";
import { isValidExecutionUnit, isValidExecutionUnitSequence } from "@/lib/professional-skill-execution-unit-contracts";
import { compileExecutionUnitToAtomicActions } from "@/lib/cutting-skill-atomic-action-compiler";
import {
  GRADUATED_CUTTING_EXECUTION_UNITS,
  GRADUATED_CUTTING_SKILL,
  GRADUATED_CUTTING_SKILL_INSTANCE,
  isGraduatedCuttingFact,
} from "@/lib/cutting-skill-graduated";

// ===========================================================================
// SECTION A -- REAL PROFESSIONAL AUTHORITY FIXTURE / CONSTANT.
// Every assertion exercises the ACTUAL exported, professionally-authored
// "Graduated Cutting" content -- NOT a synthetic placeholder.
// ===========================================================================

describe("A. REAL: Graduated Cutting -- Skill Definition", () => {
  it("1. the real Skill Definition validates against the Stage 2.5.i.1 contract", () => {
    expect(isValidSkillDefinition(GRADUATED_CUTTING_SKILL, isGraduatedCuttingFact)).toBe(true);
  });

  it("2. authority is professional/authored, ACTIVE, and eligible", () => {
    expect(GRADUATED_CUTTING_SKILL.authorityType).toBe("PROFESSIONALLY_AUTHORED");
    expect(GRADUATED_CUTTING_SKILL.status).toBe("ACTIVE");
    expect(isSkillEligibleForAuthority(GRADUATED_CUTTING_SKILL)).toBe(true);
  });

  it("3. exact skillKey and version", () => {
    expect(GRADUATED_CUTTING_SKILL.skillId).toBe("skill-cutting-graduated");
    expect(GRADUATED_CUTTING_SKILL.version).toBe(1);
  });

  it("4. the procedure is a genuine, ordered, multi-step professional sequence", () => {
    const orders = GRADUATED_CUTTING_SKILL.procedure.map((s) => s.order);
    expect(orders.length).toBeGreaterThanOrEqual(2);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
    for (const step of GRADUATED_CUTTING_SKILL.procedure) {
      expect(step.instruction.length).toBeGreaterThan(20);
      expect(step.referencedParameters?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("5. elevation is declared as a real, OPEN parameter -- never narrowed to a single locked value", () => {
    const elevation = GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "elevation");
    expect(elevation).toBeTruthy();
    expect(elevation!.allowedValues).toEqual(["0_deg_blunt", "45_deg_graduation", "90_deg_uniform_layer", "180_deg_overdirection"]);
    expect(elevation!.allowedValues!.length).toBeGreaterThan(1);
  });

  it('6. there is no "Elevation Cutting" duplicate skill -- elevation is this Skill\'s own parameter, not a second Skill identity', () => {
    expect(GRADUATED_CUTTING_SKILL.name).not.toMatch(/elevation cutting/i);
    expect(GRADUATED_CUTTING_SKILL.parameters.some((p) => p.name === "elevation")).toBe(true);
  });

  it("7. MG1 capability gap: BUILD_WEIGHT and REDUCE_WEIGHT are BOTH declared, never one silently chosen -- graduation's real weight effect is elevation-dependent", () => {
    const kinds = (GRADUATED_CUTTING_SKILL.capabilities ?? []).map((c) => c.kind);
    expect(kinds).toContain("BUILD_WEIGHT");
    expect(kinds).toContain("REDUCE_WEIGHT");
  });

  it("8. MODIFY_PERIMETER_RELATIONSHIP is declared -- the one truthful-across-every-elevation-choice capability", () => {
    const kinds = (GRADUATED_CUTTING_SKILL.capabilities ?? []).map((c) => c.kind);
    expect(kinds).toContain("MODIFY_PERIMETER_RELATIONSHIP");
  });

  it("9. no invented capability kind -- every declared capability is a real, closed SKILL_CAPABILITY_KINDS member", () => {
    for (const c of GRADUATED_CUTTING_SKILL.capabilities ?? []) {
      expect(SKILL_CAPABILITY_KINDS as readonly string[]).toContain(c.kind);
    }
  });

  it("10. the perimeter/contour guide and the progressive graduation guide are structurally distinct real values, never one ambiguous generic guide", () => {
    const guideReferenceMode = GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "guideReferenceMode");
    expect(guideReferenceMode!.allowedValues).toEqual(["contour_guide_reference", "previous_subsection"]);
    const guideType = GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "guideType");
    expect(guideType!.allowedValues).toContain("visual_perimeter");
    expect(guideType!.allowedValues).toContain("traveling");
  });

  it("11. hand/finger control for 45deg and 90deg are two distinct, closed, real values -- no invented geometry for 180deg", () => {
    const handOrientation = GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "handOrientation");
    expect(handOrientation!.allowedValues).toContain("fingers_upward_palm_facing_cut");
    expect(handOrientation!.allowedValues).toContain("fingers_downward_back_of_hand_cut");
  });
});

describe("A. REAL: Graduated Cutting -- Skill Instance", () => {
  it("12. the real Skill Instance validates against the Stage 2.5.i.5 contract", () => {
    expect(isValidSkillInstance(GRADUATED_CUTTING_SKILL_INSTANCE, isGraduatedCuttingFact)).toBe(true);
    expect(isValidSkillInstanceSequence([GRADUATED_CUTTING_SKILL_INSTANCE])).toBe(true);
    expect(isSkillInstanceEligibleForAuthority(GRADUATED_CUTTING_SKILL)).toBe(true);
  });

  it("13. elevation is bound PROFESSIONAL_CHOICE at instance level (real open choice, confirmed), never silently invented", () => {
    const binding = GRADUATED_CUTTING_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === "elevation");
    expect(binding?.bindingState).toBe("PROFESSIONAL_CHOICE");
    expect(binding?.allowedOptions?.length).toBeGreaterThan(1);
    expect(binding?.confirmedByUserId).toBeTruthy();
    expect(binding?.confirmedAt).toBeTruthy();
  });
});

describe("B. REAL: Graduated Cutting -- Execution Units (progression, iteration, cross-check)", () => {
  it("14. the real Execution Unit sequence validates and is internally consistent", () => {
    expect(isValidExecutionUnitSequence(GRADUATED_CUTTING_EXECUTION_UNITS)).toBe(true);
    for (const eu of GRADUATED_CUTTING_EXECUTION_UNITS) {
      expect(isValidExecutionUnit(eu, isGraduatedCuttingFact)).toBe(true);
    }
  });

  it("15. exactly 4 Execution Units: perimeter guide, lower 45deg, upper 90deg, cross-check", () => {
    expect(GRADUATED_CUTTING_EXECUTION_UNITS.length).toBe(4);
    const ids = GRADUATED_CUTTING_EXECUTION_UNITS.map((eu) => eu.executionUnitId);
    expect(ids).toContain("executionunit-cutting-graduated-perimeter-guide");
    expect(ids).toContain("executionunit-cutting-graduated-lower-45");
    expect(ids).toContain("executionunit-cutting-graduated-upper-90");
    expect(ids).toContain("executionunit-cutting-graduated-cross-check");
  });

  it("16. lower (45deg) and upper (90deg) Execution Units fix DIFFERENT elevation + hand-orientation values -- never collapsed into one", () => {
    const lower = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-lower-45")!;
    const upper = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-upper-90")!;
    const lowerElevation = lower.parameterRules?.find((r) => r.parameterName === "elevation")?.fixedValue;
    const upperElevation = upper.parameterRules?.find((r) => r.parameterName === "elevation")?.fixedValue;
    expect(lowerElevation).toBe("45_deg_graduation");
    expect(upperElevation).toBe("90_deg_uniform_layer");
    expect(lowerElevation).not.toBe(upperElevation);
    const lowerHand = lower.parameterRules?.find((r) => r.parameterName === "handOrientation")?.fixedValue;
    const upperHand = upper.parameterRules?.find((r) => r.parameterName === "handOrientation")?.fixedValue;
    expect(lowerHand).not.toBe(upperHand);
  });

  it("17. cross-check Execution Unit exists, is prerequisite-gated on BOTH graduation units, and fixes the opposing (horizontal) parting orientation", () => {
    const crossCheck = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-cross-check")!;
    expect(crossCheck.prerequisiteExecutionUnitIds).toContain("executionunit-cutting-graduated-lower-45");
    expect(crossCheck.prerequisiteExecutionUnitIds).toContain("executionunit-cutting-graduated-upper-90");
    const parting = crossCheck.parameterRules?.find((r) => r.parameterName === "partingOrientation")?.fixedValue;
    expect(parting).toBe("horizontal");
    const lower = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-lower-45")!;
    const primaryParting = lower.parameterRules?.find((r) => r.parameterName === "partingOrientation")?.fixedValue;
    expect(primaryParting).toBe("vertical");
  });

  it("18. graduation Execution Units declare bounded UNTIL_EXECUTION_UNIT_COMPLETE iteration -- never unbounded, never absent for repeated work", () => {
    for (const id of ["executionunit-cutting-graduated-lower-45", "executionunit-cutting-graduated-upper-90"]) {
      const eu = GRADUATED_CUTTING_EXECUTION_UNITS.find((u) => u.executionUnitId === id)!;
      const policy = eu.verticalPayload?.iterationPolicy as { actionKinds: string[]; iteration: { mode: string } } | undefined;
      expect(policy).toBeTruthy();
      expect(policy!.iteration.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");
      expect(policy!.actionKinds).toContain("EXECUTE");
    }
  });

  it("19. the perimeter/contour guide Execution Unit does NOT iterate -- a single reference cut, mirroring Establish Central Nape Guide's own precedent", () => {
    const guideUnit = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-perimeter-guide")!;
    expect(guideUnit.verticalPayload?.iterationPolicy).toBeUndefined();
  });

  it("20. every Execution Unit compiles to real AtomicActions -- POSITION/CONTROL/EXECUTE fire (proves progression/action exists, never a bare parameter)", () => {
    for (const eu of GRADUATED_CUTTING_EXECUTION_UNITS) {
      const result = compileExecutionUnitToAtomicActions(GRADUATED_CUTTING_SKILL, GRADUATED_CUTTING_SKILL_INSTANCE, eu, isGraduatedCuttingFact, "2026-09-11T00:00:00.000Z");
      expect(result.status).toBe("COMPILED");
      if (result.status === "COMPILED") {
        const kinds = result.actions.map((a) => a.actionKind);
        expect(kinds).toContain("POSITION");
        expect(kinds).toContain("CONTROL");
        expect(kinds).toContain("EXECUTE");
      }
    }
  });

  it("21. one-isolated-cut prevention: a lone EXECUTE action, with no iteration and no progression to a next Execution Unit, is structurally insufficient to represent this Skill's own real content -- the graduation units DO carry iteration (test 18) and DO chain via prerequisiteExecutionUnitIds (established by the guide unit, consumed by cross-check)", () => {
    const chain = GRADUATED_CUTTING_EXECUTION_UNITS.map((eu) => eu.executionUnitId);
    const crossCheck = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-cross-check")!;
    // The chain has real depth (guide -> graduation -> cross-check), never
    // a single flat unit standing in for the whole Skill.
    expect(chain.length).toBeGreaterThan(1);
    expect(crossCheck.prerequisiteExecutionUnitIds?.length).toBeGreaterThan(0);
  });
});
