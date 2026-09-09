import { describe, expect, it } from "vitest";

import { isSkillEligibleForAuthority, isValidSkillDefinition } from "@/lib/professional-skill-contracts";
import { isValidSkillInstance, isValidSkillInstanceSequence } from "@/lib/professional-skill-instance-contracts";
import { isValidExecutionUnit, isValidExecutionUnitSequence } from "@/lib/professional-skill-execution-unit-contracts";
import { ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE } from "@/lib/cutting-skill-establish-central-nape-guide";
import {
  CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS,
  CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL,
  CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE,
  isContinueCentralNapeConstructionFact,
} from "@/lib/cutting-skill-continue-central-nape-construction";

// AI Hair Architect, Stage 2.5.i.25 -- REAL PROFESSIONAL AUTHORITY FIXTURE
// tests for "Continue Central Nape Construction", mirroring
// cutting-skill-establish-central-nape-guide.test.ts's own "Section A"
// conventions exactly.

describe("A. REAL: Continue Central Nape Construction -- Skill Definition", () => {
  it("1. the real Skill Definition validates against the Stage 2.5.i.1 contract", () => {
    expect(isValidSkillDefinition(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL, isContinueCentralNapeConstructionFact)).toBe(true);
  });

  it("2. authority is professional/authored, ACTIVE, and eligible", () => {
    expect(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.authorityType).toBe("PROFESSIONALLY_AUTHORED");
    expect(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.status).toBe("ACTIVE");
    expect(isSkillEligibleForAuthority(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL)).toBe(true);
  });

  it("3. the procedure is a genuine, ordered, meaningful professional sequence", () => {
    const orders = CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.procedure.map((s) => s.order);
    expect(orders).toEqual([1, 2, 3, 4, 5]);
    const referenced = new Set(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.procedure.flatMap((s) => s.referencedParameters ?? []));
    for (const parameter of CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.parameters) {
      expect(referenced.has(parameter.name)).toBe(true);
    }
  });
});

describe("A. REAL: Continue Central Nape Construction -- Skill Instance", () => {
  it("4. the real Skill Instance validates against the Stage 2.5.i.5 contract, chained after Central Nape Guide's own real instance", () => {
    expect(isValidSkillInstance(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE, isContinueCentralNapeConstructionFact)).toBe(true);
    // Its own prerequisiteSkillInstanceIds names Central Nape Guide's real
    // instance, so a valid sequence must include both, in order.
    expect(isValidSkillInstanceSequence([ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE, CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE])).toBe(true);
  });

  it("5. every material bound value carries structured provenance", () => {
    expect(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE.parameterBindings.length).toBe(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.parameters.length);
    for (const binding of CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE.parameterBindings) {
      expect(binding.bindingState).toBe("FIXED_FROM_AUTHORITY");
      expect(binding.value).not.toBeUndefined();
      expect(binding.sourceReference).toBeTruthy();
    }
  });

  function findBinding(name: string) {
    return CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === name);
  }

  // -------------------------------------------------------------------------
  // J-Q: professional rule preservation
  // -------------------------------------------------------------------------

  it("J. natural fall preserved", () => expect(findBinding("distribution")?.value).toBe("natural_fall"));
  it("K. 0deg elevation preserved", () => expect(findBinding("elevation")?.value).toBe("0_deg_blunt"));
  it("L. no overdirection preserved", () => expect(findBinding("overdirection")?.value).toBe(false));
  it("M. COMB control preserved below transition, no exception", () => {
    expect(findBinding("controlMethod")?.value).toBe("comb");
    const parameter = CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.parameters.find((p) => p.name === "controlMethod");
    expect(parameter?.allowedValues).toEqual(["comb"]);
  });
  it("N. WET hair state preserved", () => expect(findBinding("hairState")?.value).toBe("wet"));
  it("O. straight shear tool preserved", () => expect(findBinding("tool")?.value).toBe("straight_shear"));
  it("P. horizontal shear orientation preserved", () => expect(findBinding("shearOrientation")?.value).toBe("horizontal"));
  it("Q. straight/blunt resulting line preserved", () => expect(findBinding("cuttingLineShape")?.value).toBe("straight"));

  // -------------------------------------------------------------------------
  // H/I: progressive guide relationship, never a fixed pointer to G0
  // -------------------------------------------------------------------------

  it("H. guide reference is authored as a RELATIVE rule (previous subsection), never an absolute pointer to the original guide", () => {
    const binding = findBinding("guideReferenceMode");
    expect(binding?.value).toBe("previous_subsection");
    expect(binding?.value).not.toBe("central_guide");
    expect(binding?.value).not.toBe("original_guide");
    expect(binding?.value).not.toBe("center_nape");
    const parameter = CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.parameters.find((p) => p.name === "guideReferenceMode");
    expect(parameter?.allowedValues).toEqual(["previous_subsection"]);
  });

  // -------------------------------------------------------------------------
  // G: guide identifiability is a SEPARATE parameter from the reference rule
  // and from any thickness value
  // -------------------------------------------------------------------------

  it("G. guide identifiability criterion is a distinct parameter, never merged with guideReferenceMode or a thickness value", () => {
    const identifiability = findBinding("guideIdentifiabilityCriterion");
    const reference = findBinding("guideReferenceMode");
    expect(identifiability?.value).toBe("must_remain_visually_identifiable");
    expect(identifiability?.parameterName).not.toBe(reference?.parameterName);
    expect(identifiability?.value).not.toBe(reference?.value);
  });

  // -------------------------------------------------------------------------
  // F: ~1cm demonstration target is NOT present anywhere in this authority
  // -------------------------------------------------------------------------

  it("F. no subsection thickness value (e.g. 1cm) or repeat count anywhere in Skill/Instance authority -- demonstration-layer only", () => {
    const haystack = JSON.stringify({
      parameters: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.parameters,
      bindings: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE.parameterBindings,
    }).toLowerCase();
    expect(haystack.includes("1cm")).toBe(false);
    expect(haystack.includes("1 cm")).toBe(false);
    expect(haystack.includes("centimeter")).toBe(false);
  });
});

describe("A. REAL: Continue Central Nape Construction -- prohibited facts absent", () => {
  // NOTE: the JSON object's own KEY NAMES must never include a key whose
  // name itself contains a forbidden substring (e.g. "laterality" contains
  // "lateral") -- only VALUES are scanned. `laterality` is checked
  // separately, by exact value, below.
  const haystack = JSON.stringify({
    parameterNames: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.parameters.map((p) => p.name),
    parameterAllowedValues: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.parameters.flatMap((p) => p.allowedValues ?? []),
    bindingValues: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE.parameterBindings.map((b) => b.value),
    zoneId: CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS[0].zoneId,
  }).toLowerCase();

  it("T. no FINGERS control introduced -- controlMethod is locked to comb only", () => {
    expect(haystack.includes("fingers")).toBe(false);
  });
  it("U. no graduation introduced", () => expect(haystack.includes("graduat")).toBe(false));
  it("V. no Slice And Slide introduced", () => expect(haystack.includes("slice_and_slide")).toBe(false));
  it("W. no texturizing introduced", () => expect(haystack.includes("texturiz")).toBe(false));
  it("no elevation above 0deg anywhere", () => {
    expect(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.parameters.find((p) => p.name === "elevation")?.allowedValues).toEqual(["0_deg_blunt"]);
  });
  it("no dry-hair value -- hairState locked to wet only", () => {
    expect(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.parameters.find((p) => p.name === "hairState")?.allowedValues).toEqual(["wet"]);
  });
  it("no different tool/line introduced", () => {
    expect(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.parameters.find((p) => p.name === "tool")?.allowedValues).toEqual(["straight_shear"]);
    expect(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.parameters.find((p) => p.name === "cuttingLineShape")?.allowedValues).toEqual(["straight"]);
  });
  it("contains no lateral execution rule", () => {
    expect(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS[0].laterality).toBe("NOT_APPLICABLE");
    expect(haystack.includes("lateral")).toBe(false);
  });
});

describe("A. REAL: Continue Central Nape Construction -- Execution Unit + iteration policy", () => {
  it("exactly one Execution Unit, structurally valid", () => {
    expect(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS.length).toBe(1);
    expect(isValidExecutionUnit(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS[0], isContinueCentralNapeConstructionFact)).toBe(true);
    expect(isValidExecutionUnitSequence(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS)).toBe(true);
  });

  it("traces back to the exact Skill Instance", () => {
    expect(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS[0].sourceSkillInstanceId).toBe(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE.skillInstanceId);
  });

  it("prerequisite-chained after Central Nape Guide's own real Skill Instance", () => {
    expect(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL_INSTANCE.prerequisiteSkillInstanceIds).toEqual([ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.skillInstanceId]);
  });

  // -------------------------------------------------------------------------
  // A/S: iteration policy present, scoped to CONTROL/EXECUTE only, and the
  // stop/transition condition is a real anatomical boundary, not a fixed
  // count.
  // -------------------------------------------------------------------------

  it("A. declares an iteration policy for CONTROL and EXECUTE only -- never POSITION (one-shot, never repeated)", () => {
    const policy = CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS[0].verticalPayload?.iterationPolicy as { actionKinds: string[]; iteration: { mode: string } };
    expect(policy.actionKinds.sort()).toEqual(["CONTROL", "EXECUTE"]);
    expect(policy.actionKinds).not.toContain("POSITION");
  });

  it("S. iteration mode is UNTIL_EXECUTION_UNIT_COMPLETE -- bounded by the anatomical condition, never a fixed count", () => {
    const policy = CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS[0].verticalPayload?.iterationPolicy as { iteration: { mode: string; count?: number } };
    expect(policy.iteration.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");
    expect(policy.iteration.count).toBeUndefined();
  });

  it("S. the stop/transition condition is the real anatomical threshold shared with Occipital Transition's own lower unit", () => {
    expect(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS[0].applicabilityCondition).toEqual({ op: "equals", fact: "aboveOccipitalThreshold", value: false });
  });
});
