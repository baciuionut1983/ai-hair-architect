import { describe, expect, it } from "vitest";

import { compileVisualInstructionPackage } from "@/lib/professional-visual-instruction-compiler";
import { evaluateRenderReadiness } from "@/lib/professional-visual-instruction-readiness";
import { VIEWPOINT_FAMILIES } from "@/lib/professional-skill-viewpoint-constraint-contracts";
import { SCENE_MEDIA } from "@/lib/professional-execution-scene-contracts";
import { compileRealExecutionPlan, realScenePlan, realTemplates, syntheticPrimaryCaptureEvidence } from "@/lib/professional-visual-instruction-fixtures";

// AI Hair Architect, Stage 8 -- gap coverage: medium representability,
// no-second-taxonomy, future-vision verification, before/after
// satisfiability, abstract scope. SYNTHETIC TEST FIXTURE where a real
// scene does not exercise the branch. Zero I/O, zero AI.

function firstExecScene() {
  const scenePlan = realScenePlan();
  const executionPlan = compileRealExecutionPlan();
  const scene = [...scenePlan.scenes].sort((a, b) => a.order - b.order).find((s) => s.phase === "EXECUTION")!;
  return { scene, scenePlan, executionPlan };
}

describe("MEDIUM (Part Y 50-52) -- honest, never forced", () => {
  it("29/30. viewpoint reuses the existing ViewpointFamily vocabulary; no bespoke camera taxonomy field on the package", () => {
    const { scene, scenePlan, executionPlan } = firstExecScene();
    const r = compileVisualInstructionPackage({ scene, scenePlan, executionPlan, templates: realTemplates(), sourceVisualEvidence: [syntheticPrimaryCaptureEvidence()] });
    if (r.status !== "COMPILED") throw new Error("expected COMPILED");
    if (r.package.viewpoint.status === "RESOLVED") expect(VIEWPOINT_FAMILIES).toContain(r.package.viewpoint.family!);
    const json = JSON.stringify(r.package);
    for (const banned of ["cameraAngleDegrees", "shotType", "lens", "dollyMove"]) expect(json.includes(banned)).toBe(false);
  });

  it("50/51/52. requiredMedium is one of the closed SceneMedia; a STATIC_OK / OVERLAY_REQUIRED scene is representable and does not force video", () => {
    const { scene, scenePlan, executionPlan } = firstExecScene();
    const r = compileVisualInstructionPackage({ scene, scenePlan, executionPlan, templates: realTemplates(), sourceVisualEvidence: [syntheticPrimaryCaptureEvidence()] });
    if (r.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(SCENE_MEDIA).toContain(r.package.requiredMedium);

    // a scene whose Stage 7 medium is OVERLAY_REQUIRED -> the package does
    // NOT require source imagery (Part R -- overlays need no photo of the
    // real person).
    const overlayScene = { ...scene, requiredMedium: "OVERLAY_REQUIRED" as const };
    const overlayPkg = compileVisualInstructionPackage({ scene: overlayScene, scenePlan, executionPlan, templates: realTemplates() });
    if (overlayPkg.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(overlayPkg.package.requiredMedium).toBe("OVERLAY_REQUIRED");
    expect(overlayPkg.package.visualEvidenceRequired).toBe(false);
    const rr = evaluateRenderReadiness({ package: overlayPkg.package, scenePlan, executionPlan, templates: realTemplates(), professionalApprovalPresent: true });
    // no evidence supplied, but an overlay scene does not need it
    expect(rr.findings.some((f) => f.reason === "MISSING_SOURCE_EVIDENCE")).toBe(false);
  });
});

describe("VERIFICATION contract (Part Y 37-40)", () => {
  it("37/38/39. every package's verification contract carries PASS conditions (questions) with FAIL / NEEDS_PROFESSIONAL_REVIEW dispositions", () => {
    const { scene, scenePlan, executionPlan } = firstExecScene();
    const r = compileVisualInstructionPackage({ scene, scenePlan, executionPlan, templates: realTemplates(), sourceVisualEvidence: [syntheticPrimaryCaptureEvidence()] });
    if (r.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(r.package.verification.questions.length).toBeGreaterThan(0);
    expect(r.package.verification.questions.some((q) => q.failDisposition === "FAIL")).toBe(true);
    expect(r.package.verification.questions.some((q) => q.failDisposition === "NEEDS_PROFESSIONAL_REVIEW")).toBe(true);
    expect(r.package.verification.questions.some((q) => q.question === "NO_UNDECLARED_CHANGES_INTRODUCED")).toBe(true);
  });

  it("40. FUTURE_VISION_VERIFICATION mode is representable in the contract without any AI/Vision call", () => {
    const { scene, scenePlan, executionPlan } = firstExecScene();
    const visionScene = { ...scene, verification: { ...scene.verification, mode: "FUTURE_VISION_VERIFICATION" as const } };
    const r = compileVisualInstructionPackage({ scene: visionScene, scenePlan, executionPlan, templates: realTemplates(), sourceVisualEvidence: [syntheticPrimaryCaptureEvidence()] });
    if (r.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(r.package.verification.mode).toBe("FUTURE_VISION_VERIFICATION");
    const rr = evaluateRenderReadiness({ package: r.package, scenePlan, executionPlan, templates: realTemplates(), professionalApprovalPresent: true });
    expect(rr.status).toBe("RENDER_READY");
  });
});

describe("BEFORE / AFTER (Part Y 9)", () => {
  it("9. a later scene's required prior state is satisfied by an earlier scene's carriesForward output", () => {
    const scenePlan = realScenePlan();
    const executionPlan = compileRealExecutionPlan();
    const ordered = [...scenePlan.scenes].sort((a, b) => a.order - b.order);
    // the FIRST scene of the occipital lower sub-unit depends on the
    // guide's completion (Stage 7 wires the cross-unit dependency onto a
    // unit's first phase-scene).
    const dependent = ordered.find((s) => s.sourceExecutionUnitId === "executionunit-cutting-occipital-transition-lower-1")!;
    const pkg = compileVisualInstructionPackage({ scene: dependent, scenePlan, executionPlan, templates: realTemplates(), sourceVisualEvidence: [syntheticPrimaryCaptureEvidence()] });
    if (pkg.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(pkg.package.beforeState.requiredPriorState.length).toBeGreaterThan(0);
    const rr = evaluateRenderReadiness({ package: pkg.package, scenePlan, executionPlan, templates: realTemplates(), professionalApprovalPresent: true });
    expect(rr.findings.some((f) => f.reason === "CONTINUITY_UNSATISFIED")).toBe(false);
  });
});

describe("ABSTRACT SCOPE (Part V / Part Y)", () => {
  it("a SINGLE_PASS execution scene is SHORT_SINGLE_ACTION; a VERIFICATION scene is VERIFICATION_ONLY; a subsection sequence is MULTI_STEP_PROGRESSIVE_ACTION", () => {
    const scenePlan = realScenePlan();
    const executionPlan = compileRealExecutionPlan();
    const ordered = [...scenePlan.scenes].sort((a, b) => a.order - b.order);

    const guideExec = ordered.find((s) => s.sourceExecutionUnitId === "executionunit-cutting-establish-central-nape-guide-1" && s.phase === "EXECUTION")!;
    const guidePkg = compileVisualInstructionPackage({ scene: guideExec, scenePlan, executionPlan, templates: realTemplates() });
    if (guidePkg.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(guidePkg.package.renderScope).toBe("SHORT_SINGLE_ACTION");

    const guideVerify = ordered.find((s) => s.sourceExecutionUnitId === "executionunit-cutting-establish-central-nape-guide-1" && s.phase === "VERIFICATION")!;
    const verifyPkg = compileVisualInstructionPackage({ scene: guideVerify, scenePlan, executionPlan, templates: realTemplates() });
    if (verifyPkg.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(verifyPkg.package.renderScope).toBe("VERIFICATION_ONLY");

    const contExec = ordered.find((s) => s.sourceExecutionUnitId === "executionunit-cutting-continue-central-nape-construction-1" && s.phase === "EXECUTION")!;
    const contPkg = compileVisualInstructionPackage({ scene: contExec, scenePlan, executionPlan, templates: realTemplates() });
    if (contPkg.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(contPkg.package.renderScope).toBe("MULTI_STEP_PROGRESSIVE_ACTION");
  });
});

describe("PER-SCENE REGENERATION (Part Y 67-71 / Part AC)", () => {
  it("changing one scene's professional parameter changes only that package's fingerprint; the other packages' fingerprints are byte-stable", () => {
    const scenePlan = realScenePlan();
    const executionPlan = compileRealExecutionPlan();
    const ordered = [...scenePlan.scenes].sort((a, b) => a.order - b.order);

    const compileAll = (plan: typeof executionPlan) =>
      ordered.map((scene) => {
        const r = compileVisualInstructionPackage({ scene, scenePlan, executionPlan: plan, templates: realTemplates() });
        if (r.status !== "COMPILED") throw new Error("expected COMPILED");
        return r.package;
      });

    const before = compileAll(executionPlan);

    // mutate ONE unit's resolved parameter
    const mutated = structuredClone(executionPlan);
    const target = mutated.plannedUnits.find((u) => u.executionUnit.executionUnitId === "executionunit-cutting-establish-central-nape-guide-1")!;
    const elev = target.resolvedParameters.find((p) => p.name === "elevation");
    if (elev) (elev as { value: string }).value = "45_deg_synthetic";
    const after = compileAll(mutated);

    let changed = 0;
    let stable = 0;
    for (let i = 0; i < before.length; i += 1) {
      if (before[i].packageFingerprint === after[i].packageFingerprint) stable += 1;
      else changed += 1;
    }
    expect(changed).toBeGreaterThan(0);
    expect(stable).toBeGreaterThan(0);
    // only guide-unit packages changed
    for (let i = 0; i < before.length; i += 1) {
      if (before[i].sourceExecutionUnitId !== "executionunit-cutting-establish-central-nape-guide-1") {
        expect(before[i].packageFingerprint).toBe(after[i].packageFingerprint);
      }
    }
  });
});
