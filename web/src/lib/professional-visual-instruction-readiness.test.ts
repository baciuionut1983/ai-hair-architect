import { describe, expect, it } from "vitest";

import { compileVisualInstructionPackage } from "@/lib/professional-visual-instruction-compiler";
import {
  RENDER_READINESS_REASONS,
  evaluateRenderReadiness,
  isAuthorizedToRender,
  isRenderReadinessReason,
  type EvaluateRenderReadinessInput,
} from "@/lib/professional-visual-instruction-readiness";
import type { VisualInstructionPackage } from "@/lib/professional-visual-instruction-contracts";
import {
  compileRealExecutionPlan,
  realScenePlan,
  realTemplates,
  syntheticPrimaryCaptureEvidence,
  syntheticTargetReferenceEvidence,
} from "@/lib/professional-visual-instruction-fixtures";

const CONTINUATION = "executionunit-cutting-continue-central-nape-construction-1";

function baseInput(overrides: Partial<VisualInstructionPackage> = {}, sceneSelector: (s: { sourceExecutionUnitId: string; phase: string }) => boolean = (s) => s.phase === "EXECUTION"): EvaluateRenderReadinessInput {
  const scenePlan = realScenePlan();
  const executionPlan = compileRealExecutionPlan();
  const scene = [...scenePlan.scenes].sort((a, b) => a.order - b.order).find(sceneSelector)!;
  const compiled = compileVisualInstructionPackage({ scene, scenePlan, executionPlan, templates: realTemplates(), sourceVisualEvidence: [syntheticPrimaryCaptureEvidence()] });
  if (compiled.status !== "COMPILED") throw new Error("expected COMPILED");
  return { package: { ...compiled.package, ...overrides }, scenePlan, executionPlan, templates: realTemplates(), professionalApprovalPresent: true };
}

describe("evaluateRenderReadiness -- reason vocabulary + baseline", () => {
  it("all reasons pass the guard; an unknown string does not", () => {
    for (const r of RENDER_READINESS_REASONS) expect(isRenderReadinessReason(r)).toBe(true);
    expect(isRenderReadinessReason("not ready")).toBe(false);
  });

  it("53. a complete package with evidence + approval is RENDER_READY and authorized", () => {
    const r = evaluateRenderReadiness(baseInput());
    expect(r.status).toBe("RENDER_READY");
    expect(r.findings).toEqual([]);
    expect(isAuthorizedToRender(r)).toBe(true);
  });
});

describe("PART AF -- professional semantic mutation attacks (all must fail deterministic validation)", () => {
  it("59. skill mutation rejected", () => {
    const r = evaluateRenderReadiness(baseInput({ skillId: "skill-cutting-butterfly-layers" }));
    expect(r.status).toBe("NOT_READY");
    expect(r.findings.some((f) => f.reason === "SKILL_VERSION_TRACEABILITY_BROKEN")).toBe(true);
  });
  it("60. version mutation rejected", () => {
    const r = evaluateRenderReadiness(baseInput({ skillVersion: 99 }));
    expect(r.findings.some((f) => f.reason === "SKILL_VERSION_TRACEABILITY_BROKEN")).toBe(true);
  });
  it("61. zone mutation rejected", () => {
    const r = evaluateRenderReadiness(baseInput({ contributesToDelta: { scope: "crown", field: "weightIntent" } }));
    expect(r.findings.some((f) => f.reason === "PROFESSIONAL_SEMANTIC_CONTRADICTION" || f.reason === "UNRESOLVED_DELTA")).toBe(true);
    expect(r.status === "NOT_READY" || r.status === "UNRESOLVED").toBe(true);
  });
  it("62. guide relationship mutation rejected (guideReferenceMode param present but relationship removed)", () => {
    const contInput = baseInput({}, (s) => s.sourceExecutionUnitId === CONTINUATION && s.phase === "EXECUTION");
    const stripped = { ...contInput.package, handToolRelationships: contInput.package.handToolRelationships.filter((x) => x.kind !== "TOOL_REFERENCES_PREVIOUS_GUIDE") };
    const r = evaluateRenderReadiness({ ...contInput, package: stripped });
    expect(r.findings.some((f) => f.reason === "MISSING_GUIDE_RELATIONSHIP")).toBe(true);
  });
  it("63. expected-effect capability mutation rejected", () => {
    const p = baseInput().package;
    const r = evaluateRenderReadiness(baseInput({ expectedVisibleEffect: { ...p.expectedVisibleEffect, capability: "REDUCE_WEIGHT" } }));
    expect(r.findings.some((f) => f.reason === "UNSUPPORTED_EXPECTED_EFFECT" || f.reason === "PROFESSIONAL_SEMANTIC_CONTRADICTION")).toBe(true);
  });
  it("64. tool relationship mutation rejected (tool param present but no tool relationship)", () => {
    const p = baseInput().package;
    const r = evaluateRenderReadiness(baseInput({ handToolRelationships: p.handToolRelationships.filter((x) => x.kind !== "TOOL_ALIGNED_TO_CUTTING_LINE" && x.kind !== "TOOL_IN_DECLARED_ORIENTATION") }));
    expect(r.findings.some((f) => f.reason === "MISSING_TOOL_RELATIONSHIP")).toBe(true);
  });
  it("65. progression mutation rejected on a progressive unit's EXECUTION package", () => {
    const contInput = baseInput({}, (s) => s.sourceExecutionUnitId === CONTINUATION && s.phase === "EXECUTION");
    const collapsed = { ...contInput.package, progression: { kind: "SINGLE_PASS" as const, zoneId: contInput.package.progression?.zoneId } };
    const r = evaluateRenderReadiness({ ...contInput, package: collapsed });
    expect(r.findings.some((f) => f.reason === "MISSING_PROGRESSION")).toBe(true);
  });
  it("66. preservation mutation rejected (preservation list truncated)", () => {
    const p = baseInput().package;
    const r = evaluateRenderReadiness(baseInput({ preservationConstraints: [p.preservationConstraints[0]] }));
    expect(r.findings.some((f) => f.reason === "MISSING_PRESERVATION_CONSTRAINT")).toBe(true);
  });
  it("6. source atomic action reference mutation rejected", () => {
    const p = baseInput().package;
    const r = evaluateRenderReadiness(baseInput({ sourceAtomicActionIds: [...p.sourceAtomicActionIds, "invented#action"] }));
    expect(r.findings.some((f) => f.reason === "MISSING_SOURCE_ACTION")).toBe(true);
  });
  it("2. scene fingerprint mutation rejected", () => {
    const r = evaluateRenderReadiness(baseInput({ sourceSceneFingerprint: "0".repeat(64) }));
    expect(r.findings.some((f) => f.reason === "SOURCE_SCENE_FINGERPRINT_MISMATCH")).toBe(true);
  });
});

describe("PART AG -- continuity adversarial", () => {
  it("41/45. a required prior state fact that no earlier scene carries forward is rejected", () => {
    const r = evaluateRenderReadiness(
      baseInput({ beforeState: { requiresPriorSceneIds: [], requiredPriorState: [{ fact: "phantom.guide.completed", expectedValue: true, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" }] } }),
    );
    expect(r.findings.some((f) => f.reason === "CONTINUITY_UNSATISFIED")).toBe(true);
  });
  it("a required prior SCENE id that does not exist is rejected", () => {
    const r = evaluateRenderReadiness(baseInput({ beforeState: { requiresPriorSceneIds: ["no-such-scene"], requiredPriorState: [] } }));
    expect(r.findings.some((f) => f.reason === "CONTINUITY_UNSATISFIED")).toBe(true);
  });
  it("42. the occipital lower package's real guide dependency IS satisfied by an earlier guide scene", () => {
    const r = evaluateRenderReadiness(baseInput({}, (s) => s.sourceExecutionUnitId === "executionunit-cutting-occipital-transition-lower-1" && s.phase === "EXECUTION"));
    expect(r.status).toBe("RENDER_READY");
  });
});

describe("PART AH -- visual evidence", () => {
  it("49/56. a package that requires source imagery but references none -> NEEDS_VISUAL_EVIDENCE with MISSING_SOURCE_EVIDENCE", () => {
    const r = evaluateRenderReadiness(baseInput({ sourceVisualEvidence: [] }));
    expect(r.status).toBe("NEEDS_VISUAL_EVIDENCE");
    expect(r.findings.some((f) => f.reason === "MISSING_SOURCE_EVIDENCE")).toBe(true);
  });
  it("48. a TARGET_REFERENCE alone does NOT satisfy the source-imagery requirement (a reference image is not professional authority)", () => {
    const r = evaluateRenderReadiness(baseInput({ sourceVisualEvidence: [syntheticTargetReferenceEvidence()] }));
    expect(r.status).toBe("NEEDS_VISUAL_EVIDENCE");
  });
  it("46/47. a PRIMARY_CAPTURE reference satisfies it; the reference is carried by id only, never rewritten", () => {
    const input = baseInput();
    const r = evaluateRenderReadiness(input);
    expect(r.status).toBe("RENDER_READY");
    expect(input.package.sourceVisualEvidence[0].assetId).toBe("SYNTHETIC-primary-capture-asset");
    expect(input.package.sourceVisualEvidence[0].evidenceRole).toBe("PRIMARY_CAPTURE");
  });
});

describe("readiness -- structural / traceability", () => {
  it("1. MISSING_SOURCE_SCENE when the package points at a non-existent scene", () => {
    const r = evaluateRenderReadiness(baseInput({ sourceSceneId: "ghost-scene" }));
    expect(r.status).toBe("NOT_READY");
    expect(r.findings.some((f) => f.reason === "MISSING_SOURCE_SCENE")).toBe(true);
  });
  it("3. EXECUTION_PLAN_TRACEABILITY_BROKEN when the expected plan id differs", () => {
    const input = baseInput();
    const r = evaluateRenderReadiness({ ...input, expectedSourceExecutionPlanId: "different-plan" });
    expect(r.findings.some((f) => f.reason === "EXECUTION_PLAN_TRACEABILITY_BROKEN")).toBe(true);
  });
  it("16. MISSING_VIEWPOINT -> status NEEDS_VIEWPOINT", () => {
    const r = evaluateRenderReadiness(baseInput({ viewpoint: { status: "NEEDS_INPUT", framingSemantics: [], sourceViewpointConstraintIds: [] } }));
    expect(r.status).toBe("NEEDS_VIEWPOINT");
    expect(r.findings.some((f) => f.reason === "MISSING_VIEWPOINT")).toBe(true);
  });
  it("25. SCENE_TOO_BROAD -> status NEEDS_SCENE_SPLIT when a subsection-sequence progression has no bounded zone", () => {
    const contInput = baseInput({}, (s) => s.sourceExecutionUnitId === CONTINUATION && s.phase === "EXECUTION");
    const unbounded = { ...contInput.package, progression: { ...contInput.package.progression!, zoneId: "" } };
    const r = evaluateRenderReadiness({ ...contInput, package: unbounded });
    expect(r.status).toBe("NEEDS_SCENE_SPLIT");
    expect(r.findings.some((f) => f.reason === "SCENE_TOO_BROAD")).toBe(true);
  });
  it("58. a package for the unsupported crown delta -> status UNRESOLVED (cannot become ready)", () => {
    const r = evaluateRenderReadiness(baseInput({ contributesToDelta: { scope: "crown", field: "weightIntent" } }));
    expect(r.status).toBe("UNRESOLVED");
    expect(r.findings.some((f) => f.reason === "UNRESOLVED_DELTA")).toBe(true);
  });
});

describe("PART AI + cost -- render-ready is not authorized-to-spend", () => {
  it("72/73/74. RENDER_READY without approval lists PROFESSIONAL_APPROVAL_REQUIRED and is NOT authorized; the gate makes no provider request or call", () => {
    const input = baseInput();
    const r = evaluateRenderReadiness({ ...input, professionalApprovalPresent: false });
    expect(r.status).toBe("RENDER_READY");
    expect(r.professionalApprovalPresent).toBe(false);
    expect(r.findings.some((f) => f.reason === "PROFESSIONAL_APPROVAL_REQUIRED")).toBe(true);
    expect(isAuthorizedToRender(r)).toBe(false);

    const r2 = evaluateRenderReadiness({ ...input, professionalApprovalPresent: true });
    expect(isAuthorizedToRender(r2)).toBe(true);
  });
});
