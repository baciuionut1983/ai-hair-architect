import { describe, expect, it } from "vitest";

import { compileVisualInstructionPackage } from "@/lib/professional-visual-instruction-compiler";
import { isValidVisualInstructionPackage } from "@/lib/professional-visual-instruction-contracts";
import { evaluateRenderReadiness, isAuthorizedToRender, isProgressiveScenePackageRenderReady } from "@/lib/professional-visual-instruction-readiness";
import { compileOneRealPackage, compileRealExecutionPlan, compileRealPackages, realScenePlan, realTemplates, syntheticPrimaryCaptureEvidence } from "@/lib/professional-visual-instruction-fixtures";

// AI Hair Architect, Stage 8 -- VISUAL INSTRUCTION COMPILER tests
// including the Part AD end-to-end proof using ONLY the 3 real registered
// skills, and the Part AE mandatory "one isolated cut" rejection. Zero
// I/O, zero AI, zero paid provider call.

const GUIDE_UNIT = "executionunit-cutting-establish-central-nape-guide-1";
const OCC_LOWER = "executionunit-cutting-occipital-transition-lower-1";
const CONTINUATION = "executionunit-cutting-continue-central-nape-construction-1";

describe("PART AD -- end-to-end visual instruction proof, 3 real skills only", () => {
  it("compiles one structurally valid VisualInstructionPackage per scene; ZERO packages for the unsupported crown delta", () => {
    const { packages, failures, scenePlan } = compileRealPackages(true);
    expect(failures).toEqual([]);
    expect(packages.length).toBe(scenePlan.scenes.length);
    for (const pkg of packages) expect(isValidVisualInstructionPackage(pkg)).toBe(true);
    expect(packages.some((p) => p.contributesToDelta.scope === "crown")).toBe(false);
  });

  it("CENTRAL NAPE GUIDE package -- traces to exact skill/version, carries before-state, action geometry, expected effect, preserve list, viewpoint, observables, verification, medium", () => {
    const { packages } = compileRealPackages(true);
    const guideExec = packages.find((p) => p.sourceExecutionUnitId === GUIDE_UNIT && p.progression !== undefined)!;
    expect(guideExec.skillId).toBe("skill-cutting-establish-central-nape-guide");
    expect(guideExec.skillVersion).toBe(1);
    expect(guideExec.expectedVisibleEffect.capability).toBe("ESTABLISH_GUIDE");
    expect(guideExec.viewpoint.status).toBe("RESOLVED");
    expect(guideExec.viewpoint.family).toBe("POSTERIOR");
    expect(guideExec.professionalParameters.some((p) => p.name === "elevation")).toBe(true);
    expect(guideExec.handToolRelationships.some((r) => r.kind === "STRAND_HELD_AT_DECLARED_ELEVATION")).toBe(true);
    expect(guideExec.preservationConstraints).toEqual([
      { scope: "nape", field: "lengthIntent", value: "preserve" },
      { scope: "occipital", field: "lengthIntent", value: "preserve" },
    ]);
    expect(guideExec.forbiddenDeviations.some((f) => f.kind === "ALTER_DECLARED_ELEVATION")).toBe(true);
    expect(guideExec.forbiddenDeviations.some((f) => f.kind === "CHANGE_PROTECTED_LENGTH" && f.subject === "nape:lengthIntent")).toBe(true);
    expect(guideExec.cameraConstraints).toContain("HANDS_MUST_REMAIN_VISIBLE");
    expect(guideExec.cameraConstraints).toContain("NO_RAPID_CUTS_OR_MONTAGE");
    expect(guideExec.overlayElements.some((o) => o.kind === "GUIDE_LINE" || o.kind === "ZONE_HIGHLIGHT")).toBe(true);
    expect(guideExec.requiredMedium).toBe("MOTION_REQUIRED");
  });

  it("OCCIPITAL TRANSITION lower package -- depends on the guide's completion; carries a guide relationship and GUIDE_VISIBLE verification", () => {
    const { packages } = compileRealPackages(true);
    const lower = packages.filter((p) => p.sourceExecutionUnitId === OCC_LOWER).sort((a, b) => (a.progression ? 1 : 0) - (b.progression ? 1 : 0))[0];
    expect(lower.beforeState.requiredPriorState.some((c) => c.fact === `${GUIDE_UNIT}.completed`)).toBe(true);
    expect(lower.forbiddenDeviations.some((f) => f.kind === "ALTER_GUIDE_GEOMETRY")).toBe(true);
    expect(lower.verification.questions.some((q) => q.question === "GUIDE_VISIBLE")).toBe(true);
    expect(lower.expectedVisibleEffect.capability).toBe("CONNECT_ZONES");
  });

  it("CONTINUATION package -- retains bounded iteration as MULTI_STEP_PROGRESSIVE_ACTION; verification requires PROGRESSION_SHOWN + ITERATION_REPRESENTED", () => {
    const { packages } = compileRealPackages(true);
    const contExec = packages.find((p) => p.sourceExecutionUnitId === CONTINUATION && p.progression?.kind === "SPATIAL_SUBSECTION_SEQUENCE")!;
    expect(contExec.renderScope).toBe("MULTI_STEP_PROGRESSIVE_ACTION");
    expect(contExec.progression?.iteration?.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");
    expect(contExec.handToolRelationships.some((r) => r.kind === "TOOL_REFERENCES_PREVIOUS_GUIDE")).toBe(true);
    expect(contExec.handToolRelationships.some((r) => r.kind === "SUBSECTION_REFERENCES_PRECEDING_SUBSECTION")).toBe(true);
    expect(contExec.verification.questions.some((q) => q.question === "PROGRESSION_SHOWN")).toBe(true);
    expect(contExec.verification.questions.some((q) => q.question === "ITERATION_REPRESENTED")).toBe(true);
    expect(contExec.overlayElements.some((o) => o.kind === "PROGRESSION_DIRECTION")).toBe(true);
    expect(isProgressiveScenePackageRenderReady(contExec, true)).toBe(true);
  });

  it("every package readiness result reported honestly -- RENDER_READY only with a PRIMARY_CAPTURE reference; NEEDS_VISUAL_EVIDENCE without one", () => {
    const withEv = compileRealPackages(true);
    const executionPlan = compileRealExecutionPlan();
    for (const pkg of withEv.packages) {
      const r = evaluateRenderReadiness({ package: pkg, scenePlan: withEv.scenePlan, executionPlan, templates: realTemplates(), professionalApprovalPresent: true });
      expect(r.status).toBe("RENDER_READY");
      expect(isAuthorizedToRender(r)).toBe(true);
    }

    const noEv = compileRealPackages(false);
    for (const pkg of noEv.packages) {
      const r = evaluateRenderReadiness({ package: pkg, scenePlan: noEv.scenePlan, executionPlan, templates: realTemplates() });
      expect(r.status).toBe("NEEDS_VISUAL_EVIDENCE");
      expect(r.findings.some((f) => f.reason === "MISSING_SOURCE_EVIDENCE")).toBe(true);
    }
  });

  it("no provider-specific token anywhere in any compiled package", () => {
    const { packages } = compileRealPackages(true);
    const json = JSON.stringify(packages).toLowerCase();
    for (const banned of ["veo", "gemini", "openai", "anthropic", "\"prompt\"", "seconds", "clip_length", "aspectratio", "\"seed\"", "focal"]) {
      expect(json.includes(banned)).toBe(false);
    }
  });

  it("deterministic -- recompiling the same scene twice yields byte-identical packages and a stable packageFingerprint", () => {
    const a = compileOneRealPackage(0, true);
    const b = compileOneRealPackage(0, true);
    if (a.status !== "COMPILED" || b.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(a.package).toEqual(b.package);
    expect(a.package.packageFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("compilation alone is not authorization -- a RENDER_READY package without professional approval is NOT authorized to render", () => {
    const { packages, scenePlan } = compileRealPackages(true);
    const executionPlan = compileRealExecutionPlan();
    const r = evaluateRenderReadiness({ package: packages[0], scenePlan, executionPlan, templates: realTemplates() /* no professionalApprovalPresent */ });
    expect(r.status).toBe("RENDER_READY");
    expect(r.findings.some((f) => f.reason === "PROFESSIONAL_APPROVAL_REQUIRED")).toBe(true);
    expect(isAuthorizedToRender(r)).toBe(false);
  });
});

describe("PART AE -- the mandatory 'one isolated cut' rejection", () => {
  it("a deliberately insufficient package for the progressive continuation scene (single pass, no iteration) is rejected by the Render Readiness Gate", () => {
    const one = compileOneRealPackage(0, true);
    if (one.status !== "COMPILED") throw new Error("expected COMPILED");

    const scenePlan = realScenePlan();
    const executionPlan = compileRealExecutionPlan();
    const contScene = [...scenePlan.scenes].find((s) => s.sourceExecutionUnitId === CONTINUATION && s.phase === "EXECUTION")!;
    const good = compileVisualInstructionPackage({ scene: contScene, scenePlan, executionPlan, templates: realTemplates(), sourceVisualEvidence: [syntheticPrimaryCaptureEvidence()] });
    if (good.status !== "COMPILED") throw new Error("expected COMPILED");

    // downgrade it to "show one cut": collapse progression, strip the
    // progression observable + verification questions.
    const oneCut = {
      ...good.package,
      progression: { kind: "SINGLE_PASS" as const, zoneId: good.package.progression?.zoneId },
      observables: good.package.observables.filter((o) => o.aspect !== "SUBSECTION_PROGRESSION_VISIBLE"),
      verification: {
        ...good.package.verification,
        questions: good.package.verification.questions.filter((q) => q.question !== "PROGRESSION_SHOWN" && q.question !== "ITERATION_REPRESENTED"),
      },
    };

    const r = evaluateRenderReadiness({ package: oneCut, scenePlan, executionPlan, templates: realTemplates(), professionalApprovalPresent: true });
    expect(r.status).toBe("NOT_READY");
    expect(r.findings.some((f) => f.reason === "MISSING_PROGRESSION")).toBe(true);
    expect(r.findings.some((f) => f.reason === "MISSING_ITERATION")).toBe(true);
    expect(isProgressiveScenePackageRenderReady(oneCut, true)).toBe(false);
    expect(isAuthorizedToRender(r)).toBe(false);
  });
});

describe("scene compiler -- failure semantics", () => {
  it("UNRESOLVED when a scene's execution unit is not in the source execution plan", () => {
    const scenePlan = realScenePlan();
    const executionPlan = compileRealExecutionPlan();
    const tamperedScene = { ...[...scenePlan.scenes][0], sourceExecutionUnitId: "does-not-exist" };
    const result = compileVisualInstructionPackage({ scene: tamperedScene, scenePlan, executionPlan, templates: realTemplates() });
    expect(result.status).toBe("UNRESOLVED");
  });

  it("UNRESOLVED when no skill template is registered for the unit's skill instance", () => {
    const scenePlan = realScenePlan();
    const executionPlan = compileRealExecutionPlan();
    const result = compileVisualInstructionPackage({ scene: [...scenePlan.scenes][0], scenePlan, executionPlan, templates: [] });
    expect(result.status).toBe("UNRESOLVED");
  });
});
