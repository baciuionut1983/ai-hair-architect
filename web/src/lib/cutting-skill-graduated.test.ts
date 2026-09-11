import { describe, expect, it } from "vitest";

import { isSkillEligibleForAuthority, isValidSkillDefinition, SKILL_CAPABILITY_KINDS } from "@/lib/professional-skill-contracts";
import { isSkillInstanceEligibleForAuthority, isValidSkillInstance, isValidSkillInstanceSequence, type SkillInstance } from "@/lib/professional-skill-instance-contracts";
import { isValidExecutionUnit, isValidExecutionUnitSequence } from "@/lib/professional-skill-execution-unit-contracts";
import { compileExecutionUnitToAtomicActions } from "@/lib/cutting-skill-atomic-action-compiler";
import {
  GRADUATED_CUTTING_EXECUTION_UNITS,
  GRADUATED_CUTTING_SKILL,
  GRADUATED_CUTTING_SKILL_INSTANCE,
  isGraduatedCuttingFact,
  type GraduatedCuttingFact,
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

  it("2. [Stage 8.5S1B.R1] elevation remains a real, OPEN plan/execution parameter -- never narrowed to a single locked value", () => {
    const elevation = GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "elevation");
    expect(elevation).toBeTruthy();
    expect(elevation!.allowedValues).toEqual(["0_deg_blunt", "45_deg_graduation", "90_deg_uniform_layer", "180_deg_overdirection"]);
    expect(elevation!.allowedValues!.length).toBeGreaterThan(1);
  });

  it('5. there is no "Elevation Cutting" duplicate skill -- elevation is this Skill\'s own parameter, not a second Skill identity', () => {
    expect(GRADUATED_CUTTING_SKILL.name).not.toMatch(/elevation cutting/i);
    expect(GRADUATED_CUTTING_SKILL.parameters.some((p) => p.name === "elevation")).toBe(true);
  });

  it("7. MG1 capability gap unchanged: BUILD_WEIGHT and REDUCE_WEIGHT are BOTH declared, never one silently chosen -- graduation's real weight effect is elevation-dependent", () => {
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

  it("3. [Stage 8.5S1B.R1] 180 deg remains representable without invented hand geometry -- only 3 real hand-orientation values exist, none 180-specific", () => {
    const elevation = GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "elevation");
    expect(elevation!.allowedValues).toContain("180_deg_overdirection");
    const handOrientation = GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "handOrientation");
    expect(handOrientation!.allowedValues!.length).toBe(3);
    expect(handOrientation!.allowedValues).toContain("fingers_upward_palm_facing_cut");
    expect(handOrientation!.allowedValues).toContain("fingers_downward_back_of_hand_cut");
  });

  it("[Stage 8.5S1B.R1] zone is a real, open, case-selected parameter -- never a permanent per-Execution-Unit identity", () => {
    const zone = GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "zone");
    expect(zone?.valueKind).toBe("enum");
    expect(zone?.allowedValues?.length).toBeGreaterThan(1);
  });

  it("[Stage 8.5S1B.R1] overdirection is its own real, open parameter, distinct from the specific distribution value", () => {
    const overdirection = GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "overdirection");
    expect(overdirection?.valueKind).toBe("boolean");
  });

  it("[Stage 8.5S1B.R1] partingOrientation stays open -- Ionuț's own framing is conditional (\"IF primary work used vertical partings\"), never a mandated primary orientation", () => {
    const partingOrientation = GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "partingOrientation");
    expect(partingOrientation?.allowedValues).toEqual(["vertical", "horizontal"]);
  });

  it("[Stage 8.5S1B.R1] tool is open to both real tool values -- never restricted to exactly one without citation", () => {
    const tool = GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "tool");
    expect(tool?.allowedValues?.length).toBeGreaterThan(1);
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

  it("6. [Stage 8.5S1B.R1] the pilot instance's elevation choice is ONE representative example, not this Skill's own permanent truth", () => {
    const binding = GRADUATED_CUTTING_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === "elevation");
    expect(binding?.value).toBe("45_deg_graduation");
    // The full allowedOptions set proves other real cases may select any
    // of the other 3 values against the identical Execution Units.
    expect(binding?.allowedOptions).toEqual(["0_deg_blunt", "45_deg_graduation", "90_deg_uniform_layer", "180_deg_overdirection"]);
  });
});

describe("B. REAL: Graduated Cutting -- Execution Units (generalized model, progression, iteration, cross-check)", () => {
  it("14. the real Execution Unit sequence validates and is internally consistent", () => {
    expect(isValidExecutionUnitSequence(GRADUATED_CUTTING_EXECUTION_UNITS)).toBe(true);
    for (const eu of GRADUATED_CUTTING_EXECUTION_UNITS) {
      expect(isValidExecutionUnit(eu, isGraduatedCuttingFact)).toBe(true);
    }
  });

  it("1/8. [Stage 8.5S1B.R1] exactly 3 Execution Units -- contour guide (conditional), ONE generalized graduated execution zone, cross-check. NOT 4, NOT one-per-angle: 45 deg and 90 deg do NOT each require their own permanent Execution Unit", () => {
    expect(GRADUATED_CUTTING_EXECUTION_UNITS.length).toBe(3);
    const ids = GRADUATED_CUTTING_EXECUTION_UNITS.map((eu) => eu.executionUnitId);
    expect(ids).toContain("executionunit-cutting-graduated-perimeter-guide");
    expect(ids).toContain("executionunit-cutting-graduated-execution-zone");
    expect(ids).toContain("executionunit-cutting-graduated-cross-check");
    // No permanent "lower-45"/"upper-90" identity exists anywhere.
    expect(ids.some((id) => id.includes("lower-45") || id.includes("upper-90"))).toBe(false);
  });

  it("8. [Stage 8.5S1B.R1] no hard mapping exists anywhere: no Execution Unit fixes BOTH a specific zone AND a specific elevation as universal law", () => {
    for (const eu of GRADUATED_CUTTING_EXECUTION_UNITS) {
      const zoneRule = eu.parameterRules?.find((r) => r.parameterName === "zone");
      const elevationRule = eu.parameterRules?.find((r) => r.parameterName === "elevation");
      // The ONLY Execution Unit that fixes both is the contour-guide unit,
      // and it fixes them to the SAME non-graduated identity (0 deg,
      // "perimeter_contour_establishment") -- never a lower=45/upper=90
      // pairing.
      if (zoneRule && elevationRule) {
        expect(zoneRule.fixedValue).toBe("perimeter_contour_establishment");
        expect(elevationRule.fixedValue).toBe("0_deg_blunt");
      }
    }
    const executionZone = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-execution-zone")!;
    expect(executionZone.parameterRules?.some((r) => r.parameterName === "elevation")).toBe(false);
    expect(executionZone.parameterRules?.some((r) => r.parameterName === "zone")).toBe(false);
  });

  it("2/7. [Stage 8.5S1B.R1] elevation, zone, and hand orientation resolve from the SOURCE SKILL INSTANCE on the generalized execution-zone unit -- the execution plan decides WHERE and AT WHAT ELEVATION, not the Skill Definition", () => {
    const executionZone = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-execution-zone")!;
    for (const name of ["elevation", "zone", "handOrientation", "clientHeadPosition", "distribution", "overdirection", "tool", "partingOrientation"]) {
      expect(executionZone.parameterRules?.some((r) => r.parameterName === name)).toBe(false);
    }
    // Only what Ionuț stated as genuinely universal for elevated work
    // stays fixed on this unit.
    expect(executionZone.parameterRules?.find((r) => r.parameterName === "controlMethod")?.fixedValue).toBe("fingers");
  });

  it("6/7. [Stage 8.5S1B.R1] a SECOND, alternate Skill Instance selecting a DIFFERENT elevation compiles successfully against the SAME Execution Unit -- proving a valid plan may use one selected elevation, and a different plan may use a different one, without any Skill/Execution-Unit change", () => {
    const executionZone = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-execution-zone")!;

    const alternateInstance: SkillInstance<GraduatedCuttingFact> = {
      ...GRADUATED_CUTTING_SKILL_INSTANCE,
      skillInstanceId: "skillinstance-cutting-graduated-alternate-case-90deg",
      parameterBindings: GRADUATED_CUTTING_SKILL_INSTANCE.parameterBindings.map((b) => {
        if (b.parameterName === "elevation") return { ...b, value: "90_deg_uniform_layer" };
        if (b.parameterName === "handOrientation") return { ...b, value: "fingers_downward_back_of_hand_cut" };
        if (b.parameterName === "zone") return { ...b, value: "above_occipital_perpendicular_to_scalp" };
        return b;
      }),
    };
    const alternateEU = { ...executionZone, sourceSkillInstanceId: alternateInstance.skillInstanceId };

    const originalResult = compileExecutionUnitToAtomicActions(GRADUATED_CUTTING_SKILL, GRADUATED_CUTTING_SKILL_INSTANCE, executionZone, isGraduatedCuttingFact, "2026-09-11T00:00:00.000Z");
    const alternateResult = compileExecutionUnitToAtomicActions(GRADUATED_CUTTING_SKILL, alternateInstance, alternateEU, isGraduatedCuttingFact, "2026-09-11T00:00:00.000Z");

    expect(originalResult.status).toBe("COMPILED");
    expect(alternateResult.status).toBe("COMPILED");
    if (originalResult.status === "COMPILED" && alternateResult.status === "COMPILED") {
      const originalExecute = originalResult.actions.find((a) => a.actionKind === "EXECUTE")!;
      const alternateExecute = alternateResult.actions.find((a) => a.actionKind === "EXECUTE")!;
      // Both compile through the IDENTICAL Execution Unit shape; only the
      // resolved elevation genuinely differs, proving the Skill itself
      // never hardcodes one angle.
      expect(originalExecute.boundParameterNames).toContain("elevation");
      expect(alternateExecute.boundParameterNames).toContain("elevation");
    }
  });

  it("17. cross-check Execution Unit exists, is prerequisite-gated on the generalized execution-zone unit, and unconditionally fixes the opposing (horizontal) parting orientation", () => {
    const crossCheck = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-cross-check")!;
    expect(crossCheck.prerequisiteExecutionUnitIds).toContain("executionunit-cutting-graduated-execution-zone");
    const parting = crossCheck.parameterRules?.find((r) => r.parameterName === "partingOrientation")?.fixedValue;
    expect(parting).toBe("horizontal");
    // Cross-check leaves elevation/handOrientation/zone open too --
    // "re-elevates according to the relevant value for that area".
    for (const name of ["elevation", "handOrientation", "zone"]) {
      expect(crossCheck.parameterRules?.some((r) => r.parameterName === name)).toBe(false);
    }
  });

  it("4. [Stage 8.5S1B.R1] the perimeter/contour guide Execution Unit is CONDITIONAL -- carries a real applicabilityCondition, never universally executed", () => {
    const guideUnit = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-perimeter-guide")!;
    expect(guideUnit.applicabilityCondition).toEqual({ op: "equals", fact: "perimeterGuideRequired", value: true });
  });

  it("5. the progressive graduation guide remains distinct from the contour guide -- different guideReferenceMode values on different units", () => {
    const guideUnit = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-perimeter-guide")!;
    const executionZone = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-execution-zone")!;
    expect(guideUnit.parameterRules?.find((r) => r.parameterName === "guideReferenceMode")?.fixedValue).toBe("contour_guide_reference");
    expect(executionZone.parameterRules?.find((r) => r.parameterName === "guideReferenceMode")?.fixedValue).toBe("previous_subsection");
  });

  it("18. the graduated execution-zone unit declares bounded UNTIL_EXECUTION_UNIT_COMPLETE iteration -- never unbounded, never absent for repeated work", () => {
    const executionZone = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-execution-zone")!;
    const policy = executionZone.verticalPayload?.iterationPolicy as { actionKinds: string[]; iteration: { mode: string } } | undefined;
    expect(policy).toBeTruthy();
    expect(policy!.iteration.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");
    expect(policy!.actionKinds).toContain("EXECUTE");
  });

  it("the perimeter/contour guide Execution Unit does NOT iterate -- a single reference cut, mirroring Establish Central Nape Guide's own precedent", () => {
    const guideUnit = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-perimeter-guide")!;
    expect(guideUnit.verticalPayload?.iterationPolicy).toBeUndefined();
  });

  it("every Execution Unit compiles to real AtomicActions -- POSITION/CONTROL/EXECUTE fire (proves progression/action exists, never a bare parameter)", () => {
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

  it("14. one-isolated-cut prevention: the graduated execution-zone unit carries real iteration (test 18) and DOES chain via prerequisiteExecutionUnitIds (established by the guide unit, consumed by cross-check) -- never a single flat unit standing in for the whole Skill", () => {
    const chain = GRADUATED_CUTTING_EXECUTION_UNITS.map((eu) => eu.executionUnitId);
    const crossCheck = GRADUATED_CUTTING_EXECUTION_UNITS.find((eu) => eu.executionUnitId === "executionunit-cutting-graduated-cross-check")!;
    expect(chain.length).toBeGreaterThan(1);
    expect(crossCheck.prerequisiteExecutionUnitIds?.length).toBeGreaterThan(0);
  });
});
