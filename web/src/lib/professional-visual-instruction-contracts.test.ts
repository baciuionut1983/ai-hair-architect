import { describe, expect, it } from "vitest";

import {
  CAMERA_CONSTRAINT_KINDS,
  FORBIDDEN_DEVIATION_KINDS,
  OVERLAY_ELEMENT_KINDS,
  VERIFICATION_QUESTION_KINDS,
  VISUAL_INSTRUCTION_RENDER_SCOPES,
  VISUAL_SUBJECT_ELEMENTS,
  computeVisualInstructionPackageFingerprint,
  isForbiddenDeviationKind,
  isValidVisualInstructionPackage,
  isVisualInstructionRenderScope,
  type VisualInstructionPackage,
} from "@/lib/professional-visual-instruction-contracts";
import { compileOneRealPackage } from "@/lib/professional-visual-instruction-fixtures";

function realPkg(): VisualInstructionPackage {
  const r = compileOneRealPackage(1, true); // scene index 1 = an EXECUTION scene
  if (r.status !== "COMPILED") throw new Error("expected COMPILED");
  return r.package;
}

describe("professional-visual-instruction-contracts", () => {
  it("vocabularies are the expected closed sets", () => {
    expect(VISUAL_SUBJECT_ELEMENTS).toContain("ESTABLISHED_GUIDE");
    expect(VISUAL_SUBJECT_ELEMENTS).toContain("PROTECTED_REGION");
    expect(FORBIDDEN_DEVIATION_KINDS).toContain("ALTER_GUIDE_GEOMETRY");
    expect(FORBIDDEN_DEVIATION_KINDS).toContain("JUMP_UNFINISHED_TO_FINISHED_ZONE");
    expect(CAMERA_CONSTRAINT_KINDS).toContain("NO_ORBIT_OR_DRAMATIC_MOVE_DURING_TECHNIQUE");
    expect(OVERLAY_ELEMENT_KINDS).toContain("GUIDE_LINE");
    expect(VERIFICATION_QUESTION_KINDS).toContain("ITERATION_REPRESENTED");
    expect([...VISUAL_INSTRUCTION_RENDER_SCOPES]).toEqual(["SHORT_SINGLE_ACTION", "BOUNDED_PROGRESSIVE_ACTION", "MULTI_STEP_PROGRESSIVE_ACTION", "VERIFICATION_ONLY"]);
    expect(isForbiddenDeviationKind("CHANGE_TOOL")).toBe(true);
    expect(isForbiddenDeviationKind("REPHRASE_GOAL")).toBe(false);
    expect(isVisualInstructionRenderScope("VERIFICATION_ONLY")).toBe(true);
  });

  it("a real compiled package is structurally valid", () => {
    expect(isValidVisualInstructionPackage(realPkg())).toBe(true);
  });

  it("a package with an empty forbiddenDeviations list is rejected (a technical video must always know what must NOT change)", () => {
    expect(isValidVisualInstructionPackage({ ...realPkg(), forbiddenDeviations: [] })).toBe(false);
  });

  it("a package with an unrecognized capability on expectedVisibleEffect is rejected", () => {
    const p = realPkg();
    expect(isValidVisualInstructionPackage({ ...p, expectedVisibleEffect: { ...p.expectedVisibleEffect, capability: "MAKE_IT_NICE" } })).toBe(false);
  });

  it("a package with BOTH progression and progressionNotApplicableReason is rejected; NEITHER is rejected", () => {
    const p = realPkg();
    expect(isValidVisualInstructionPackage({ ...p, progressionNotApplicableReason: "x" })).toBe(false);
    const { progression: _drop, ...noProg } = p;
    void _drop;
    expect(isValidVisualInstructionPackage(noProg)).toBe(false);
  });

  it("a package with a NEEDS_INPUT viewpoint is still structurally valid (readiness gate rejects it, not the shape)", () => {
    const p = realPkg();
    expect(isValidVisualInstructionPackage({ ...p, viewpoint: { status: "NEEDS_INPUT", framingSemantics: [], sourceViewpointConstraintIds: [] } })).toBe(true);
  });

  it("a package with a malformed source visual evidence reference is rejected", () => {
    const p = realPkg();
    expect(isValidVisualInstructionPackage({ ...p, sourceVisualEvidence: [{ evidenceKind: "IMAGE_ASSET", evidenceRole: "NOT_A_ROLE", assetId: "a", snapshotId: "s" }] })).toBe(false);
  });

  it("computeVisualInstructionPackageFingerprint is deterministic + set-order-insensitive; a professional-parameter / viewpoint / evidence / preservation change flips it", () => {
    const base = {
      sourceExecutionPlanId: "p",
      sourceSceneId: "s1",
      sourceSceneFingerprint: "f".repeat(64),
      skillId: "skill-x",
      skillVersion: 1,
      contributesToDelta: { scope: "nape", field: "lengthIntent" },
      professionalParameters: [
        { name: "elevation", value: "0_deg_blunt", source: "SKILL_DEFAULT" },
        { name: "tool", value: "straight_shear", source: "SKILL_DEFAULT" },
      ],
      progression: undefined,
      renderScope: "SHORT_SINGLE_ACTION",
      completionCriterion: { fact: "s1.completed", expectedValue: true as const, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" as const },
      expectedCapability: "ESTABLISH_GUIDE",
      preservationConstraints: [{ scope: "nape", field: "lengthIntent", value: "preserve" }],
      forbiddenDeviationKinds: ["INVENT_EXTRA_CUT:"],
      viewpointFamily: "POSTERIOR",
      framingSemantics: ["GEOMETRY_READABLE"],
      observableAspects: ["GUIDE_LINE_VISIBLE"],
      requiredMedium: "MOTION_REQUIRED",
      overlayKinds: ["GUIDE_LINE"],
      sourceVisualEvidence: [{ evidenceKind: "IMAGE_ASSET" as const, evidenceRole: "PRIMARY_CAPTURE" as const, assetId: "a1", snapshotId: "sn1" }],
      compilerVersion: "1.0.0",
    };
    const f1 = computeVisualInstructionPackageFingerprint(base);
    // set-order-insensitive
    const reordered = { ...base, professionalParameters: [base.professionalParameters[1], base.professionalParameters[0]] };
    expect(computeVisualInstructionPackageFingerprint(reordered)).toBe(f1);
    // professional parameter change
    expect(computeVisualInstructionPackageFingerprint({ ...base, professionalParameters: [{ name: "elevation", value: "45_deg", source: "SKILL_DEFAULT" }] })).not.toBe(f1);
    // viewpoint change
    expect(computeVisualInstructionPackageFingerprint({ ...base, viewpointFamily: undefined })).not.toBe(f1);
    // preservation change
    expect(computeVisualInstructionPackageFingerprint({ ...base, preservationConstraints: [] })).not.toBe(f1);
    // evidence change
    expect(computeVisualInstructionPackageFingerprint({ ...base, sourceVisualEvidence: [] })).not.toBe(f1);
    expect(f1).toMatch(/^[0-9a-f]{64}$/);
  });
});
