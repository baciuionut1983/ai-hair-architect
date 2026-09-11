import { describe, expect, it } from "vitest";

import { isSkillEligibleForAuthority, isValidSkillDefinition } from "@/lib/professional-skill-contracts";
import { isSkillInstanceEligibleForAuthority, isValidSkillInstance, isValidSkillInstanceSequence } from "@/lib/professional-skill-instance-contracts";
import { isValidExecutionUnit, isValidExecutionUnitSequence } from "@/lib/professional-skill-execution-unit-contracts";
import { compileExecutionUnitToAtomicActions } from "@/lib/cutting-skill-atomic-action-compiler";
import {
  isSliceAndSlideRefinementFact,
  SLICE_AND_SLIDE_REFINEMENT_EXECUTION_UNITS,
  SLICE_AND_SLIDE_REFINEMENT_SKILL,
  SLICE_AND_SLIDE_REFINEMENT_SKILL_INSTANCE,
} from "@/lib/cutting-skill-slice-and-slide-refinement";
import { GRADUATED_CUTTING_SKILL } from "@/lib/cutting-skill-graduated";
import { ONE_LENGTH_PERIMETER_SKILL } from "@/lib/cutting-skill-one-length-perimeter";
import { selectCandidateSkillsForDelta } from "@/lib/hair-state-delta-skill-candidate-selector";
import { unassessedFact, buildUnassessedZoneEntry } from "@/lib/hair-state-snapshot-validators";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import type { HairStateSnapshotDeltaInput } from "@/lib/hair-state-delta";

// ===========================================================================
// SECTION A -- REAL PROFESSIONAL AUTHORITY FIXTURE / CONSTANT.
// ===========================================================================

describe("A. REAL: Slice-and-Slide Refinement -- Skill Definition", () => {
  it("1. the real Skill Definition validates against the Stage 2.5.i.1 contract", () => {
    expect(isValidSkillDefinition(SLICE_AND_SLIDE_REFINEMENT_SKILL, isSliceAndSlideRefinementFact)).toBe(true);
  });

  it("2. authority is professional/authored, ACTIVE, and eligible", () => {
    expect(SLICE_AND_SLIDE_REFINEMENT_SKILL.authorityType).toBe("PROFESSIONALLY_AUTHORED");
    expect(SLICE_AND_SLIDE_REFINEMENT_SKILL.status).toBe("ACTIVE");
    expect(isSkillEligibleForAuthority(SLICE_AND_SLIDE_REFINEMENT_SKILL)).toBe(true);
  });

  it("3. exact skillKey and version", () => {
    expect(SLICE_AND_SLIDE_REFINEMENT_SKILL.skillId).toBe("skill-cutting-slice-and-slide-refinement");
    expect(SLICE_AND_SLIDE_REFINEMENT_SKILL.version).toBe(1);
  });

  it("4. capability is REFINE_ENDS ONLY -- never REDUCE_WEIGHT, per Ionuț's own explicit correction", () => {
    const kinds = (SLICE_AND_SLIDE_REFINEMENT_SKILL.capabilities ?? []).map((c) => c.kind);
    expect(kinds).toEqual(["REFINE_ENDS"]);
    expect(kinds).not.toContain("REDUCE_WEIGHT");
  });

  it("5. requires a graduated structure as prerequisite -- declared by real skillKey", () => {
    expect(SLICE_AND_SLIDE_REFINEMENT_SKILL.prerequisiteSkillIds).toContain(GRADUATED_CUTTING_SKILL.skillId);
  });

  it("6. is incompatible with Construct One-Length Perimeter -- declared by real skillKey, mutual with the reciprocal declaration", () => {
    expect(SLICE_AND_SLIDE_REFINEMENT_SKILL.incompatibleSkillIds).toContain(ONE_LENGTH_PERIMETER_SKILL.skillId);
    expect(ONE_LENGTH_PERIMETER_SKILL.incompatibleSkillIds).toContain(SLICE_AND_SLIDE_REFINEMENT_SKILL.skillId);
  });

  it("7. working depth is a professional range, never a fixed universal numeric constant", () => {
    const workingDepth = SLICE_AND_SLIDE_REFINEMENT_SKILL.parameters.find((p) => p.name === "workingDepth");
    expect(workingDepth?.valueKind).toBe("string");
    expect(workingDepth?.allowedValues).toBeUndefined();
  });

  it("8. scissor control and strand control are represented as real, closed, single professional facts matching Ionuț's exact description", () => {
    const strandControl = SLICE_AND_SLIDE_REFINEMENT_SKILL.parameters.find((p) => p.name === "strandControl");
    expect(strandControl?.allowedValues).toEqual(["index_middle_finger_fingers_downward"]);
    const scissorControl = SLICE_AND_SLIDE_REFINEMENT_SKILL.parameters.find((p) => p.name === "scissorControl");
    expect(scissorControl?.allowedValues?.[0]).toMatch(/partially_open/);
    expect(scissorControl?.allowedValues?.[0]).toMatch(/partial_closure/);
  });

  it("9. reuses the real, already-shipped slice_cutting/slice_and_slide enum values -- strong vocabulary alignment, never invented", () => {
    const cuttingTechnique = SLICE_AND_SLIDE_REFINEMENT_SKILL.parameters.find((p) => p.name === "cuttingTechnique");
    expect(cuttingTechnique?.allowedValues).toEqual(["slice_cutting"]);
    const texturizingTechnique = SLICE_AND_SLIDE_REFINEMENT_SKILL.parameters.find((p) => p.name === "texturizingTechnique");
    expect(texturizingTechnique?.allowedValues).toEqual(["slice_and_slide"]);
  });
});

describe("A. REAL: Slice-and-Slide Refinement -- Skill Instance", () => {
  it("10. the real Skill Instance validates against the Stage 2.5.i.5 contract", () => {
    expect(isValidSkillInstance(SLICE_AND_SLIDE_REFINEMENT_SKILL_INSTANCE, isSliceAndSlideRefinementFact)).toBe(true);
    expect(isValidSkillInstanceSequence([SLICE_AND_SLIDE_REFINEMENT_SKILL_INSTANCE])).toBe(true);
    expect(isSkillInstanceEligibleForAuthority(SLICE_AND_SLIDE_REFINEMENT_SKILL)).toBe(true);
  });

  it("11. workingDepth is bound DEMONSTRATION_SPECIFIC, never a fabricated universal default", () => {
    const binding = SLICE_AND_SLIDE_REFINEMENT_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === "workingDepth");
    expect(binding?.bindingState).toBe("DEMONSTRATION_SPECIFIC");
    expect(binding?.rationale).toBeTruthy();
  });
});

describe("B. REAL: Slice-and-Slide Refinement -- Execution Unit (progression, iteration, stop condition)", () => {
  it("12. the real Execution Unit sequence validates", () => {
    expect(isValidExecutionUnitSequence(SLICE_AND_SLIDE_REFINEMENT_EXECUTION_UNITS)).toBe(true);
    for (const eu of SLICE_AND_SLIDE_REFINEMENT_EXECUTION_UNITS) {
      expect(isValidExecutionUnit(eu, isSliceAndSlideRefinementFact)).toBe(true);
    }
  });

  it("13. declares bounded UNTIL_EXECUTION_UNIT_COMPLETE iteration -- one slide is not a completed technique", () => {
    const eu = SLICE_AND_SLIDE_REFINEMENT_EXECUTION_UNITS[0];
    const policy = eu.verticalPayload?.iterationPolicy as { actionKinds: string[]; iteration: { mode: string } } | undefined;
    expect(policy).toBeTruthy();
    expect(policy!.iteration.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");
    expect(policy!.actionKinds).toContain("EXECUTE");
    expect(policy!.actionKinds).toContain("CONTROL");
  });

  it("14. compiles to real AtomicActions -- POSITION/CONTROL/EXECUTE all fire, proving real action + progression, never a bare parameter", () => {
    const eu = SLICE_AND_SLIDE_REFINEMENT_EXECUTION_UNITS[0];
    const result = compileExecutionUnitToAtomicActions(SLICE_AND_SLIDE_REFINEMENT_SKILL, SLICE_AND_SLIDE_REFINEMENT_SKILL_INSTANCE, eu, isSliceAndSlideRefinementFact, "2026-09-11T00:00:00.000Z");
    expect(result.status).toBe("COMPILED");
    if (result.status === "COMPILED") {
      const kinds = result.actions.map((a) => a.actionKind);
      expect(kinds).toContain("POSITION");
      expect(kinds).toContain("CONTROL");
      expect(kinds).toContain("EXECUTE");
      const execute = result.actions.find((a) => a.actionKind === "EXECUTE")!;
      expect(execute.boundParameterNames).toContain("cuttingTechnique");
    }
  });
});

describe("C. REAL: Slice-and-Slide Refinement -- Stage 4 candidate selection consequence (honest, not faked)", () => {
  function currentTarget(): { current: HairStateSnapshotDeltaInput; target: HairStateSnapshotDeltaInput } {
    const globalEntry = { relativeLength: unassessedFact("unspecified" as const), fiberThickness: unassessedFact("unspecified" as const), density: unassessedFact("unspecified" as const), texture: unassessedFact("unspecified" as const), condition: unassessedFact("unspecified" as const) };
    const zones = HEAD_ZONES.map((z) => buildUnassessedZoneEntry(z));
    const targetZones = HEAD_ZONES.map((z) => {
      const entry = buildUnassessedZoneEntry(z);
      if (z === "crown") return { ...entry, weightIntent: { value: "reduce" as const, source: "professional_input" as const } };
      return entry;
    });
    return {
      current: { id: "current-1", snapshotVersion: 1, payload: { globalState: globalEntry, zones } },
      target: { id: "target-1", snapshotVersion: 1, payload: { globalState: globalEntry, zones: targetZones } },
    };
  }

  it("15. REFINE_ENDS is a PROCEDURAL capability -- Slice-and-Slide is therefore NEVER a Stage 4 deterministic candidate via selectCandidateSkillsForDelta, an accepted honest consequence, never faked around with an invented OUTCOME capability", () => {
    const { current, target } = currentTarget();
    const registry = [
      {
        id: "registry-slice-and-slide-1",
        skillId: SLICE_AND_SLIDE_REFINEMENT_SKILL.skillId,
        version: SLICE_AND_SLIDE_REFINEMENT_SKILL.version,
        vertical: SLICE_AND_SLIDE_REFINEMENT_SKILL.vertical,
        name: SLICE_AND_SLIDE_REFINEMENT_SKILL.name,
        status: SLICE_AND_SLIDE_REFINEMENT_SKILL.status,
        authorityType: SLICE_AND_SLIDE_REFINEMENT_SKILL.authorityType,
        payload: SLICE_AND_SLIDE_REFINEMENT_SKILL,
        reviewedByUserId: null,
        reviewedAt: null,
        supersededBySkillDefinitionId: null,
        createdAt: SLICE_AND_SLIDE_REFINEMENT_SKILL.createdAt,
        updatedAt: SLICE_AND_SLIDE_REFINEMENT_SKILL.createdAt,
      },
    ];
    const selection = selectCandidateSkillsForDelta(current, target, registry);
    expect(selection.candidateMatches.some((m) => m.skillKey === SLICE_AND_SLIDE_REFINEMENT_SKILL.skillId)).toBe(false);
    expect(selection.rejectedMatches.some((m) => m.skillKey === SLICE_AND_SLIDE_REFINEMENT_SKILL.skillId)).toBe(false);
  });
});
