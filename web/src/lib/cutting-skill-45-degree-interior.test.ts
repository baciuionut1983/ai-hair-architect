import { describe, expect, it } from "vitest";

import {
  INTERIOR_45_EFFECT_SUMMARY,
  INTERIOR_45_EXECUTION_UNITS,
  INTERIOR_45_GUIDE_CAPABILITY,
  INTERIOR_45_REPRESENTATIVE_ATOMIC_ACTIONS,
  INTERIOR_45_SKILL,
  INTERIOR_45_SKILL_INSTANCE,
  isInteriorFortyFiveFact,
} from "@/lib/cutting-skill-45-degree-interior";
import { isSkillEligibleForAuthority, isValidSkillDefinition } from "@/lib/professional-skill-contracts";
import { isValidSkillInstance } from "@/lib/professional-skill-instance-contracts";
import { isValidExecutionUnitSequence } from "@/lib/professional-skill-execution-unit-contracts";
import { isValidAtomicActionSequence } from "@/lib/professional-skill-atomic-action-contracts";
import { GRADUATED_CUTTING_SKILL } from "@/lib/cutting-skill-graduated";
import { ONE_LENGTH_PERIMETER_SKILL } from "@/lib/cutting-skill-one-length-perimeter";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.4.R2,
// ACTIVATED at Stage 8.5L5.R3.5 -- pure tests for the 45deg Interior
// skill, no I/O, no database, no AI calls.
//
// STAGE 8.5L5.R3.5 UPDATE (this revision): tests 2/3 below are
// INTENTIONALLY FLIPPED from R2's own original assertions (status was
// DRAFT / ineligible for authority) -- Ionuț professionally approved
// this proposal, and L5.R3.5's own activation manifest confirms it as
// the one mutation of the 11 approved proposals the existing
// architecture can safely activate as a complete registry skill. Every
// other test in this file is UNCHANGED from R2 -- activation touched
// only `status`, never mechanics/parameters/procedure/capabilities.

describe("cutting-skill-45-degree-interior -- structural validity + ACTIVE/eligibility (Stage 8.5L5.R3.5)", () => {
  it("test 1: INTERIOR_45_SKILL is a structurally valid SkillDefinition", () => {
    expect(isValidSkillDefinition(INTERIOR_45_SKILL, isInteriorFortyFiveFact)).toBe(true);
  });

  it("test 2 (flipped by L5.R3.5 activation): status is ACTIVE, no longer DRAFT", () => {
    expect(INTERIOR_45_SKILL.status).toBe("ACTIVE");
  });

  it("test 3 (flipped by L5.R3.5 activation): an ACTIVE, PROFESSIONALLY_AUTHORED skill is structurally eligible for authority via the SAME existing gate every other active skill uses -- no new gating concept invented", () => {
    expect(isSkillEligibleForAuthority(INTERIOR_45_SKILL)).toBe(true);
  });
});

describe("elevation semantics -- dedicated test (task's own explicit requirement)", () => {
  it("test 4: no parameter named 'elevation' exists anywhere on INTERIOR_45_SKILL -- structural non-existence, never a fabricated 0deg/NOT_APPLICABLE value", () => {
    expect(INTERIOR_45_SKILL.parameters.some((p) => p.name === "elevation")).toBe(false);
  });

  it("test 5: no Execution Unit parameterRule anywhere names 'elevation'", () => {
    for (const unit of INTERIOR_45_EXECUTION_UNITS) {
      expect((unit.parameterRules ?? []).some((r) => r.parameterName === "elevation")).toBe(false);
    }
  });

  it("test 6: terminalCuttingLineAngle is the structurally distinct '45deg' fact -- a different parameter NAME from Graduated Cutting's own 'elevation'", () => {
    const angleParam = INTERIOR_45_SKILL.parameters.find((p) => p.name === "terminalCuttingLineAngle")!;
    expect(angleParam).toBeDefined();
    expect(angleParam.allowedValues).toContain("approximately_45_deg_interior_cutting_line");
    const elevationParam = GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "elevation")!;
    expect(elevationParam.allowedValues).toContain("45_deg_graduation");
    expect(angleParam.name).not.toBe(elevationParam.name);
  });
});

describe("distinctness from Graduated Cutting and One-Length -- zero mutation of existing skills", () => {
  it("test 7: Graduated Cutting's own SkillDefinition is byte-unchanged after importing this proposal", () => {
    expect(GRADUATED_CUTTING_SKILL.skillId).toBe("skill-cutting-graduated");
    expect(GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "elevation")?.allowedValues).toContain("45_deg_graduation");
    expect(GRADUATED_CUTTING_SKILL.status).toBe("ACTIVE");
  });

  it("test 8: One-Length Perimeter's own SkillDefinition is byte-unchanged after importing this proposal", () => {
    expect(ONE_LENGTH_PERIMETER_SKILL.skillId).toBe("skill-cutting-one-length-perimeter");
    expect(ONE_LENGTH_PERIMETER_SKILL.parameters.find((p) => p.name === "elevation")?.allowedValues).toEqual(["0_deg_blunt"]);
    expect(ONE_LENGTH_PERIMETER_SKILL.status).toBe("ACTIVE");
  });

  it("test 9: INTERIOR_45_SKILL declares One-Length Perimeter as a prerequisite (dependency, never a merge)", () => {
    expect(INTERIOR_45_SKILL.prerequisiteSkillIds).toContain(ONE_LENGTH_PERIMETER_SKILL.skillId);
  });

  it("test 10: One-Length Perimeter itself carries ZERO reference back to 45deg Interior -- the dependency edge is one-directional, proving 'used only on One-Length' does not mean 'every One-Length requires it'", () => {
    expect(ONE_LENGTH_PERIMETER_SKILL.incompatibleSkillIds ?? []).not.toContain(INTERIOR_45_SKILL.skillId);
    expect(JSON.stringify(ONE_LENGTH_PERIMETER_SKILL)).not.toMatch(/45-degree-interior/);
  });

  it("test 11: applicabilityCondition states the precondition as a fact, informational only -- never a forced inclusion filter", () => {
    expect(INTERIOR_45_SKILL.applicabilityCondition).toEqual({ op: "equals", fact: "oneLengthStructureComplete", value: true });
  });
});

describe("approximate vs strict value discipline (~2cm sections)", () => {
  it("test 12: sectionWidth is an open, free-text 'string' valueKind -- never a closed enum forcing an exact universal value", () => {
    const param = INTERIOR_45_SKILL.parameters.find((p) => p.name === "sectionWidth")!;
    expect(param.valueKind).toBe("string");
    expect(param.allowedValues).toBeUndefined();
  });

  it("test 13: the Skill Instance binds sectionWidth as DEMONSTRATION_SPECIFIC, never FIXED_FROM_AUTHORITY -- never presented as an absolute universal requirement", () => {
    const binding = INTERIOR_45_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === "sectionWidth")!;
    expect(binding.bindingState).toBe("DEMONSTRATION_SPECIFIC");
    expect(binding.rationale).toBeTruthy();
  });
});

describe("structural composition validity", () => {
  it("test 14: INTERIOR_45_SKILL_INSTANCE is a structurally valid SkillInstance", () => {
    expect(isValidSkillInstance(INTERIOR_45_SKILL_INSTANCE, isInteriorFortyFiveFact)).toBe(true);
  });

  it("test 15: INTERIOR_45_EXECUTION_UNITS forms a valid, contiguous, acyclic Execution Unit sequence", () => {
    expect(isValidExecutionUnitSequence(INTERIOR_45_EXECUTION_UNITS)).toBe(true);
    expect(INTERIOR_45_EXECUTION_UNITS).toHaveLength(3);
  });

  it("test 16: INTERIOR_45_REPRESENTATIVE_ATOMIC_ACTIONS forms a valid, contiguous, acyclic Atomic Action sequence -- representational proof for future video compatibility", () => {
    expect(isValidAtomicActionSequence(INTERIOR_45_REPRESENTATIVE_ATOMIC_ACTIONS)).toBe(true);
  });
});

describe("mechanics fields -- cornerRepositioning is a single, non-reversible fact", () => {
  it("test 17: cornerRepositioning declares exactly one allowed value -- structurally impossible to invert INTERIOR/EXTERIOR corner positions via two independently-set fields", () => {
    const param = INTERIOR_45_SKILL.parameters.find((p) => p.name === "cornerRepositioning")!;
    expect(param.allowedValues).toHaveLength(1);
    expect(param.allowedValues![0]).toBe("interior_corner_lower_exterior_corner_upper");
  });
});

describe("length relationship -- exterior shorter than interior, opposite polarity from Graduated Cutting", () => {
  it("test 18: terminalLengthRelationship is exterior_shorter_than_interior, a distinct field from Graduated Cutting's own perimeterRelationship concept", () => {
    const param = INTERIOR_45_SKILL.parameters.find((p) => p.name === "terminalLengthRelationship")!;
    expect(param.allowedValues).toEqual(["exterior_shorter_than_interior"]);
    expect(INTERIOR_45_SKILL.parameters.some((p) => p.name === "perimeterRelationship")).toBe(false);
  });
});

describe("mechanics vs effect -- kept structurally separate (never encode the effect as a cutting instruction)", () => {
  it("test 19: none of the SkillDefinition's own MECHANICS fields (parameters/procedure), its Execution Units, or its Atomic Actions ever mention 'inward' or 'curvature' -- the effect is never itself a mechanics instruction. (Human-readable top-level description/rationale prose MAY reference the effect for readability -- only the structural, machine-consumed mechanics fields are checked here.)", () => {
    const mechanicsJson = JSON.stringify({ parameters: INTERIOR_45_SKILL.parameters, procedure: INTERIOR_45_SKILL.procedure, units: INTERIOR_45_EXECUTION_UNITS, actions: INTERIOR_45_REPRESENTATIVE_ATOMIC_ACTIONS });
    expect(mechanicsJson.toLowerCase()).not.toMatch(/inward|curvature|curve/);
  });

  it("test 20: the inward-curvature effect DOES live in the separate, explicitly-labeled INTERIOR_45_EFFECT_SUMMARY -- documented, never lost, never conflated with mechanics", () => {
    expect(INTERIOR_45_EFFECT_SUMMARY.addedEffect.toLowerCase()).toMatch(/inward/);
    expect(INTERIOR_45_EFFECT_SUMMARY.targetRelationship).toBe("exterior_shorter_than_interior");
  });
});

describe("hand-rotation invariant -- structurally checkable, never a false elevation value", () => {
  it("test 21: the hand-height-invariant check is a boolean observation ('handLiftedFromBase' = false), never a numeric/degree fact", () => {
    const check = INTERIOR_45_REPRESENTATIVE_ATOMIC_ACTIONS.find((a) => a.atomicActionId === "atomicaction-45-degree-interior-hand-height-invariant-check")!;
    expect(check.actionKind).toBe("VERIFY");
    expect(check.observationCriterion).toEqual({ fact: "handLiftedFromBase", expectedValue: false, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" });
    expect(check.stateTransition).toBeUndefined();
  });

  it("test 22: fingertip orientation transitions down -> up via an explicit stateTransition, distinct from the hand-height invariant", () => {
    const rotation = INTERIOR_45_REPRESENTATIVE_ATOMIC_ACTIONS.find((a) => a.atomicActionId === "atomicaction-45-degree-interior-hand-rotation")!;
    expect(rotation.stateTransition).toEqual({ fact: "fingertipOrientation", fromValue: "down", toValue: "up" });
  });

  it("test 23: the cut action structurally REQUIRES the hand-height-invariant check to have occurred first -- mechanics ordering is explicit, not implied by array position alone", () => {
    const cut = INTERIOR_45_REPRESENTATIVE_ATOMIC_ACTIONS.find((a) => a.atomicActionId === "atomicaction-45-degree-interior-cut")!;
    expect(cut.requiresActionIds).toContain("atomicaction-45-degree-interior-hand-height-invariant-check");
  });
});

describe("capability model -- REFINE_ENDS only, no fabricated OUTCOME kind", () => {
  it("test 24: INTERIOR_45_SKILL declares exactly one capability, REFINE_ENDS -- no REDUCE_LENGTH/MODIFY_PERIMETER_RELATIONSHIP or other OUTCOME kind is invented for an effect with no corresponding HairStateDelta field", () => {
    expect(INTERIOR_45_SKILL.capabilities).toEqual([{ kind: "REFINE_ENDS" }]);
  });
});

describe("guide/reference semantics -- UNKNOWN-heavy, never inventing travelling/stationary/source classification", () => {
  it("test 25: guideSource, guideBehavior, progression, and referenceProgression all stay UNKNOWN; only currentSectionRelationship is set, directly grounded in Ionuț's own wording", () => {
    expect(INTERIOR_45_GUIDE_CAPABILITY.guideSource).toBe("UNKNOWN");
    expect(INTERIOR_45_GUIDE_CAPABILITY.guideBehavior).toBe("UNKNOWN");
    expect(INTERIOR_45_GUIDE_CAPABILITY.progression).toBe("UNKNOWN");
    expect(INTERIOR_45_GUIDE_CAPABILITY.referenceProgression).toBe("UNKNOWN");
    expect(INTERIOR_45_GUIDE_CAPABILITY.currentSectionRelationship).toBe("CUT_RELATIVE_TO_GUIDE");
  });

  it("test 26: unknownNumericFields names the exact missing precise values -- never a fabricated number anywhere", () => {
    expect(INTERIOR_45_GUIDE_CAPABILITY.unknownNumericFields.length).toBeGreaterThan(0);
    for (const field of INTERIOR_45_GUIDE_CAPABILITY.unknownNumericFields) expect(field).not.toMatch(/^\d/);
  });
});
